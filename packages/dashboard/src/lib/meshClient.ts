function env(name: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  return v && v.trim().length > 0 ? v : undefined;
}

const coreBase = env('VITE_CORE_URL') ?? window.location.origin;
const voiceBase = env('VITE_VOICE_URL') ?? window.location.origin;
const wsOverride = env('VITE_CORE_WS_URL');

export async function fetchMeshState(): Promise<Record<string, unknown>> {
  const res = await fetch(`${coreBase.replace(/\/$/, '')}/mesh/state`);
  if (!res.ok) throw new Error(`mesh-state failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function fetchAgents(): Promise<unknown[]> {
  const res = await fetch(`${coreBase.replace(/\/$/, '')}/agents`);
  if (!res.ok) throw new Error(`agents failed: ${res.status}`);
  return (await res.json()) as unknown[];
}

export type LatestReportsPayload = {
  generatedAt: string;
  lastAutonomyStatus: Record<string, unknown>;
  recentEvents: unknown[];
  citedMarkdown: string;
};

export async function fetchLatestReports(): Promise<LatestReportsPayload> {
  const res = await fetch(`${coreBase.replace(/\/$/, '')}/reports/latest`);
  if (!res.ok) throw new Error(`reports/latest failed: ${res.status}`);
  return (await res.json()) as LatestReportsPayload;
}

export function coreWsUrl(): string {
  if (wsOverride) return wsOverride;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const base = coreBase.replace(/^http/, 'ws').replace(/^https/, 'wss');
  if (base.startsWith('ws://') || base.startsWith('wss://')) {
    return `${base.replace(/\/$/, '')}/ws`;
  }
  return `${proto}://${window.location.host}/ws`;
}

export function coreUrl(path: string): string {
  return `${coreBase.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function voiceUrl(path: string): string {
  return `${voiceBase.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
