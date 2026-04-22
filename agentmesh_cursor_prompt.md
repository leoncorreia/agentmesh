# AgentMesh — Cursor Build Prompt

You are building **AgentMesh**: a real-time AI agent orchestration layer that lets
independent AI agents discover each other, delegate tasks, and share results through
a central pub/sub event bus. Think of it as air-traffic control for an organisation's
fleet of AI agents.

Work through this document top-to-bottom. Complete every section before moving on.
Where you see `PLACEHOLDER_*`, leave that value in a `.env` file with a clear comment
— it will be filled in on the day.

---

## 1. Repository layout

```
agentmesh/
├── .env.example            # all PLACEHOLDER_ values with comments
├── docker-compose.yml      # Redis, API server, demo agents
├── README.md
│
├── packages/
│   ├── core/               # AgentMesh orchestration engine (Node.js / TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── registry.ts         # agent registration & capability index
│   │   │   ├── router.ts           # event routing logic
│   │   │   ├── bus.ts              # Redis pub/sub wrapper
│   │   │   ├── transformer.ts      # Nexla-style schema normalisation
│   │   │   └── types.ts
│   │   └── package.json
│   │
│   ├── agents/             # Three demo agents (each is a standalone Node process)
│   │   ├── research/       # Research agent — uses web search + Claude on AWS Bedrock
│   │   ├── sales-crm/      # Sales CRM agent — synthesises deal pipeline data
│   │   └── code-review/    # Code review agent — flags bug patterns
│   │
│   ├── gateway/            # WunderGraph API gateway — unified REST + WS surface
│   │
│   ├── voice/              # Vapi webhook handler + outbound call trigger
│   │
│   └── dashboard/          # React + Vite frontend — live mesh visualiser
│
└── infra/
    ├── Dockerfile.core
    ├── Dockerfile.agent     # shared base — uses Chainguard cgr.dev/chainguard/node
    └── k8s/                 # optional Akash SDL manifests
```

---

## 2. Environment variables (`.env.example`)

```dotenv
# ── AWS / Bedrock ──────────────────────────────────────────────────────────────
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=PLACEHOLDER_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=PLACEHOLDER_AWS_SECRET_ACCESS_KEY
BEDROCK_MODEL_ID=anthropic.claude-3-5-sonnet-20241022-v2:0

# ── Redis (Redis Cloud or local) ───────────────────────────────────────────────
REDIS_URL=PLACEHOLDER_REDIS_URL
# e.g. redis://default:password@host:6380  (TLS in production)

# ── WunderGraph ────────────────────────────────────────────────────────────────
WUNDERGRAPH_API_URL=PLACEHOLDER_WUNDERGRAPH_API_URL
WUNDERGRAPH_API_KEY=PLACEHOLDER_WUNDERGRAPH_API_KEY

# ── Ghost / TigerData ──────────────────────────────────────────────────────────
GHOST_API_URL=PLACEHOLDER_GHOST_API_URL
GHOST_CONTENT_API_KEY=PLACEHOLDER_GHOST_CONTENT_API_KEY

# ── Nexla ──────────────────────────────────────────────────────────────────────
NEXLA_API_KEY=PLACEHOLDER_NEXLA_API_KEY
NEXLA_FLOW_ID=PLACEHOLDER_NEXLA_FLOW_ID

# ── Vapi ───────────────────────────────────────────────────────────────────────
VAPI_API_KEY=PLACEHOLDER_VAPI_API_KEY
VAPI_PHONE_NUMBER_ID=PLACEHOLDER_VAPI_PHONE_NUMBER_ID
VAPI_ASSISTANT_ID=PLACEHOLDER_VAPI_ASSISTANT_ID
# Webhook URL that Vapi will POST to (your public URL, e.g. via ngrok on hack day)
VAPI_WEBHOOK_URL=PLACEHOLDER_VAPI_WEBHOOK_URL

# ── Tinyfish ───────────────────────────────────────────────────────────────────
TINYFISH_API_KEY=PLACEHOLDER_TINYFISH_API_KEY
TINYFISH_AGENT_ID=PLACEHOLDER_TINYFISH_AGENT_ID

# ── Insforge ───────────────────────────────────────────────────────────────────
INSFORGE_API_KEY=PLACEHOLDER_INSFORGE_API_KEY
INSFORGE_PROJECT_ID=PLACEHOLDER_INSFORGE_PROJECT_ID

# ── Akash ──────────────────────────────────────────────────────────────────────
AKASH_NODE=PLACEHOLDER_AKASH_NODE_URL
AKASH_CERT=PLACEHOLDER_AKASH_CERT_PATH

# ── App ────────────────────────────────────────────────────────────────────────
PORT=3000
DASHBOARD_PORT=5173
NODE_ENV=development
JWT_SECRET=PLACEHOLDER_JWT_SECRET
```

