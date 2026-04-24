import { v4 as uuidv4 } from 'uuid';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createAgentServer } from '@agentmesh/agent-base';
import type { MeshEvent, TaskRequest, TaskResult } from '@agentmesh/core/types';

const CORE = (
  process.env.CORE_URL ??
  (process.env.CORE_HOSTPORT
    ? `http://${process.env.CORE_HOSTPORT}`
    : 'http://localhost:3000')
).replace(/\/$/, '');
const PORT = Number(process.env.PORT ?? process.env.AGENT_PORT ?? 3001);
const AGENT_ID = process.env.AGENT_ID ?? uuidv4();
const PUBLIC_HOST = process.env.AGENT_PUBLIC_HOST ?? 'localhost';
const ENDPOINT =
  process.env.AGENT_ENDPOINT ?? `http://${PUBLIC_HOST}:${PORT}`;

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

function hasGmiConfig(): boolean {
  const base = process.env.GMI_API_BASE;
  const key = process.env.GMI_API_KEY;
  const model = process.env.GMI_MODEL;
  return Boolean(base && key && model) &&
    !base!.startsWith('PLACEHOLDER') &&
    !key!.startsWith('PLACEHOLDER') &&
    !model!.startsWith('PLACEHOLDER');
}

function gmiApiBase(): string {
  let b = process.env.GMI_API_BASE!.trim().replace(/\/+$/, '');
  if (b.toLowerCase().endsWith('/v1')) b = b.slice(0, -3).replace(/\/+$/, '');
  return b;
}

async function invokeGmi(system: string, user: string): Promise<string | null> {
  if (!hasGmiConfig()) {
    console.warn('[agent-research] GMI skipped: missing GMI_API_BASE, GMI_API_KEY, or GMI_MODEL');
    return null;
  }
  const base = gmiApiBase();
  const key = process.env.GMI_API_KEY!;
  const model = process.env.GMI_MODEL!;
  const url = `${base}/v1/chat/completions`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user.slice(0, 80_000) },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    });
    if (!res.ok) {
      const errBody = (await res.text()).slice(0, 400);
      console.warn(
        `[agent-research] GMI ${url} HTTP ${res.status}: ${errBody}`,
      );
      return null;
    }
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text || !String(text).trim()) {
      console.warn('[agent-research] GMI returned no message content');
      return null;
    }
    return String(text);
  } catch (e) {
    console.warn(
      `[agent-research] GMI error: ${e instanceof Error ? e.message : 'unknown'}`,
    );
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function invokeClaude(system: string, user: string): Promise<string> {
  const gmi = await invokeGmi(system, user);
  if (gmi && gmi.trim().length > 0) return gmi;

  const modelId = process.env.BEDROCK_MODEL_ID ?? '';
  if (
    !modelId ||
    modelId.startsWith('PLACEHOLDER') ||
    !process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID.startsWith('PLACEHOLDER')
  ) {
    return `[demo] Claude unavailable. Raw context (truncated): ${user.slice(0, 400)}…`;
  }
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system,
    messages: [
      { role: 'user', content: [{ type: 'text', text: user.slice(0, 80_000) }] },
    ],
  };
  const res = await bedrock.send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }),
  );
  const parsed = JSON.parse(Buffer.from(res.body!).toString('utf-8')) as {
    content: { type: string; text?: string }[];
  };
  const block = parsed.content?.[0];
  return block && 'text' in block ? String(block.text) : '';
}

async function runTinyfish(query: string, sourceUrl?: string): Promise<string> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key || key.startsWith('PLACEHOLDER')) {
    return `[demo] Tinyfish not configured. Query was: ${query}`;
  }
  // Use Tinyfish Automation API (SSE) so no agent ID is required.
  const res = await fetch(
    'https://agent.tinyfish.ai/v1/automation/run-sse',
    {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: sourceUrl || 'https://news.ycombinator.com/jobs',
        goal: query,
      }),
    },
  );
  if (!res.ok) return `[demo] Tinyfish error ${res.status}`;
  const text = await res.text();
  return text.slice(0, 20_000);
}

async function publishMeshEvent(event: MeshEvent): Promise<void> {
  await fetch(`${CORE}/events/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

function detectCompetitors(text: string): string[] {
  const names = ['OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Meta'];
  return names.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
}

void createAgentServer({
  port: PORT,
  coreUrl: CORE,
  registration: {
    id: AGENT_ID,
    name: 'Research Agent',
    description: 'Competitive intelligence and web research',
    capabilities: ['competitor-intel', 'summarise-news', 'web-research'],
    subscriptions: ['task.research-requested'],
    endpoint: ENDPOINT,
    healthEndpoint: `${ENDPOINT.replace(/\/$/, '')}/health`,
  },
  handlers: {
    onEvent: async (event: MeshEvent) => {
      console.log('research received event', event.topic);
    },
    onTask: async (task: TaskRequest): Promise<TaskResult> => {
      const started = Date.now();
      const cap = task.targetCapability;
      if (cap !== 'competitor-intel' && cap !== 'web-research') {
        return {
          taskId: task.id,
          agentId: AGENT_ID,
          output: { summary: 'Unsupported capability for research agent' },
          durationMs: Date.now() - started,
          status: 'error',
          error: 'unsupported',
        };
      }
      const query = String(task.input.query ?? '');
      const sourceUrl = String(task.input.sourceUrl ?? '');
      const scraped = await runTinyfish(query, sourceUrl || undefined);
      const summary = await invokeClaude(
        'You are a competitive intelligence analyst. Summarise the key findings concisely. Flag any deal risks.',
        scraped,
      );
      for (const competitor of detectCompetitors(summary + scraped)) {
        await publishMeshEvent({
          id: uuidv4(),
          topic: 'competitor.mentioned',
          sourceAgentId: AGENT_ID,
          payload: { competitor, query },
          timestamp: new Date(),
        });
      }
      return {
        taskId: task.id,
        agentId: AGENT_ID,
        output: { summary },
        durationMs: Date.now() - started,
        status: 'success',
      };
    },
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
