import { randomUUID } from 'node:crypto';
import type { MeshEvent, TaskRequest, TaskResult } from './types.js';
import { appendCitedRun } from './cited.js';
import { executeMonetization } from './payments.js';
import { searchAutonomyMemory, writeAutonomyMemory } from './agentMemory.js';
import { fetchWundergraphSignals } from './sponsors.js';

export interface AutonomyStatus {
  enabled: boolean;
  running: boolean;
  intervalSeconds: number;
  runs: number;
  failures: number;
  lastRunAt?: string;
  lastSummary?: string;
  lastError?: string;
}

export interface AutonomyConfig {
  enabled: boolean;
  intervalSeconds: number;
  briefingPhone?: string;
  sources: string[];
}

type AutonomyDeps = {
  dispatchTask: (request: TaskRequest) => Promise<TaskResult>;
  publishEvent: (topic: string, event: MeshEvent) => Promise<void>;
};

function parseSources(): string[] {
  const configured = process.env.AUTONOMY_SOURCES;
  if (!configured || configured.startsWith('PLACEHOLDER')) {
    return [
      'https://news.ycombinator.com/jobs',
      'https://www.reuters.com/technology/',
    ];
  }
  return configured
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

async function fetchSourceSnippet(url: string): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AgentMesh-Autonomy/1.0' },
      signal: ac.signal,
    });
    const text = await res.text();
    return text.replace(/\s+/g, ' ').slice(0, 2500);
  } finally {
    clearTimeout(t);
  }
}

export class AutonomyController {
  private enabled: boolean;
  private intervalSeconds: number;
  private sources: string[];
  private briefingPhone?: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private runs = 0;
  private failures = 0;
  private lastRunAt?: string;
  private lastSummary?: string;
  private lastError?: string;

  constructor(private readonly deps: AutonomyDeps) {
    this.enabled = process.env.AUTONOMY_ENABLED !== 'false';
    this.intervalSeconds = Number(process.env.AUTONOMY_INTERVAL_SECONDS ?? 180);
    this.sources = parseSources();
    this.briefingPhone = process.env.AUTONOMY_BRIEFING_PHONE;
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    this.startTimer();
    void this.runCycle('startup');
  }

