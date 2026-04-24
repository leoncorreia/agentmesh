import { Redis } from 'ioredis';
import type { MeshEvent } from './types.js';
import { getValidatedRedisUrl } from './redisUrl.js';

export class MeshBusError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'MeshBusError';
  }
}

const AGENTS_HASH = 'mesh:agents';
const HEARTBEAT_PREFIX = 'mesh:heartbeat:';

let pub: Redis | null = null;
let sub: Redis | null = null;
let subListenersAttached = false;

type MeshEventListener = (event: MeshEvent) => void;
const meshEventLocalListeners = new Set<MeshEventListener>();
const meshEventBusListeners = new Set<MeshEventListener>();

const channelHandlers = new Map<string, Set<(event: MeshEvent) => void>>();
const rawChannelHandlers = new Map<string, Set<(message: string) => void>>();
const patternHandlers = new Map<
  string,
  Set<(event: MeshEvent, channel: string) => void>
>();

export function onMeshEventPublishedLocally(fn: MeshEventListener): () => void {
  meshEventLocalListeners.add(fn);
  return () => meshEventLocalListeners.delete(fn);
}

export function onMeshEventFromBus(fn: MeshEventListener): () => void {
  meshEventBusListeners.add(fn);
  return () => meshEventBusListeners.delete(fn);
}

function getRedisUrl(): string {
  try {
    return getValidatedRedisUrl();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid REDIS_URL';
    throw new MeshBusError(msg, e);
  }
}

function attachRedisErrorLogging(r: Redis, label: string): void {
  r.on('error', (err: Error) => {
    console.error(`[agentmesh] Redis ${label}: ${err.message}`);
  });
}

function attachSubListeners(s: Redis): void {
  if (subListenersAttached) return;
  subListenersAttached = true;
  s.on('message', (channel: string, message: string) => {
    const rawSet = rawChannelHandlers.get(channel);
    if (rawSet) {
      rawSet.forEach((h) => h(message));
    }
    const set = channelHandlers.get(channel);
    if (!set) return;
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const ev = reviveMeshEvent(parsed);
      set.forEach((h) => h(ev));
    } catch (e) {
      throw new MeshBusError('Failed to deserialise mesh event', e);
    }
  });
  s.on('pmessage', (pattern: string, channel: string, message: string) => {
    const set = patternHandlers.get(pattern);
    if (!set) return;
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>;
      const ev = reviveMeshEvent(parsed);
      set.forEach((h) => h(ev, channel));
      meshEventBusListeners.forEach((fn) => {
        try {
          fn(ev);
        } catch {
          /* ignore */
        }
      });
    } catch (e) {
      throw new MeshBusError('Failed to deserialise mesh event (pattern)', e);
    }
  });
}

function ensureClients(): { pub: Redis; sub: Redis } {
  if (!pub || !sub) {
    try {
      const url = getRedisUrl();
      pub = new Redis(url, { maxRetriesPerRequest: null });
      sub = new Redis(url, { maxRetriesPerRequest: null });
      attachRedisErrorLogging(pub, 'publisher');
      attachRedisErrorLogging(sub, 'subscriber');
      attachSubListeners(sub);
    } catch (e) {
      throw new MeshBusError('Failed to create Redis clients', e);
    }
  }
  return { pub: pub!, sub: sub! };
}

function reviveMeshEvent(raw: Record<string, unknown>): MeshEvent {
  return {
    id: String(raw.id),
    topic: String(raw.topic),
    sourceAgentId: String(raw.sourceAgentId),
    payload: (raw.payload as Record<string, unknown>) ?? {},
    timestamp: new Date(String(raw.timestamp)),
    ttl: raw.ttl === undefined || raw.ttl === null ? undefined : Number(raw.ttl),
  };
}

function serialiseEvent(event: MeshEvent): string {
  return JSON.stringify({
    ...event,
    timestamp:
      event.timestamp instanceof Date
        ? event.timestamp.toISOString()
        : event.timestamp,
  });
}

export async function publish(topic: string, event: MeshEvent): Promise<void> {
  try {
    const { pub: p } = ensureClients();
    const channel = `mesh:events:${topic}`;
    await p.publish(channel, serialiseEvent(event));
    meshEventLocalListeners.forEach((fn) => {
      try {
        fn(event);
      } catch {
        /* ignore listener errors */
      }
    });
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError(`publish failed for topic ${topic}`, e);
  }
}

export function subscribeRawChannel(
  channel: string,
  handler: (message: string) => void,
): void {
  try {
    const { sub: s } = ensureClients();
    let set = rawChannelHandlers.get(channel);
    if (!set) {
      set = new Set();
      rawChannelHandlers.set(channel, set);
      void s.subscribe(channel).catch((err: unknown) => {
        throw new MeshBusError(`subscribe failed for ${channel}`, err);
      });
    }
    set.add(handler);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError(`subscribeRawChannel failed for ${channel}`, e);
  }
}

export function subscribe(
  topic: string,
  handler: (event: MeshEvent) => void,
): void {
  try {
    const { sub: s } = ensureClients();
    const channel = `mesh:events:${topic}`;
    let set = channelHandlers.get(channel);
    if (!set) {
      set = new Set();
      channelHandlers.set(channel, set);
      void s.subscribe(channel).catch((err: unknown) => {
        throw new MeshBusError(`subscribe failed for ${topic}`, err);
      });
    }
    set.add(handler);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError(`subscribe failed for topic ${topic}`, e);
  }
}

export function subscribePattern(
  pattern: string,
  handler: (event: MeshEvent, channel: string) => void,
): void {
  try {
    const { sub: s } = ensureClients();
    let set = patternHandlers.get(pattern);
    if (!set) {
      set = new Set();
      patternHandlers.set(pattern, set);
      void s.psubscribe(pattern).catch((err: unknown) => {
        throw new MeshBusError(`psubscribe failed for ${pattern}`, err);
      });
    }
    set.add(handler);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError(`subscribePattern failed for ${pattern}`, e);
  }
}

export async function setAgentStatus(
  agentId: string,
  status: string,
  ttlSeconds = 30,
): Promise<void> {
  try {
    const { pub: p } = ensureClients();
    await p.hset(AGENTS_HASH, agentId, status);
    await p.set(`${HEARTBEAT_PREFIX}${agentId}`, '1', 'EX', ttlSeconds);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError(`setAgentStatus failed for ${agentId}`, e);
  }
}

export async function getAgentStatuses(): Promise<Record<string, string>> {
  try {
    const { pub: p } = ensureClients();
    return await p.hgetall(AGENTS_HASH);
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('getAgentStatuses failed', e);
  }
}

export async function setRoutedMarker(eventId: string, ttlSeconds = 60): Promise<void> {
  try {
    const { pub: p } = ensureClients();
    await p.set(`mesh:routed:${eventId}`, '1', 'EX', ttlSeconds);
    await p.publish(
      'mesh:dashboard:routed',
      JSON.stringify({ type: 'routed', eventId }),
    );
  } catch (e) {
    if (e instanceof MeshBusError) throw e;
    throw new MeshBusError('setRoutedMarker failed', e);
  }
}

export async function disconnectBus(): Promise<void> {
  channelHandlers.clear();
  rawChannelHandlers.clear();
  patternHandlers.clear();
  subListenersAttached = false;
  await Promise.all([pub?.quit(), sub?.quit()]);
  pub = null;
  sub = null;
}
