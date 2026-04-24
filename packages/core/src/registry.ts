import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import type { AgentRegistration } from './types.js';
import { MeshBusError } from './bus.js';
import { setAgentStatus } from './bus.js';
import { getValidatedRedisUrl } from './redisUrl.js';

const REGISTRY_HASH = 'mesh:registry';
const HEARTBEAT_PREFIX = 'mesh:heartbeat:';

let redis: Redis | null = null;
let offlineSweep: ReturnType<typeof setInterval> | null = null;

function getRedisUrl(): string {
  try {
    return getValidatedRedisUrl();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid REDIS_URL';
    throw new MeshBusError(msg, e);
  }
}

function ensureRedis(): Redis {
  if (!redis) {
    redis = new Redis(getRedisUrl(), { maxRetriesPerRequest: null });
    redis.on('error', (err: Error) => {
      console.error(`[agentmesh] Redis registry: ${err.message}`);
    });
  }
  return redis;
}

function serialiseAgent(a: AgentRegistration): string {
  return JSON.stringify({
    ...a,
    registeredAt:
      a.registeredAt instanceof Date
        ? a.registeredAt.toISOString()
        : a.registeredAt,
    lastSeen:
      a.lastSeen instanceof Date ? a.lastSeen.toISOString() : a.lastSeen,
  });
}

function parseAgent(json: string): AgentRegistration {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: String(raw.description),
    capabilities: raw.capabilities as string[],
    subscriptions: raw.subscriptions as string[],
    endpoint: String(raw.endpoint),
    healthEndpoint: String(raw.healthEndpoint),
    registeredAt: new Date(String(raw.registeredAt)),
    lastSeen: new Date(String(raw.lastSeen)),
    status: raw.status as AgentRegistration['status'],
  };
}

function topicMatchesSubscription(topic: string, subscription: string): boolean {
  if (subscription === topic) return true;
  if (subscription.endsWith('*')) {
    const prefix = subscription.slice(0, -1);
    return topic.startsWith(prefix);
  }
  return false;
}

export function startRegistryOfflineSweep(): void {
  if (offlineSweep) return;
  offlineSweep = setInterval(() => {
    void sweepOfflineAgents();
  }, 10_000);
}

export function stopRegistryOfflineSweep(): void {
  if (offlineSweep) {
    clearInterval(offlineSweep);
    offlineSweep = null;
  }
}

async function sweepOfflineAgents(): Promise<void> {
  try {
    const r = ensureRedis();
    const ids = await r.hkeys(REGISTRY_HASH);
    for (const id of ids) {
      const exists = await r.exists(`${HEARTBEAT_PREFIX}${id}`);
      if (!exists) {
        const raw = await r.hget(REGISTRY_HASH, id);
        if (!raw) continue;
        const agent = parseAgent(raw);
        agent.status = 'offline';
        await r.hset(REGISTRY_HASH, id, serialiseAgent(agent));
        await r.hset('mesh:agents', id, 'offline');
      }
    }
  } catch {
    /* sweep is best-effort */
  }
}

export async function registerAgent(
  reg: Omit<AgentRegistration, 'registeredAt' | 'lastSeen' | 'status'>,
): Promise<AgentRegistration> {
  try {
    const r = ensureRedis();
    const now = new Date();
    const full: AgentRegistration = {
      ...reg,
      id: reg.id || uuidv4(),
      registeredAt: now,
      lastSeen: now,
      status: 'online',
    };
    await r.hset(REGISTRY_HASH, full.id, serialiseAgent(full));
    await setAgentStatus(full.id, 'online', 30);
    return full;
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('registerAgent failed', e);
  }
}

export async function deregisterAgent(id: string): Promise<void> {
  try {
    const r = ensureRedis();
    await r.hdel(REGISTRY_HASH, id);
    await r.hdel('mesh:agents', id);
    await r.del(`${HEARTBEAT_PREFIX}${id}`);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('deregisterAgent failed', e);
  }
}

export async function heartbeat(id: string): Promise<void> {
  try {
    const r = ensureRedis();
    const raw = await r.hget(REGISTRY_HASH, id);
    if (!raw) {
      throw new MeshBusError(`Unknown agent id: ${id}`);
    }
    const agent = parseAgent(raw);
    agent.lastSeen = new Date();
    agent.status = 'online';
    await r.hset(REGISTRY_HASH, id, serialiseAgent(agent));
    await setAgentStatus(id, 'online', 30);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('heartbeat failed', e);
  }
}

export async function findByCapability(
  capability: string,
): Promise<AgentRegistration[]> {
  const all = await getAllAgents();
  return all.filter((a) => a.capabilities.includes(capability));
}

export async function getAllAgents(): Promise<AgentRegistration[]> {
  try {
    const r = ensureRedis();
    const entries = await r.hgetall(REGISTRY_HASH);
    return Object.values(entries).map((json) => parseAgent(json as string));
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('getAllAgents failed', e);
  }
}

export async function getAgent(id: string): Promise<AgentRegistration | null> {
  try {
    const r = ensureRedis();
    const raw = await r.hget(REGISTRY_HASH, id);
    if (!raw) return null;
    return parseAgent(raw);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('getAgent failed', e);
  }
}

export async function findAgentsSubscribedToTopic(
  topic: string,
): Promise<AgentRegistration[]> {
  const all = await getAllAgents();
  return all.filter((a) =>
    a.subscriptions.some((sub) => topicMatchesSubscription(topic, sub)),
  );
}

export async function disconnectRegistry(): Promise<void> {
  stopRegistryOfflineSweep();
  await redis?.quit();
  redis = null;
}
