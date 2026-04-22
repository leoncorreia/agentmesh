import { v4 as uuidv4 } from 'uuid';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createAgentServer } from '@agentmesh/agent-base';
import type { MeshEvent, TaskRequest, TaskResult } from '@agentmesh/core/types';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.AGENT_PORT ?? 3003);
const AGENT_ID = process.env.AGENT_ID ?? uuidv4();
const PUBLIC_HOST = process.env.AGENT_PUBLIC_HOST ?? 'localhost';
const ENDPOINT =
  process.env.AGENT_ENDPOINT ?? `http://${PUBLIC_HOST}:${PORT}`;

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

async function reviewDiff(diff: string): Promise<{ text: string; high: boolean }> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? '';
  const prompt = `You are a senior engineer. List security vulnerabilities and bug patterns in this diff. Be brief and specific.\n\n${diff.slice(0, 60_000)}`;
  if (
    !modelId ||
    modelId.startsWith('PLACEHOLDER') ||
    !process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID.startsWith('PLACEHOLDER')
  ) {
    const high = /password|eval\(|innerHTML/i.test(diff);
    return {
      text: `[demo] Claude unavailable. Heuristic review. high=${high}`,
      high,
    };
  }
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: [{ type: 'text', text: prompt }] },
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
    content: { text?: string }[];
  };
  const text = parsed.content?.[0]?.text ?? '';
  const high =
    /critical|high severity|sql injection|remote code|rce/i.test(text) ||
    /CRITICAL|HIGH:/i.test(text);
  return { text, high };
}

async function publishMeshEvent(event: MeshEvent): Promise<void> {
  await fetch(`${CORE}/events/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

void createAgentServer({
  port: PORT,
  coreUrl: CORE,
  registration: {
    id: AGENT_ID,
    name: 'Code Review Agent',
    description: 'Static review and PR summaries',
    capabilities: ['bug-pattern-detection', 'pr-summary'],
    subscriptions: ['task.code-review-requested'],
    endpoint: ENDPOINT,
    healthEndpoint: `${ENDPOINT.replace(/\/$/, '')}/health`,
  },
  handlers: {
    onEvent: async () => {},
    onTask: async (task: TaskRequest): Promise<TaskResult> => {
      const started = Date.now();
      const diff = String(task.input.diff ?? '');
      const { text, high } = await reviewDiff(diff);
      if (high) {
        await publishMeshEvent({
          id: uuidv4(),
          topic: 'code.critical-bug',
          sourceAgentId: AGENT_ID,
          payload: { taskId: task.id, findings: text },
          timestamp: new Date(),
        });
      }
      return {
        taskId: task.id,
        agentId: AGENT_ID,
        output: { findings: text },
        durationMs: Date.now() - started,
        status: 'success',
      };
    },
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