---

## 3. Core package (`packages/core`)

### 3.1 `types.ts`

Define and export these TypeScript interfaces — every other package imports from here:

```ts
export interface AgentRegistration {
  id: string;                    // uuid v4
  name: string;
  description: string;
  capabilities: string[];        // e.g. ["summarise-sec-filings", "competitor-intel"]
  subscriptions: string[];       // event topics this agent listens to
  endpoint: string;              // HTTP URL the mesh calls to invoke this agent
  healthEndpoint: string;
  registeredAt: Date;
  lastSeen: Date;
  status: 'online' | 'offline' | 'busy';
}

export interface MeshEvent {
  id: string;
  topic: string;                 // e.g. "competitor.mentioned", "deal.at-risk"
  sourceAgentId: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  ttl?: number;                  // seconds; mesh drops after expiry
}

export interface TaskRequest {
  id: string;
  originAgentId: string | 'user';
  targetCapability: string;
  input: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high';
  timeoutMs: number;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  output: Record<string, unknown>;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  error?: string;
}

export interface MeshState {
  agents: AgentRegistration[];
  recentEvents: MeshEvent[];     // ring buffer, last 50
  activeTasks: TaskRequest[];
}
```

### 3.2 `bus.ts` — Redis pub/sub wrapper

- Use the `ioredis` package.
- Create two clients: one for publishing (`pub`), one for subscribing (`sub`).
- Connect to `process.env.REDIS_URL`.
- Export:
  - `publish(topic: string, event: MeshEvent): Promise<void>` — JSON-serialises and publishes to `mesh:events:{topic}`.
  - `subscribe(topic: string, handler: (event: MeshEvent) => void): void` — subscribes and deserialises.
  - `subscribePattern(pattern: string, handler: ...)` — uses `psubscribe` for wildcard topics like `mesh:events:competitor.*`.
  - `setAgentStatus(agentId, status, ttlSeconds = 30): Promise<void>` — writes to a Redis hash `mesh:agents` and sets a key `mesh:heartbeat:{agentId}` with TTL so offline detection is automatic.
  - `getAgentStatuses(): Promise<Record<string, string>>`.
- All errors must be caught and re-thrown as a typed `MeshBusError`.

### 3.3 `registry.ts` — agent registry

- Maintain agent registrations in Redis (`mesh:registry` hash, keyed by agent ID, value JSON).
- Export:
  - `registerAgent(reg: Omit<AgentRegistration, 'registeredAt' | 'lastSeen'>): Promise<AgentRegistration>`
  - `deregisterAgent(id: string): Promise<void>`
  - `heartbeat(id: string): Promise<void>` — refreshes `lastSeen` and sets status `online`.
  - `findByCapability(capability: string): Promise<AgentRegistration[]>`
  - `getAllAgents(): Promise<AgentRegistration[]>`
  - `getAgent(id: string): Promise<AgentRegistration | null>`
- Start a background interval every 10 s that marks agents `offline` if their heartbeat key has expired.

