# AgentMesh

AgentMesh is the **nervous system for AI agents** inside an organisation: a real-time orchestration layer where independent agents discover each other, delegate work, and share outcomes over a central Redis pub/sub mesh. It is the coordination plane that keeps a fleet of autonomous assistants aligned without tight coupling.

## Autonomous mode (always-on)

AgentMesh can now run in an always-on autonomous loop:

- Monitors live web sources listed in `AUTONOMY_SOURCES`
- Dispatches real work to research + CRM agents
- Publishes orchestration events on the mesh
- Writes auditable run logs to `cited.md` with source citations
- Optionally triggers monetization rails (`x402`, `MPP`, `CDP`, `agentic.market`)
- Optionally triggers a voice briefing call through Vapi
- Optionally reads/writes long-term memory through Redis Agent Memory Server

## Architecture

```
                    ┌─────────────┐
                    │  Dashboard  │  React + Vite + WS
                    │  (live UI)  │
                    └──────┬──────┘
                           │ GraphQL /gql (2s mesh cache)
                    ┌──────▼──────┐
                    │   Gateway   │  GraphQL façade over Core
                    └──────┬──────┘
                           │ REST
┌──────────┐        ┌──────▼──────┐        ┌────────────┐
│  Agents  │◄──────►│    Core     │◄──────►│   Redis    │
│ research │ register│  Fastify   │ pub/sub│  event bus │
│ sales-crm│ heartbeat router    │        └────────────┘
│code-review│       │  registry   │
└──────────┘        └──────┬──────┘
                            │
                     ┌──────▼──────┐
                     │    Voice    │  Vapi webhooks + outbound
                     └─────────────┘
```

## Prerequisites

- **Node.js** 20 or newer  
- **Docker** (recommended for Redis and full stack)  
- A **Redis** instance (`REDIS_URL`)

### Python virtual environment (optional)

This repository is primarily **Node.js / TypeScript**. A Python **`venv`** is included for optional tooling (for example local automation or future Python-side utilities). It is listed in `.gitignore` so it is never committed.

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

## Setup

1. Copy environment template and fill in secrets (replace `PLACEHOLDER_*` values):

   ```bash
   cp .env.example .env
   ```

2. For local development, point `REDIS_URL` at Redis (e.g. `redis://localhost:6379` after `docker compose up redis`).

3. Install and build:

   ```bash
   npm install
   npm run build
   ```

4. Start everything in watch mode (requires Redis and keys as needed):

   ```bash
   npm run dev
   ```

### Key autonomous env vars

- `AUTONOMY_ENABLED=true`
- `AUTONOMY_INTERVAL_SECONDS=180`
- `AUTONOMY_SOURCES=<comma-separated URLs>`
- `AUTONOMY_BRIEFING_PHONE=<E.164>`
- `VOICE_URL=http://localhost:3004`
- `AGENT_MEMORY_API_URL=http://localhost:8000`

Monetization rails (optional):

- `X402_ENDPOINT`, `X402_API_KEY`
- `MPP_ENDPOINT`, `MPP_API_KEY`
- `CDP_ENDPOINT`, `CDP_API_KEY`
- `AGENTIC_MARKET_ENDPOINT`, `AGENTIC_MARKET_API_KEY`

Redis memory & MCP (optional):

- `AGENT_MEMORY_API_URL`, `AGENT_MEMORY_API_KEY`
- `AGENT_MEMORY_USER_ID`, `AGENT_MEMORY_SESSION_ID`, `AGENT_MEMORY_LIMIT`
- `REDIS_MCP_URL`

Audit output:

- `cited.md` is appended every autonomous cycle.

5. Or run the full stack with Docker:

   ```bash
   docker compose up --build
   ```

## Deploy to Render (production test)

This repository includes a Render Blueprint at `render.yaml` that provisions:

- Render Redis (`agentmesh-redis`)
- Core API
- Research, Sales CRM, and Code Review agents
- Voice service
- Gateway service
- Static dashboard site

### Steps

1. Push this repo to GitHub.
2. In Render, choose **New +** -> **Blueprint**.
3. Select your repo; Render reads `render.yaml`.
4. Fill required secret env vars in Render before first test:
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `TINYFISH_API_KEY`
   - `VAPI_API_KEY`
   - `VAPI_PHONE_NUMBER_ID`
   - `VAPI_ASSISTANT_ID`
   - optional: `AGENT_MEMORY_*`
   - optional: `GHOST_*`, `NEXLA_*`
5. Deploy all services.

### Validate in web environment

- `https://agentmesh-core.onrender.com/health`
- `https://agentmesh-gateway.onrender.com/gql`
- `https://agentmesh-voice.onrender.com/health`
- Dashboard: `https://agentmesh-dashboard.onrender.com`

If your Render service names differ from defaults, update URLs in `render.yaml` (`CORE_URL`, `AGENT_ENDPOINT`, `VITE_*` values) and redeploy.

## Redis AI integrations

- Runtime memory integration: `docs/redis-agent-stack.md`
- MCP server setup for Redis tooling in MCP-compatible clients: `docs/redis-agent-stack.md`

## Registering a custom agent

1. **POST** `{CORE_URL}/agents/register` with JSON body: `id`, `name`, `description`, `capabilities`, `subscriptions`, `endpoint` (base URL for invoke), `healthEndpoint`.  
2. **POST** `{CORE_URL}/agents/:id/heartbeat` every ~15s while the process is healthy.  
3. Implement **POST** `{endpoint}/events` to accept routed `MeshEvent` payloads.  
4. Implement **POST** `{endpoint}/tasks` to accept `TaskRequest` and return `TaskResult`.  
5. **DELETE** `{CORE_URL}/agents/:id` when shutting down permanently.

## Demo script

With Core, Redis, all three agents, and Voice running:

```bash
npm run demo
```

The script prints timestamped steps, waits for mesh events, and attempts a Vapi outbound call (skipped if Vapi is not configured).

## Tests

```bash
npm test
```

The **core** package includes an integration test that exercises Redis routing. It runs when a Redis URL is available:

```bash
set AGENTMESH_TEST_REDIS_URL=redis://127.0.0.1:6379
npm run test -w @agentmesh/core
```

If neither `AGENTMESH_TEST_REDIS_URL` nor a non-placeholder `REDIS_URL` is set, that suite is skipped so CI and laptops without Redis still get a green `npm test`.

## Sponsor credits

- **AWS** — Bedrock Claude for reasoning across research, CRM, and code-review agents.  
- **WunderGraph** — Original prompt target for a unified API; this repo ships a GraphQL gateway with the same operations and live-style `meshState` polling.  
- **Ghost / TigerData** — Durable event logging from the core router (best-effort, non-blocking).  
- **Nexla** — Optional payload normalisation between agent schemas.  
- **Redis** — Pub/sub backbone and registry/heartbeat storage.  
- **Akash** — Optional decentralised deployment (`infra/k8s/agentmesh.sdl.yml`).  
- **Tinyfish** — Web research agent for live scraping before LLM synthesis.  
- **Chainguard** — Hardened Node images in Dockerfiles.  
- **Vapi** — Voice surface (`packages/voice`) for phone and assistant workflows.  
- **Insforge** — Reserved for future mesh extensions per environment template.
