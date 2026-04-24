import { GraphQLClient, gql } from 'graphql-request';

function env(name: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  return v && v.trim().length > 0 ? v : undefined;
}

const gatewayBase = env('VITE_GATEWAY_URL') ?? window.location.origin;
const coreBase = env('VITE_CORE_URL') ?? window.location.origin;
const voiceBase = env('VITE_VOICE_URL') ?? window.location.origin;
const wsOverride = env('VITE_CORE_WS_URL');

const client = new GraphQLClient(`${gatewayBase.replace(/\/$/, '')}/gql`, {
  headers: {},
});

const meshQuery = gql`
  query Mesh {
    meshState
  }
`;

const agentsQuery = gql`
  query Agents {
    agents
  }
`;

export async function fetchMeshState(): Promise<Record<string, unknown>> {
  const data = (await client.request(meshQuery)) as { meshState: unknown };
  return data.meshState as Record<string, unknown>;
}

export async function fetchAgents(): Promise<unknown[]> {
  const data = (await client.request(agentsQuery)) as { agents: unknown[] };
  return data.agents;
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