### 3.4 `router.ts` — event routing

- On startup, subscribe to `mesh:events:*` (wildcard pattern).
- When an event arrives:
  1. Persist it to Ghost/TigerData via REST (fire-and-forget): `POST {GHOST_API_URL}/ghost/api/admin/posts` with the event serialised as a post in the `mesh-events` tag. Use `GHOST_CONTENT_API_KEY` for auth. Wrap in try/catch — storage failure must not block routing.
  2. Look up all registered agents whose `subscriptions` array includes the event topic (or a wildcard pattern match).
  3. For each matched agent that is `online`, POST the event payload to `{agent.endpoint}/events` with a 5 s timeout.
  4. Emit a `mesh:routed:{eventId}` key in Redis (TTL 60 s) so the dashboard can track delivery.
- Export `startRouter(): void`.

### 3.5 `transformer.ts` — schema normalisation

- This module mimics Nexla's data transformation: it normalises the `payload` of an event from one agent's schema to the expected input schema of the receiving agent.
- Implement `transformPayload(payload: Record<string, unknown>, sourceAgentId: string, targetAgentId: string): Promise<Record<string, unknown>>`.
- On hack day, if the real Nexla API is available, call `POST {NEXLA_API_URL}/flows/{NEXLA_FLOW_ID}/transform` with the payload and source/target agent IDs.
- Fallback (used if Nexla key is not yet available): pass the payload through unchanged and log a warning.

### 3.6 `index.ts` — HTTP server

Use **Fastify** (not Express).

Expose these routes:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/agents/register` | Register an agent |
| DELETE | `/agents/:id` | Deregister |
| POST | `/agents/:id/heartbeat` | Heartbeat |
| GET | `/agents` | List all agents with status |
| GET | `/agents/:id` | Get one agent |
| POST | `/events/publish` | Publish a `MeshEvent` |
| POST | `/tasks/dispatch` | Dispatch a `TaskRequest` to best-matching agent |
| GET | `/mesh/state` | Full `MeshState` snapshot |
| GET | `/health` | `{ ok: true }` |

**WebSocket endpoint** (`/ws`): On connect, immediately send the current `MeshState`. Then, whenever a `mesh:events:*` Redis message or a `mesh:routed:*` key change arrives, broadcast a delta update packet `{ type: 'event' | 'agent_status', data: ... }` to all connected WS clients. This powers the live dashboard.

`POST /tasks/dispatch` logic:
1. Parse the `TaskRequest`.
2. Call `registry.findByCapability(req.targetCapability)`.
3. Filter to `online` agents; pick the one with the oldest `lastSeen` (least recently used, simple load balancing).
4. `POST {agent.endpoint}/tasks` with the request, timeout = `req.timeoutMs`.
5. Run `transformPayload` on the response before returning it.
6. Return the `TaskResult`.

Start `startRouter()` before the server begins listening.

---

## 4. Demo agents (`packages/agents/`)

Each agent is a small Fastify server. All three share the same structure — build a shared `agent-base` helper they can import.

### Agent base helper

On startup every agent must:
1. Call `POST {CORE_URL}/agents/register` with its registration payload.
2. Start a heartbeat interval every 15 s calling `POST {CORE_URL}/agents/:id/heartbeat`.
3. Expose `GET /health` → `{ ok: true }`.
4. Expose `POST /events` — receives a `MeshEvent`, processes it, optionally publishes new events back to the mesh.
5. Expose `POST /tasks` — receives a `TaskRequest`, runs the task, returns a `TaskResult`.

### 4.1 Research agent (`packages/agents/research/`)

**Capabilities**: `["competitor-intel", "summarise-news", "web-research"]`
**Subscriptions**: `["task.research-requested"]`

`POST /tasks` handler when `targetCapability` is `competitor-intel` or `web-research`:
1. Extract `query` from `input`.
2. Use the **Tinyfish** web agent API: `POST https://api.tinyfish.io/v1/agents/{TINYFISH_AGENT_ID}/run` with `{ task: query }`. Await the result (poll if async).
3. Feed the scraped content to **AWS Bedrock** (Claude via `@aws-sdk/client-bedrock-runtime`, `InvokeModelCommand`). System prompt: *"You are a competitive intelligence analyst. Summarise the key findings concisely. Flag any deal risks."* User message: the scraped content.
4. Parse Claude's response. Publish a `competitor.mentioned` event to the mesh if any competitor names are detected.
5. Return the summary as `TaskResult.output.summary`.

