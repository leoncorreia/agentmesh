# AgentMesh

AgentMesh is the **nervous system for AI agents** inside an organisation: a real-time orchestration layer where independent agents discover each other, delegate work, and share outcomes over a central Redis pub/sub mesh. It is the coordination plane that keeps a fleet of autonomous assistants aligned without tight coupling.

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

5. Or run the full stack with Docker:

   ```bash
   docker compose up --build
   ```

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