  private startTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.runCycle('interval');
    }, this.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus(): AutonomyStatus {
    return {
      enabled: this.enabled,
      running: this.running,
      intervalSeconds: this.intervalSeconds,
      runs: this.runs,
      failures: this.failures,
      lastRunAt: this.lastRunAt,
      lastSummary: this.lastSummary,
      lastError: this.lastError,
    };
  }

  getConfig(): AutonomyConfig {
    return {
      enabled: this.enabled,
      intervalSeconds: this.intervalSeconds,
      briefingPhone: this.briefingPhone,
      sources: [...this.sources],
    };
  }

  updateConfig(
    patch: Partial<AutonomyConfig>,
  ): { config: AutonomyConfig; status: AutonomyStatus } {
    if (typeof patch.enabled === 'boolean') {
      this.enabled = patch.enabled;
      if (!this.enabled) this.stop();
      else this.start();
    }
    if (
      typeof patch.intervalSeconds === 'number' &&
      Number.isFinite(patch.intervalSeconds)
    ) {
      this.intervalSeconds = Math.max(15, Math.floor(patch.intervalSeconds));
      if (this.enabled) this.startTimer();
    }
    if (typeof patch.briefingPhone === 'string') {
      this.briefingPhone = patch.briefingPhone.trim();
    }
    if (Array.isArray(patch.sources) && patch.sources.length > 0) {
      this.sources = patch.sources.map((x) => String(x).trim()).filter(Boolean);
    }
    return { config: this.getConfig(), status: this.getStatus() };
  }

  async runNow(): Promise<AutonomyStatus> {
    await this.runCycle('manual');
    return this.getStatus();
  }

  private formatVoiceBriefing(summary: string, actions: string[]): string {
    const clean = summary
      .replace(/\s+/g, ' ')
      .replace(/\[demo\][^.;!?]*/gi, '')
      .replace(/data:\s*\{[^}]+\}/gi, '')
      .replace(/timestamp[:=]\S+/gi, '')
      .trim();
    const short = clean.length > 280 ? `${clean.slice(0, 277)}...` : clean;
    const actionHint = actions.find((a) => /risk|competitor|monetization/i.test(a));
    if (short) {
      return `AgentMesh briefing. ${short}${actionHint ? ` Key action: ${actionHint}.` : ''}`;
    }
    return 'AgentMesh briefing. No critical new updates this cycle.';
  }

  private async runCycle(trigger: 'startup' | 'interval' | 'manual'): Promise<void> {
    if (!this.enabled || this.running) return;
    this.running = true;
    this.lastError = undefined;
    try {
      const gathered = await Promise.all(
        this.sources.map(async (url) => ({
          url,
          snippet: await fetchSourceSnippet(url),
        })),
      );
      const memoryUserId = process.env.AGENT_MEMORY_USER_ID ?? 'agentmesh';
      const memorySession = process.env.AGENT_MEMORY_SESSION_ID ?? 'autonomy';
      const memoryContext = await searchAutonomyMemory({
        text: 'Recent high-signal market, competitor, and deal-risk findings',
        userId: memoryUserId,
        sessionId: memorySession,
      });
      const wgSignals = await fetchWundergraphSignals(
        gathered.map((x) => x.url),
      );
      const query = [
        'Analyze these live web snippets and return actionable competitive intelligence.',
        ...(wgSignals.length > 0
          ? [
              'Additional sponsor-sourced signals from WunderGraph:',
              ...wgSignals.map((x) => `- ${x}`),
            ]
          : []),
        ...(memoryContext.length > 0
          ? [
              'Relevant memory context from previous cycles:',
              ...memoryContext.map((m) => `- ${m.text}`),
            ]
          : []),
        ...gathered.map((x) => `SOURCE ${x.url}\n${x.snippet}`),
      ].join('\n\n');

      const researchTask: TaskRequest = {
        id: randomUUID(),
        originAgentId: 'user',
        targetCapability: 'competitor-intel',
        input: {
          query,
          sourceUrl: gathered[0]?.url,
          citations: gathered.map((x) => x.url),
        },
        priority: 'high',
        timeoutMs: 120000,
      };
      const researchResult = await this.deps.dispatchTask(researchTask);
      const summary = String(researchResult.output.summary ?? '');

      const crmTask: TaskRequest = {
        id: randomUUID(),
        originAgentId: 'user',
        targetCapability: 'deal-risk-analysis',
        input: {
          query: `Given this intel, identify urgent deal risks and recommended actions.\n${summary}`,
          citations: gathered.map((x) => x.url),
        },
        priority: 'high',
        timeoutMs: 120000,
      };
      const crmResult = await this.deps.dispatchTask(crmTask);

      const monetization = await executeMonetization({
        summary: summary || JSON.stringify(crmResult.output).slice(0, 500),
        amountUsd: Number(process.env.AUTONOMY_MONETIZATION_AMOUNT_USD ?? 25),
        metadata: {
          trigger,
          sources: gathered.map((x) => x.url),
          researchTaskId: researchTask.id,
          crmTaskId: crmTask.id,
        },
      });

      const actions: string[] = [
        `Dispatched competitor-intel task (${researchResult.status})`,
        `Dispatched deal-risk-analysis task (${crmResult.status})`,
        ...(wgSignals.length > 0
          ? [`Ingested ${wgSignals.length} WunderGraph sponsor signals`]
          : []),
      ];
      for (const m of monetization) {
        actions.push(
          `Monetization via ${m.rail}: ${m.ok ? 'success' : 'failed'}${m.status ? ` (${m.status})` : ''}`,
        );
      }

      const voiceUrl =
        process.env.VOICE_URL ??
        (process.env.VOICE_HOSTPORT
          ? `http://${process.env.VOICE_HOSTPORT}`
          : undefined);
      const phone = this.briefingPhone ?? process.env.AUTONOMY_BRIEFING_PHONE;
      if (voiceUrl && phone && !voiceUrl.startsWith('PLACEHOLDER')) {
        try {
          const briefing = this.formatVoiceBriefing(summary, actions);
          await fetch(`${voiceUrl.replace(/\/$/, '')}/vapi/trigger-call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phoneNumber: phone,
              message: briefing,
            }),
          });
          actions.push('Triggered voice briefing call');
        } catch {
          actions.push('Voice briefing trigger failed');
        }
      }

      await this.deps.publishEvent('autonomy.cycle.completed', {
        id: randomUUID(),
        topic: 'autonomy.cycle.completed',
        sourceAgentId: 'agentmesh-autonomy',
        payload: {
          trigger,
          sources: gathered.map((x) => x.url),
          wundergraphSignals: wgSignals,
          research: researchResult.output,
          crm: crmResult.output,
          monetization,
          actions,
        },
        timestamp: new Date(),
      });

      await appendCitedRun({
        heading: `Autonomy cycle ${new Date().toISOString()}`,
        summary:
          summary ||
          'Autonomous cycle executed with live sources and downstream actions.',
        citations: gathered.map((x) => ({
          url: x.url,
          note: 'Live web source used in autonomous analysis',
        })),
        actions,
      });
      await writeAutonomyMemory({
        text:
          `Trigger=${trigger}; sources=${gathered.map((x) => x.url).join(', ')}; ` +
          `summary=${summary.slice(0, 800)}`,
        userId: memoryUserId,
        sessionId: memorySession,
        metadata: {
          trigger,
          sources: gathered.map((x) => x.url),
          actions,
          monetization,
        },
      });

      this.runs += 1;
      this.lastRunAt = new Date().toISOString();
      this.lastSummary =
        summary.slice(0, 300) ||
        JSON.stringify(crmResult.output).slice(0, 300) ||
        'Cycle completed';
    } catch (e) {
      this.failures += 1;
      this.lastError = e instanceof Error ? e.message : 'unknown autonomy failure';
    } finally {
      this.running = false;
    }
  }
}