### 4.2 Sales CRM agent (`packages/agents/sales-crm/`)

**Capabilities**: `["deal-risk-analysis", "pipeline-summary"]`
**Subscriptions**: `["competitor.mentioned", "task.crm-requested"]`

Seed in-memory with 5 fake deals (name, value, stage, associated technology stack). On `competitor.mentioned` event or explicit task:
1. Cross-reference the competitor name against the deals' technology stacks.
2. Call Bedrock with a prompt: *"Given these open deals and this competitive intel, which deals are at risk and why?"*
3. Publish a `deal.at-risk` event if any risks are found.
4. Return the analysis as `TaskResult.output.analysis`.

### 4.3 Code review agent (`packages/agents/code-review/`)

**Capabilities**: `["bug-pattern-detection", "pr-summary"]`
**Subscriptions**: `["task.code-review-requested"]`

`POST /tasks` handler:
1. Accept `input.diff` (a string of unified diff).
2. Send to Bedrock: *"You are a senior engineer. List security vulnerabilities and bug patterns in this diff. Be brief and specific."*
3. If severity is `high`, publish a `code.critical-bug` event.
4. Return findings as `TaskResult.output.findings`.

---

## 5. Voice integration (`packages/voice/`)

Fastify server exposing Vapi webhook routes.

### `POST /vapi/webhook`

Vapi will POST a JSON body with a `message` field. Handle these message types:

- **`assistant-request`**: return the assistant config:
  ```json
  {
    "assistant": {
      "firstMessage": "AgentMesh ready. What would you like to know?",
      "model": { "provider": "aws-bedrock", "model": "BEDROCK_MODEL_ID" },
      "voice": { "provider": "11labs", "voiceId": "rachel" }
    }
  }
  ```
- **`function-call`** with `functionCall.name === "query_mesh"`: 
  1. Extract `parameters.query` (natural language question from the user).
  2. POST to `{CORE_URL}/tasks/dispatch` with `{ targetCapability: "competitor-intel", input: { query } }`.
  3. Also POST a second dispatch for `deal-risk-analysis` with the same query.
  4. Await both, combine results.
  5. Return `{ result: combinedSummary }` — Vapi will speak this aloud.
- **`end-of-call-report`**: log the transcript to Redis as `mesh:voice:transcript:{callId}`.

### `POST /vapi/trigger-call`

Accepts `{ phoneNumber, message }`. Uses the Vapi REST API to trigger an outbound call:
```
POST https://api.vapi.ai/call/phone
Authorization: Bearer VAPI_API_KEY
{ phoneNumberId, assistantId, customer: { number: phoneNumber } }
```
This is the "morning briefing" endpoint — call it from a cron or manually during the demo.

Expose the Vapi **function definition** for `query_mesh`:
```json
{
  "name": "query_mesh",
  "description": "Query the AgentMesh for intel, deal risks, or code issues",
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Natural language question" }
    },
    "required": ["query"]
  }
}
```
This function definition must be included in the assistant config returned by the `assistant-request` handler.

---

## 6. API gateway (`packages/gateway/`)

Use **WunderGraph** to expose a unified API surface over the mesh.

