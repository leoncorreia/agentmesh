import Fastify from 'fastify';
import type { AgentRegistration, MeshEvent, TaskRequest, TaskResult } from '@agentmesh/core/types';

export interface AgentHandlers {
  onEvent?: (event: MeshEvent) => Promise<void> | void;
  onTask?: (task: TaskRequest) => Promise<TaskResult>;
}

export interface AgentServerOptions {
  port: number;
  coreUrl: string;
  registration: Omit<AgentRegistration, 'registeredAt' | 'lastSeen' | 'status'>;
  handlers: AgentHandlers;
}

export async function createAgentServer(opts: AgentServerOptions): Promise<void> {
  const core = opts.coreUrl.replace(/\/$/, '');
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ ok: true }));

  app.post('/events', async (request) => {
    const event = request.body as MeshEvent;
    if (opts.handlers.onEvent) await opts.handlers.onEvent(event);
    return { ok: true };
  });

  app.post('/tasks', async (request, reply) => {
    const task = request.body as TaskRequest;
    if (!opts.handlers.onTask) {
      return reply.code(501).send({ error: 'no task handler' });
    }
    return opts.handlers.onTask(task);
  });

  async function register(): Promise<void> {
    const res = await fetch(`${core}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.registration),
    });
    if (!res.ok) {
      throw new Error(`register failed: ${res.status} ${await res.text()}`);
    }
  }

  async function beat(): Promise<void> {
    await fetch(`${core}/agents/${opts.registration.id}/heartbeat`, {
      method: 'POST',
    });
  }

  await register();
  const interval = setInterval(() => {
    void beat();
  }, 15_000);

  app.addHook('onClose', async () => {
    clearInterval(interval);
  });

  await app.listen({ port: opts.port, host: '0.0.0.0' });
}
