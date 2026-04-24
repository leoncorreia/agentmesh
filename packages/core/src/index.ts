import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
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

const recentEvents: MeshEvent[] = [];
const MAX_EVENTS = 50;
const activeTasks: TaskRequest[] = [];

const sockets = new Set<WebSocket>();

let meshHooksInstalled = false;
let autonomyController: AutonomyController | null = null;

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
  const agents = await getAllAgents();
  return {
    agents,
    recentEvents: [...recentEvents],
    activeTasks: [...activeTasks],
  };
}

async function dispatchTask(req: TaskRequest): Promise<TaskResult> {
  const started = Date.now();
  const candidates = await findByCapability(req.targetCapability);
  const online = candidates.filter((a) => a.status === 'online');
  if (online.length === 0) {
    return {
      taskId: req.id,
      agentId: '',
      output: {},
      durationMs: Date.now() - started,
      status: 'error',
      error: 'No online agent for capability',
    };
  }
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
    return { ...raw, output, durationMs: Date.now() - started };
  } catch (e) {
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
  app.post('/autonomy/run-now', async () => {
    if (!autonomyController) return { enabled: false };
    return autonomyController.runNow();
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
    return getAllAgents();
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
    await publish(event.topic, event);
    return { ok: true };
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