Create a WunderGraph project (`npx create-wundergraph-app`) configured to:
- Introspect the Core server's OpenAPI spec (auto-generate from Fastify routes using `@fastify/swagger`).
- Expose a single GraphQL endpoint at `/gql` that wraps:
  - `query agents` → `GET /agents`
  - `query meshState` → `GET /mesh/state`
  - `mutation publishEvent(input: MeshEventInput!)` → `POST /events/publish`
  - `mutation dispatchTask(input: TaskRequestInput!)` → `POST /tasks/dispatch`
- Enable **live queries** on `meshState` (polls every 2 s) so the dashboard can subscribe with `useQuery({ liveQuery: true })`.
- Add a `Authorization: Bearer {WUNDERGRAPH_API_KEY}` header to all upstream calls.

---

## 7. Dashboard (`packages/dashboard/`)

React + Vite + TypeScript. Use **Tailwind CSS** and **Framer Motion**.

### Visual design

- Dark theme. Background: `#080C10`. Accent: electric teal `#00FFD1`.
- Monospace font for data values (`JetBrains Mono`); clean sans for labels (`DM Sans`).
- The centrepiece is a **live mesh graph**: nodes = agents, edges = recent events between them. Use `@react-force-graph-2d` (canvas-based, handles hundreds of nodes).
  - Node colour: teal = online, amber = busy, gray = offline.
  - Edges pulse with a travelling light animation when an event is routed.
  - Clicking a node opens a side panel with that agent's registration details, last 10 events, and task history.
- Below the graph: a scrolling **event feed** (newest on top) with topic, source agent, timestamp, and payload preview. New events slide in with a subtle fade+translate animation.
- Top-right: four metric cards — Agents Online, Events/min, Active Tasks, Avg Latency (ms).
- Bottom bar: a voice command input. Typing and pressing Enter (or clicking the mic icon) calls `POST /vapi/trigger-call` and shows a pulsing "Listening…" indicator.

### Data fetching

- Primary: WunderGraph live query on `meshState` (auto-refreshes every 2 s).
- Secondary: native WebSocket to `ws://localhost:3000/ws` for sub-second event delivery.
- Merge both streams — WS events update local state immediately; WunderGraph acts as ground truth reconciliation.

### Pages / routes (React Router)

| Route | Description |
|-------|-------------|
| `/` | Main mesh graph + event feed |
| `/agents` | Table of all registered agents with status badges |
| `/agents/:id` | Agent detail: capabilities, subscriptions, task history |
| `/events` | Full event log with filtering by topic and agent |
| `/voice` | Voice command panel; shows live transcript from last call |
| `/settings` | Edit `.env`-style config (reads from `GET /mesh/state`, for demo only) |

---

## 8. Docker Compose (`docker-compose.yml`)

```yaml
version: '3.9'
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    command: redis-server --save "" --appendonly no

  core:
    build:
      context: .
      dockerfile: infra/Dockerfile.core
    ports: ['3000:3000']
    env_file: .env
    depends_on: [redis]

  agent-research:
    build:
      context: .
      dockerfile: infra/Dockerfile.agent
      args: { AGENT: research }
    env_file: .env
    environment:
      AGENT_PORT: 3001
      CORE_URL: http://core:3000
    depends_on: [core]

  agent-sales-crm:
    build:
      context: .
      dockerfile: infra/Dockerfile.agent
      args: { AGENT: sales-crm }
    env_file: .env
    environment:
      AGENT_PORT: 3002
      CORE_URL: http://core:3000
    depends_on: [core]

  agent-code-review:
    build:
      context: .
      dockerfile: infra/Dockerfile.agent
      args: { AGENT: code-review }
    env_file: .env
    environment:
      AGENT_PORT: 3003
      CORE_URL: http://core:3000
    depends_on: [core]

  voice:
    build:
      context: .
      dockerfile: infra/Dockerfile.core   # reuse same base
    command: node dist/voice/index.js
    ports: ['3004:3004']
    env_file: .env
    depends_on: [core]

  gateway:
    build:
      context: packages/gateway
    ports: ['9991:9991']
    env_file: .env
    depends_on: [core]

  dashboard:
    build:
      context: packages/dashboard
    ports: ['5173:5173']
    depends_on: [gateway]
```

