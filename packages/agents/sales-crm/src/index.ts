import { v4 as uuidv4 } from 'uuid';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createAgentServer } from '@agentmesh/agent-base';
import type { MeshEvent, TaskRequest, TaskResult } from '@agentmesh/core/types';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.AGENT_PORT ?? 3002);
const AGENT_ID = process.env.AGENT_ID ?? uuidv4();
const PUBLIC_HOST = process.env.AGENT_PUBLIC_HOST ?? 'localhost';
const ENDPOINT =
  process.env.AGENT_ENDPOINT ?? `http://${PUBLIC_HOST}:${PORT}`;

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

type Deal = {
  name: string;
  value: number;
  stage: string;
  stack: string[];
};

const deals: Deal[] = [
  {
    name: 'Acme Analytics',
    value: 120000,
    stage: 'negotiation',
    stack: ['OpenAI', 'Snowflake'],
  },
  {
    name: 'Globex Retail',
    value: 85000,
    stage: 'proposal',
    stack: ['Anthropic', 'Databricks'],
  },
  {
    name: 'Initech Platform',
    value: 40000,
    stage: 'discovery',
    stack: ['Google', 'BigQuery'],
  },
  {
    name: 'Umbrella Health',
    value: 220000,
    stage: 'closed-won',
    stack: ['Microsoft', 'Azure OpenAI'],
  },
  {
    name: 'Soylent Foods',
    value: 60000,
    stage: 'negotiation',
    stack: ['Meta', 'Segment'],
  },
];

async function invokeClaude(prompt: string): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? '';
  if (
    !modelId ||
    modelId.startsWith('PLACEHOLDER') ||
    !process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID.startsWith('PLACEHOLDER')
  ) {
    return `[demo] Claude unavailable. Heuristic: ${prompt.slice(0, 400)}`;
  }
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: [{ type: 'text', text: prompt.slice(0, 80_000) }] },
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
  return parsed.content?.[0]?.text ?? '';
}

async function publishMeshEvent(event: MeshEvent): Promise<void> {
  await fetch(`${CORE}/events/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
}

async function analyse(
  intel: string,
  competitor?: string,
): Promise<{ text: string; risk: boolean }> {
  const prompt = `Given these open deals (JSON) and this competitive intel, which deals are at risk and why?\nDeals: ${JSON.stringify(
    deals,
  )}\nIntel: ${intel}\nCompetitor hint: ${competitor ?? 'n/a'}`;
  const text = await invokeClaude(prompt);
  const risk =
    /risk|at-risk|concern|downgrade|churn/i.test(text) ||
    Boolean(competitor && deals.some((d) => d.stack.some((s) => s === competitor)));
  return { text, risk };
}

void createAgentServer({
  port: PORT,
  coreUrl: CORE,
  registration: {
    id: AGENT_ID,
    name: 'Sales CRM Agent',
    description: 'Pipeline and deal risk analysis',
    capabilities: ['deal-risk-analysis', 'pipeline-summary'],
    subscriptions: ['competitor.mentioned', 'task.crm-requested'],
    endpoint: ENDPOINT,
    healthEndpoint: `${ENDPOINT.replace(/\/$/, '')}/health`,
  },
  handlers: {
    onEvent: async (event: MeshEvent) => {
      if (event.topic === 'competitor.mentioned') {
        const competitor = String(
          (event.payload as { competitor?: string }).competitor ?? '',
        );
        const { text, risk } = await analyse(JSON.stringify(event.payload), competitor);
        if (risk) {
          await publishMeshEvent({
            id: uuidv4(),
            topic: 'deal.at-risk',
            sourceAgentId: AGENT_ID,
            payload: { competitor, analysis: text },
            timestamp: new Date(),
          });
        }
      }
    },
    onTask: async (task: TaskRequest): Promise<TaskResult> => {
      const started = Date.now();
      const { text, risk } = await analyse(JSON.stringify(task.input));
      if (risk) {
        await publishMeshEvent({
          id: uuidv4(),
          topic: 'deal.at-risk',
          sourceAgentId: AGENT_ID,
          payload: { analysis: text, taskId: task.id },
          timestamp: new Date(),
        });
      }
      return {
        taskId: task.id,
        agentId: AGENT_ID,
        output: { analysis: text },
        durationMs: Date.now() - started,
        status: 'success',
      };
    },
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
