import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { publish, disconnectBus } from './bus.js';
import { registerAgent, disconnectRegistry, stopRegistryOfflineSweep } from './registry.js';
import { startRouter, stopRouter } from './router.js';
import type { MeshEvent } from './types.js';

const redisUrl =
  process.env.AGENTMESH_TEST_REDIS_URL ??
  (process.env.REDIS_URL && !process.env.REDIS_URL.startsWith('PLACEHOLDER')
    ? process.env.REDIS_URL
    : null);

describe.skipIf(!redisUrl)('mesh router integration', () => {
  let httpServer!: Server;
  let mockPort = 0;
  let received: MeshEvent | null = null;

  beforeAll(async () => {
    process.env.REDIS_URL = redisUrl!;

    httpServer = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/events') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received = JSON.parse(body) as MeshEvent;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    mockPort = (httpServer.address() as { port: number }).port;

    await registerAgent({
      id: 'agent-alpha',
      name: 'Alpha',
      description: 'publisher',
      capabilities: ['noop'],
      subscriptions: [],
      endpoint: `http://127.0.0.1:${mockPort}`,
      healthEndpoint: `http://127.0.0.1:${mockPort}/health`,
    });

    await registerAgent({
      id: 'agent-beta',
      name: 'Beta',
      description: 'subscriber',
      capabilities: ['noop'],
      subscriptions: ['demo.topic'],
      endpoint: `http://127.0.0.1:${mockPort}`,
      healthEndpoint: `http://127.0.0.1:${mockPort}/health`,
    });

    startRouter();
  });

  afterAll(async () => {
    stopRouter();
    stopRegistryOfflineSweep();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await disconnectRegistry();
    await disconnectBus();
  });

  it('delivers published events to subscribed mock agent', async () => {
    const event: MeshEvent = {
      id: 'evt-1',
      topic: 'demo.topic',
      sourceAgentId: 'agent-alpha',
      payload: { hello: 'world' },
      timestamp: new Date(),
    };
    await publish('demo.topic', event);

    const deadline = Date.now() + 15_000;
    while (!received && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(received).not.toBeNull();
    expect(received!.topic).toBe('demo.topic');
    expect(received!.payload).toEqual({ hello: 'world' });
  });
});
