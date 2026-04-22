import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Redis } from 'ioredis';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.VOICE_PORT ?? 3004);
const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'anthropic.claude-3-5-sonnet-20241022-v2:0';

let redis: Redis | null = null;
function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url || url.startsWith('PLACEHOLDER')) return null;
  if (!redis) redis = new Redis(url);
  return redis;
}

const queryMeshTool = {
  name: 'query_mesh',
  description: 'Query the AgentMesh for intel, deal risks, or code issues',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language question',
      },
    },
    required: ['query'],
  },
};

async function dispatch(capability: string, query: string) {
  const res = await fetch(`${CORE}/tasks/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      originAgentId: 'user',
      targetCapability: capability,
      input: { query },
      priority: 'normal',
      timeoutMs: 60_000,
    }),
  });
  if (!res.ok) return `error:${res.status}`;
  const data = (await res.json()) as { output?: Record<string, unknown> };
  return JSON.stringify(data.output ?? data);
}

const app = Fastify({ logger: true });

app.post('/vapi/webhook', async (request, reply) => {
  const body = request.body as {
    message?: { type?: string; functionCall?: { name?: string; parameters?: { query?: string } } };
    call?: { id?: string };
  };
  const message = body.message;
  if (!message?.type) return reply.code(400).send({ error: 'missing message' });

  if (message.type === 'assistant-request') {
    return {
      assistant: {
        firstMessage: 'AgentMesh ready. What would you like to know?',
        model: { provider: 'aws-bedrock', model: MODEL_ID },
        voice: { provider: '11labs', voiceId: 'rachel' },
        functions: [queryMeshTool],
      },
    };
  }

  if (
    message.type === 'function-call' &&
    message.functionCall?.name === 'query_mesh'
  ) {
    const query = String(message.functionCall.parameters?.query ?? '');
    const [intel, deals] = await Promise.all([
      dispatch('competitor-intel', query),
      dispatch('deal-risk-analysis', query),
    ]);
    const combinedSummary = `Intel: ${intel}\nDeals: ${deals}`;
    return { result: combinedSummary };
  }

  if (message.type === 'end-of-call-report') {
    const r = getRedis();
    const callId = (body as { call?: { id?: string } }).call?.id ?? 'unknown';
    if (r) {
      await r.set(
        `mesh:voice:transcript:${callId}`,
        JSON.stringify(body),
        'EX',
        86_400,
      );
    }
    return { ok: true };
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
      assistantOverrides: message
        ? { firstMessage: message }
        : undefined,
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

app.get('/health', async () => ({ ok: true }));

void app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  console.log(`voice listening on ${PORT}`);
});
