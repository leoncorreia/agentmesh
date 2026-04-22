import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import { setTimeout as delay } from 'node:timers/promises';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const VOICE = (process.env.VOICE_URL ?? 'http://localhost:3004').replace(/\/$/, '');

function ts() {
  return chalk.gray(new Date().toISOString());
}

async function step(name: string, fn: () => Promise<void>) {
  console.log(`${ts()} ${chalk.cyan('▶')} ${name}`);
  await fn();
  console.log(`${ts()} ${chalk.green('✓')} ${name}`);
  await delay(2000);
}

async function waitForEvent(topic: string, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${CORE}/mesh/state`);
    const body = (await res.json()) as {
      recentEvents?: { topic: string }[];
    };
    if (body.recentEvents?.some((e) => e.topic === topic)) return;
    await delay(500);
  }
  throw new Error(`timeout waiting for ${topic}`);
}

async function main() {
  await step('Confirm three agents online', async () => {
    const res = await fetch(`${CORE}/agents`);
    if (!res.ok) throw new Error(await res.text());
    const agents = (await res.json()) as { status: string }[];
    const online = agents.filter((a) => a.status === 'online').length;
    if (online < 3) {
      console.log(
        chalk.yellow(
          `Only ${online} agents online — start dev stack or docker compose first.`,
        ),
      );
    }
  });

  await step('Dispatch competitor-intel research task', async () => {
    const res = await fetch(`${CORE}/tasks/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: randomUUID(),
        originAgentId: 'user',
        targetCapability: 'competitor-intel',
        input: { query: 'What has OpenAI announced this week?' },
        priority: 'normal',
        timeoutMs: 120_000,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const result = await res.json();
    console.log(chalk.dim(JSON.stringify(result).slice(0, 500)));
  });

  await step('Wait for competitor.mentioned event', async () => {
    await waitForEvent('competitor.mentioned');
  });

  await step('Wait for deal.at-risk event', async () => {
    await waitForEvent('deal.at-risk');
  });

  await step('Trigger morning briefing call (Vapi)', async () => {
    const res = await fetch(`${VOICE}/vapi/trigger-call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber: process.env.DEMO_PHONE ?? '+10000000000',
        message: 'AgentMesh automated demo briefing.',
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(chalk.yellow(`Voice trigger skipped: ${text}`));
    }
  });
}

void main().catch((err) => {
  console.error(chalk.red(err));
  process.exit(1);
});