---

## 9. Dockerfiles

### `infra/Dockerfile.core`

```dockerfile
FROM cgr.dev/chainguard/node:latest AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM cgr.dev/chainguard/node:latest
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/core/index.js"]
```

### `infra/Dockerfile.agent`

```dockerfile
FROM cgr.dev/chainguard/node:latest AS builder
ARG AGENT
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM cgr.dev/chainguard/node:latest
ARG AGENT
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD node dist/agents/${AGENT}/index.js
```

---

## 10. Akash deployment (optional, for demo scale)

Create `infra/k8s/agentmesh.sdl.yml` — an Akash SDL manifest that deploys the `core`, three agents, and `voice` services. Use the smallest GPU-enabled profile (`gpu: { units: 1 }`) on the `core` service. Use `PLACEHOLDER_AKASH_PROVIDER` for the provider address. This file is used if the team wants to demo running on decentralised compute during the presentation.

---

## 11. The demo script (hardcode these happy paths)

Implement a `demo/run-demo.ts` script that, when executed with `npx ts-node demo/run-demo.ts`, performs the following sequence automatically (with 2 s pauses between steps so the audience can follow on the dashboard):

1. Confirm all three agents are online via `GET /agents`.
2. Dispatch a task to the research agent: `{ targetCapability: "competitor-intel", input: { query: "What has OpenAI announced this week?" } }`.
3. The research agent publishes a `competitor.mentioned` event. Wait for it to appear in the event feed.
4. The sales CRM agent (subscribed to `competitor.mentioned`) automatically fires and publishes a `deal.at-risk` event. Wait for it.
5. Trigger a voice briefing via `POST /vapi/trigger-call` with the combined summary.
6. Print each step to stdout with timestamps and coloured output (`chalk`).

---

## 12. README

Write a `README.md` that includes:
- One-paragraph product description (use the "nervous system for AI agents" framing).
- Architecture diagram (ASCII, matching the component layout above).
- Prerequisites: Node 20+, Docker, a Redis instance.
- Setup: `cp .env.example .env` → fill in keys → `docker compose up`.
- How to register a custom agent (the four endpoints + heartbeat pattern).
- How to run the demo script.
- Sponsor credits section listing AWS, WunderGraph, Ghost/TigerData, Nexla, Redis, Akash, Tinyfish, Chainguard, Vapi, Insforge — one line each explaining the role they play.

---

## 13. Build & test

- Add a root `package.json` with workspaces pointing at all packages.
- TypeScript strict mode throughout (`"strict": true` in `tsconfig.json`).
- Add a `build` script that runs `tsc` for each package in dependency order.
- Add a `dev` script using `concurrently` to start core + all three agents + voice + dashboard in watch mode.
- Write at least **one integration test per package** using `vitest`. The core test must:
  - Spin up a real Redis instance (use `testcontainers`).
  - Register two mock agents.
  - Publish an event and assert it is received by the subscribed agent's mock endpoint.

---

## Execution order for Cursor

Work in this exact order to avoid circular dependency issues:

1. Root `package.json` + `tsconfig.json` + `.env.example`
2. `packages/core/src/types.ts`
3. `packages/core/src/bus.ts`
4. `packages/core/src/registry.ts`
5. `packages/core/src/transformer.ts`
6. `packages/core/src/router.ts`
7. `packages/core/src/index.ts` (Fastify server + WS)
8. Agent base helper
9. Each agent (research → sales-crm → code-review)
10. `packages/voice/`
11. `packages/gateway/`
12. `packages/dashboard/`
13. `docker-compose.yml` + Dockerfiles
14. `demo/run-demo.ts`
15. `README.md`
16. Tests

At each step, confirm the TypeScript compiles cleanly before moving on.
