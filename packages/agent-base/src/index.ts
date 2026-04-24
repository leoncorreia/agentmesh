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

  // Render (and some load balancers) probe HEAD / or GET /; avoid noisy 404s.
  app.get('/', async () => ({ ok: true, role: 'agentmesh-agent' }));
  app.head('/', async (_, reply) => reply.code(204).send());

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

  async function registerWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      try {
        const res = await fetch(`${core}/agents/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(opts.registration),
        });
        if (!res.ok) {
          throw new Error(`register failed: ${res.status} ${await res.text()}`);
        }
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('register failed');
  }

  async function beat(): Promise<void> {
    await fetch(`${core}/agents/${opts.registration.id}/heartbeat`, {
      method: 'POST',
    });
  }

  // Hooks must be registered before listen() (Fastify requirement).
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  app.addHook('onClose', async () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
  });

  await app.listen({ port: opts.port, host: '0.0.0.0' });

  await registerWithRetry();
  heartbeatInterval = setInterval(() => {
    void beat();
  }, 15_000);
}
