import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentRegistration,
  MeshEvent,
  MeshState,
  TaskRequest,
  TaskResult,
} from './types.js';
import type { WebSocket } from 'ws';
import { publish, onMeshEventFromBus, subscribeRawChannel } from './bus.js';
import {
  registerAgent,
  deregisterAgent,
  heartbeat,
  getAllAgents,
  getAgent,
  findByCapability,
  startRegistryOfflineSweep,
} from './registry.js';
import { startRouter } from './router.js';
import { transformPayload } from './transformer.js';
import { AutonomyController } from './autonomy.js';
import { localAgentRegistry, runLocalTask } from './localAgents.js';
import { getSponsorStatus } from './sponsors.js';

const recentEvents: MeshEvent[] = [];
const MAX_EVENTS = 50;
const activeTasks: TaskRequest[] = [];

const sockets = new Set<WebSocket>();

let meshHooksInstalled = false;
let autonomyController: AutonomyController | null = null;
const REDIS_OP_TIMEOUT_MS = Number(process.env.REDIS_OP_TIMEOUT_MS ?? 1500);

async function withTimeout<T>(
  op: Promise<T>,
  fallback: T,
  timeoutMs = REDIS_OP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      op,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pushEvent(ev: MeshEvent): void {
  recentEvents.unshift(ev);
  if (recentEvents.length > MAX_EVENTS) recentEvents.pop();
}

function broadcast(obj: unknown): void {
  const msg = JSON.stringify(obj);
  for (const s of sockets) {
    if (s.readyState === 1) s.send(msg);
  }
}

async function buildMeshState(): Promise<MeshState> {
  const agents = await withTimeout(getAllAgents(), []);
  const merged = [...agents];
  for (const local of localAgentRegistry) {
    if (!merged.some((a) => a.id === local.id)) merged.push(local);
  }
  return {
    agents: merged,
    recentEvents: [...recentEvents],
    activeTasks: [...activeTasks],
  };
}

async function dispatchTask(req: TaskRequest): Promise<TaskResult> {
  const started = Date.now();
  const candidates = await withTimeout(findByCapability(req.targetCapability), []);
  const online = candidates.filter((a) => a.status === 'online');
  if (online.length > 0) {
    online.sort(
      (a, b) => new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime(),
    );
    const agent = online[0]!;
    activeTasks.push(req);
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), req.timeoutMs);
      const res = await fetch(`${agent.endpoint.replace(/\/$/, '')}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ac.signal,
      });
      clearTimeout(t);
      const raw = (await res.json()) as TaskResult;
      const output = await transformPayload(
        raw.output,
        agent.id,
        req.originAgentId === 'user' ? 'user' : String(req.originAgentId),
      );
      const result = { ...raw, output, durationMs: Date.now() - started };
      // Remote agents do not run runLocalTask's publish callback — surface work in the dashboard feed.
      const done: MeshEvent = {
        id: uuidv4(),
        topic: 'task.remote.completed',
        sourceAgentId: agent.id,
        payload: {
          taskId: req.id,
          targetCapability: req.targetCapability,
          status: result.status,
          agentName: agent.name,
        },
        timestamp: new Date(),
      };
      pushEvent(done);
      broadcast({ type: 'event', data: done });
      try {
        await withTimeout(publish(done.topic, done), undefined, 1200);
      } catch {
        /* best-effort bus */
      }
      return result;
    } catch (e) {
      const failed: MeshEvent = {
        id: uuidv4(),
        topic: 'task.remote.failed',
        sourceAgentId: agent.id,
        payload: {
          taskId: req.id,
          targetCapability: req.targetCapability,
          error: e instanceof Error ? e.message : 'dispatch failed',
        },
        timestamp: new Date(),
      };
      pushEvent(failed);
      broadcast({ type: 'event', data: failed });
      try {
        await withTimeout(publish(failed.topic, failed), undefined, 1200);
      } catch {
        /* best-effort bus */
      }
      return {
        taskId: req.id,
        agentId: agent.id,
        output: {},
        durationMs: Date.now() - started,
        status: 'timeout',
        error: e instanceof Error ? e.message : 'dispatch failed',
      };
    } finally {
      const idx = activeTasks.findIndex((t) => t.id === req.id);
      if (idx >= 0) activeTasks.splice(idx, 1);
    }
  }

  const local = await runLocalTask(req, async (topic, event) => {
    pushEvent(event);
    broadcast({ type: 'event', data: event });
    try {
      await withTimeout(publish(topic, event), undefined, 1200);
    } catch {
      /* best-effort publish */
    }
  });
  if (local) {
    const output = await transformPayload(
      local.output,
      local.agentId,
      req.originAgentId === 'user' ? 'user' : String(req.originAgentId),
    );
    return { ...local, output, durationMs: Date.now() - started };
  }

  return {
    taskId: req.id,
    agentId: '',
    output: {},
    durationMs: Date.now() - started,
    status: 'error',
    error: 'No online or local agent for capability',
  };
}

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: { title: 'AgentMesh Core', version: '0.1.0' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(websocket);

  app.get('/health', async () => ({ ok: true }));
  app.get('/autonomy/status', async () => {
    return autonomyController?.getStatus() ?? { enabled: false };
  });
  app.get('/autonomy/config', async () => {
    return autonomyController?.getConfig() ?? { enabled: false };
  });
  app.post('/autonomy/config', async (request) => {
    if (!autonomyController) return { enabled: false };
    const patch = request.body as {
      enabled?: boolean;
      intervalSeconds?: number;
      briefingPhone?: string;
      sources?: string[];
    };
    return autonomyController.updateConfig(patch);
  });
  app.get('/sponsors/status', async () => {
    return getSponsorStatus();
  });
  app.post('/autonomy/run-now', async () => {
    if (!autonomyController) return { enabled: false };
    return autonomyController.runNow();
  });
  app.get('/reports/latest', async () => {
    const filePath = resolve(process.cwd(), 'cited.md');
    let cited = '';
    try {
      await access(filePath, constants.F_OK);
      cited = await readFile(filePath, 'utf-8');
    } catch {
      cited = '';
    }
    return {
      generatedAt: new Date().toISOString(),
      lastAutonomyStatus: autonomyController?.getStatus() ?? { enabled: false },
      recentEvents: recentEvents.slice(0, 20),
      citedMarkdown: cited,
    };
  });

  app.post('/agents/register', async (request) => {
    const body = request.body as Omit<
      AgentRegistration,
      'registeredAt' | 'lastSeen' | 'status'
    >;
    const reg = await registerAgent(body);
    broadcast({ type: 'agent_status', data: reg });
    return reg;
  });

  app.delete('/agents/:id', async (request) => {
    const { id } = request.params as { id: string };
    await deregisterAgent(id);
    broadcast({ type: 'agent_status', data: { id, status: 'offline' } });
    return { ok: true };
  });

  app.post('/agents/:id/heartbeat', async (request) => {
    const { id } = request.params as { id: string };
    await heartbeat(id);
    const a = await getAgent(id);
    if (a) broadcast({ type: 'agent_status', data: a });
    return { ok: true };
  });

  app.get('/agents', async () => {
    const remote = await withTimeout(getAllAgents(), []);
    const merged = [...remote];
    for (const local of localAgentRegistry) {
      if (!merged.some((a) => a.id === local.id)) merged.push(local);
    }
    return merged;
  });

  app.get('/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const a = await getAgent(id);
    if (!a) return reply.code(404).send({ error: 'not found' });
    return a;
  });

  app.post('/events/publish', async (request) => {
    const body = request.body as Partial<MeshEvent> & {
      topic: string;
      sourceAgentId: string;
      payload: Record<string, unknown>;
    };
    const event: MeshEvent = {
      id: body.id ?? uuidv4(),
      topic: body.topic,
      sourceAgentId: body.sourceAgentId,
      payload: body.payload ?? {},
      timestamp: body.timestamp ? new Date(body.timestamp) : new Date(),
      ttl: body.ttl,
    };
    pushEvent(event);
    broadcast({ type: 'event', data: event });
    try {
      await withTimeout(publish(event.topic, event), undefined, 1200);
    } catch {
      /* non-fatal */
    }
    return { ok: true };
  });

  app.post('/vapi/trigger-call', async (request, reply) => {
    const key = process.env.VAPI_API_KEY;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    if (
      !key ||
      key.startsWith('PLACEHOLDER') ||
      !phoneNumberId ||
      !assistantId
    ) {
      return reply.code(503).send({ error: 'Vapi not configured' });
    }
    const { phoneNumber, message } = request.body as {
      phoneNumber: string;
      message?: string;
    };
    const res = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumberId,
        assistantId,
        customer: { number: phoneNumber },
        assistantOverrides: message ? { firstMessage: message } : undefined,
      }),
    });
    const text = await res.text();
    if (!res.ok) return reply.code(502).send({ error: text });
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  });

  app.post('/tasks/dispatch', async (request) => {
    const reqBody = request.body as TaskRequest;
    if (!reqBody.id) reqBody.id = uuidv4();
    return dispatchTask(reqBody);
  });

  app.get('/mesh/state', async () => buildMeshState());

  app.get('/ws', { websocket: true }, (socket, _req) => {
    sockets.add(socket);
    void buildMeshState().then((state) => {
      socket.send(JSON.stringify(state));
    });
    socket.on('close', () => sockets.delete(socket));
  });

  return app;
}

export async function start(): Promise<void> {
  if (!meshHooksInstalled) {
    meshHooksInstalled = true;
    startRegistryOfflineSweep();
    startRouter();
    onMeshEventFromBus((ev) => {
      pushEvent(ev);
      broadcast({ type: 'event', data: ev });
    });
    subscribeRawChannel('mesh:dashboard:routed', () => {
      void buildMeshState().then((state) =>
        broadcast({ type: 'agent_status', data: state.agents }),
      );
    });
    autonomyController = new AutonomyController({
      dispatchTask,
      publishEvent: publish,
    });
    autonomyController.start();
  }

  const app = await buildServer();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
}
