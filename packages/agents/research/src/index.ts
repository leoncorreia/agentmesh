import { v4 as uuidv4 } from 'uuid';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createAgentServer } from '@agentmesh/agent-base';
import type { MeshEvent, TaskRequest, TaskResult } from '@agentmesh/core/types';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.AGENT_PORT ?? 3001);
const AGENT_ID = process.env.AGENT_ID ?? uuidv4();
const PUBLIC_HOST = process.env.AGENT_PUBLIC_HOST ?? 'localhost';
const ENDPOINT =
  process.env.AGENT_ENDPOINT ?? `http://${PUBLIC_HOST}:${PORT}`;

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

async function invokeClaude(system: string, user: string): Promise<string> {
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

async function runTinyfish(query: string): Promise<string> {
  const key = process.env.TINYFISH_API_KEY;
  const agentId = process.env.TINYFISH_AGENT_ID;
  if (
    !key ||
    key.startsWith('PLACEHOLDER') ||
    !agentId ||
    agentId.startsWith('PLACEHOLDER')
  ) {
    return `[demo] Tinyfish not configured. Query was: ${query}`;
  }
  const res = await fetch(
    `https://api.tinyfish.io/v1/agents/${agentId}/run`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ task: query }),
    },
  );
  if (!res.ok) return `[demo] Tinyfish error ${res.status}`;
  const data = (await res.json()) as Record<string, unknown>;
  return JSON.stringify(data).slice(0, 20_000);
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
      const scraped = await runTinyfish(query);
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
