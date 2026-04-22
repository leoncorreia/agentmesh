import { GraphQLClient, gql } from 'graphql-request';

const client = new GraphQLClient('/gql', {
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
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}
