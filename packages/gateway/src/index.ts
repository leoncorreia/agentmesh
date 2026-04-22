/**
 * GraphQL façade over AgentMesh Core. Mirrors the WunderGraph operations
 * described in the product prompt (agents, meshState, publishEvent, dispatchTask).
 * Live meshState refresh is implemented with a 2s TTL cache to approximate
 * WunderGraph live queries.
 */
import { GraphQLJSON } from 'graphql-scalars';
import { createSchema, createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';

const CORE = (process.env.CORE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const PORT = Number(process.env.GATEWAY_PORT ?? 9991);
const API_KEY = process.env.WUNDERGRAPH_API_KEY ?? '';

let meshStateCache: { at: number; value: unknown } | null = null;
const MESH_TTL_MS = 2000;

async function upstream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (API_KEY && !API_KEY.startsWith('PLACEHOLDER')) {
    headers.set('Authorization', `Bearer ${API_KEY}`);
  }
  return fetch(`${CORE}${path}`, { ...init, headers });
}

const schema = createSchema({
  typeDefs: /* GraphQL */ `
    scalar JSON

    input MeshEventInput {
      id: String
      topic: String!
      sourceAgentId: String!
      payload: JSON!
      timestamp: String
      ttl: Int
    }

    input TaskRequestInput {
      id: String
      originAgentId: String!
      targetCapability: String!
      input: JSON!
      priority: String!
      timeoutMs: Int!
    }

    type Query {
      agents: JSON!
      meshState: JSON!
    }

    type Mutation {
      publishEvent(input: MeshEventInput!): JSON!
      dispatchTask(input: TaskRequestInput!): JSON!
    }
  `,
  resolvers: {
    JSON: GraphQLJSON,
    Query: {
      agents: async () => {
        const res = await upstream('/agents');
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      meshState: async () => {
        const now = Date.now();
        if (meshStateCache && now - meshStateCache.at < MESH_TTL_MS) {
          return meshStateCache.value;
        }
        const res = await upstream('/mesh/state');
        if (!res.ok) throw new Error(await res.text());
        const value = await res.json();
        meshStateCache = { at: now, value };
        return value;
      },
    },
    Mutation: {
      publishEvent: async (_: unknown, args: { input: Record<string, unknown> }) => {
        const res = await upstream('/events/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args.input),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
      dispatchTask: async (_: unknown, args: { input: Record<string, unknown> }) => {
        const res = await upstream('/tasks/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args.input),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
      },
    },
  },
});

const yoga = createYoga({ schema, graphqlEndpoint: '/gql' });

const server = createServer(yoga);
server.listen(PORT, () => {
  console.log(`gateway GraphQL at http://localhost:${PORT}/gql`);
});
