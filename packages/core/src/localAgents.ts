import { v4 as uuidv4 } from 'uuid';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { AgentRegistration, MeshEvent, TaskRequest, TaskResult } from './types.js';

const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
});

export const localAgentRegistry: AgentRegistration[] = [
  {
    id: 'local-research',
    name: 'Local Research Agent',
    description: 'In-process competitive intel and web research',
    capabilities: ['competitor-intel', 'web-research'],
    subscriptions: ['task.research-requested'],
    endpoint: 'inproc://local-research',
    healthEndpoint: 'inproc://local-research/health',
    registeredAt: new Date(),
    lastSeen: new Date(),
    status: 'online',
  },
  {
    id: 'local-sales-crm',
    name: 'Local Sales CRM Agent',
    description: 'In-process deal risk analysis',
    capabilities: ['deal-risk-analysis', 'pipeline-summary'],
    subscriptions: ['competitor.mentioned', 'task.crm-requested'],
    endpoint: 'inproc://local-sales-crm',
    healthEndpoint: 'inproc://local-sales-crm/health',
    registeredAt: new Date(),
    lastSeen: new Date(),
    status: 'online',
  },
  {
    id: 'local-code-review',
    name: 'Local Code Review Agent',
    description: 'In-process bug pattern detection',
    capabilities: ['bug-pattern-detection', 'pr-summary'],
    subscriptions: ['task.code-review-requested'],
    endpoint: 'inproc://local-code-review',
    healthEndpoint: 'inproc://local-code-review/health',
    registeredAt: new Date(),
    lastSeen: new Date(),
    status: 'online',
  },
];

async function invokeClaude(system: string, user: string): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID ?? '';
  if (
    !modelId ||
    modelId.startsWith('PLACEHOLDER') ||
    !process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID.startsWith('PLACEHOLDER')
  ) {
    return `[demo] Bedrock unavailable. Context: ${user.slice(0, 500)}`;
  }
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 900,
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
    content: { text?: string }[];
  };
  return parsed.content?.[0]?.text ?? '';
}

async function runTinyfish(query: string, sourceUrl?: string): Promise<string> {
  const key = process.env.TINYFISH_API_KEY;
  if (!key || key.startsWith('PLACEHOLDER')) {
    return `[demo] Tinyfish not configured. Query: ${query}`;
  }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch('https://agent.tinyfish.ai/v1/automation/run-sse', {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: sourceUrl || 'https://news.ycombinator.com/jobs',
        goal: query,
      }),
      signal: ac.signal,
    });
  } catch (e) {
    return `[demo] Tinyfish timeout/error: ${e instanceof Error ? e.message : 'request failed'}`;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) return `[demo] Tinyfish error ${res.status}`;
  const text = await res.text();
  return text.slice(0, 20_000);
}

export async function runLocalTask(
  req: TaskRequest,
  publishEvent: (topic: string, event: MeshEvent) => Promise<void>,
): Promise<TaskResult | null> {
  const started = Date.now();
  if (
    req.targetCapability !== 'competitor-intel' &&
    req.targetCapability !== 'web-research' &&
    req.targetCapability !== 'deal-risk-analysis' &&
    req.targetCapability !== 'pipeline-summary' &&
    req.targetCapability !== 'bug-pattern-detection' &&
    req.targetCapability !== 'pr-summary'
  ) {
    return null;
  }

  if (
    req.targetCapability === 'competitor-intel' ||
    req.targetCapability === 'web-research'
  ) {
    const query = String(req.input.query ?? '');
    const sourceUrl = String(req.input.sourceUrl ?? '');
    const scraped = await runTinyfish(query, sourceUrl || undefined);
    const summary = await invokeClaude(
      'You are a competitive intelligence analyst. Summarize critical findings and deal risks.',
      scraped,
    );
    for (const competitor of ['OpenAI', 'Anthropic', 'Google', 'Microsoft', 'Meta']) {
      if ((summary + scraped).toLowerCase().includes(competitor.toLowerCase())) {
        await publishEvent('competitor.mentioned', {
          id: uuidv4(),
          topic: 'competitor.mentioned',
          sourceAgentId: 'local-research',
          payload: { competitor, query },
          timestamp: new Date(),
        });
      }
    }
    return {
      taskId: req.id,
      agentId: 'local-research',
      output: { summary },
      durationMs: Date.now() - started,
      status: 'success',
    };
  }

  if (
    req.targetCapability === 'deal-risk-analysis' ||
    req.targetCapability === 'pipeline-summary'
  ) {
    const prompt = `Given this intel, identify deal risks and recommended actions:\n${JSON.stringify(req.input).slice(0, 25_000)}`;
    const analysis = await invokeClaude(
      'You are a sales risk analyst. Identify urgent risks and next actions.',
      prompt,
    );
    if (/risk|at-risk|concern|churn|downgrade/i.test(analysis)) {
      await publishEvent('deal.at-risk', {
        id: uuidv4(),
        topic: 'deal.at-risk',
        sourceAgentId: 'local-sales-crm',
        payload: { analysis, taskId: req.id },
        timestamp: new Date(),
      });
    }
    return {
      taskId: req.id,
      agentId: 'local-sales-crm',
      output: { analysis },
      durationMs: Date.now() - started,
      status: 'success',
    };
  }

  const diff = String(req.input.diff ?? req.input.query ?? '');
  const findings = await invokeClaude(
    'You are a senior engineer. Flag critical bug and security patterns.',
    diff.slice(0, 40_000),
  );
  if (/critical|high severity|sql injection|remote code|rce/i.test(findings)) {
    await publishEvent('code.critical-bug', {
      id: uuidv4(),
      topic: 'code.critical-bug',
      sourceAgentId: 'local-code-review',
      payload: { taskId: req.id, findings },
      timestamp: new Date(),
    });
  }
  return {
    taskId: req.id,
    agentId: 'local-code-review',
    output: { findings },
    durationMs: Date.now() - started,
    status: 'success',
  };
}
