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

## Architecture (lean production stack)

```
┌──────────────────┐     REST + WebSocket      ┌─────────────────────┐
│    Dashboard     │ ───────────────────────► │       Core          │
│  React + Vite    │   VITE_CORE_URL / WS      │  Fastify            │
└──────────────────┘                           │  registry + dispatch │
                                               │  autonomy + cited.md │
┌──────────────────┐   POST /tasks (private)   │  Vapi trigger (HTTP) │
│ agent-research   │ ◄────────────────────────│                     │
│  (pserv)         │   register + heartbeat    └──────────┬──────────┘
└──────────────────┘                                      │
                                                            ▼
                                               ┌─────────────────────┐
                                               │ Render Key Value    │
                                               │ (Redis / Valkey 8)  │
                                               └─────────────────────┘
```

Local development can still run separate agent packages, voice, and gateway from `docker compose` / `npm run dev`; the **Render blueprint** in `render.yaml` targets **core + dashboard + Key Value + agent-research** only.

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
- `AUTONOMY_TASK_TIMEOUT_MS` — max wait for **core → remote agent** `/tasks` (default `240000`; Render blueprint sets `300000`).
- `AUTONOMY_SOURCES=<comma-separated URLs>`
- `AUTONOMY_BRIEFING_PHONE=<E.164>`
- `REDIS_URL` / `REDIS_MCP_URL` — full `redis://` or `rediss://` URL (not Postgres; not a bare path).
- **LLM:** `GMI_API_BASE`, `GMI_API_KEY`, `GMI_MODEL` (OpenAI-compatible) and/or **AWS Bedrock** credentials.
- **Web research:** `TINYFISH_API_KEY`
- **Voice on core:** `VAPI_*` keys; on Render, `core` calls Vapi directly (no separate voice service).
- Optional: `AGENT_MEMORY_API_URL`, `AGENT_MEMORY_API_KEY`, …

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

Blueprint `render.yaml` provisions:

- **Key Value** `agentmesh-kv` (Redis-compatible / Valkey) — **`databases:` is Postgres-only; do not use it for Redis.**
- **Web:** `core` (Fastify: mesh, autonomy, Vapi trigger, `cited.md`, reports).
- **Private service:** `agent-research` (real remote worker for `competitor-intel` / `web-research`).
- **Static:** `dashboard` (set `VITE_CORE_URL` + `VITE_CORE_WS_URL` to your public **core** URL).

### Steps

1. Push this repo to GitHub.
2. Render → **New +** → **Blueprint** → select repo (reads `render.yaml`).
3. Sync env: fill **`sync: false`** secrets in the dashboard (API keys, `AUTONOMY_SOURCES`, `AUTONOMY_BRIEFING_PHONE`, optional rails).
4. **`REDIS_URL`** on `core` must come from **Key Value** `agentmesh-kv` (Blueprint wires `fromService` → `connectionString`). Remove any old manual Postgres URL.
5. Deploy **core**, **agent-research**, **dashboard**; use **Clear build cache** if agents show stale `dist`.

### Validate (replace with your hostnames)

- `GET https://<core>/health` → `{"ok":true}`
- `GET https://<core>/agents` → includes **`render-research`** with `"status":"online"`
- `GET https://<core>/mesh/state` → agents + `recentEvents`
- `GET https://<core>/reports/latest` → `citedMarkdown` + snapshot
- Dashboard: open static URL with **`VITE_CORE_URL`** pointing at **core**

## Redis AI integrations

- Runtime memory integration: `docs/redis-agent-stack.md`
- MCP server setup for Redis tooling in MCP-compatible clients: `docs/redis-agent-stack.md`

## Registering a custom agent

1. **POST** `{CORE_URL}/agents/register` with JSON body: `id`, `name`, `description`, `capabilities`, `subscriptions`, `endpoint` (base URL for invoke), `healthEndpoint`.  
2. **POST** `{CORE_URL}/agents/:id/heartbeat` every ~15s while the process is healthy.  
3. Implement **POST** `{endpoint}/events` to accept routed `MeshEvent` payloads.  
4. Implement **POST** `{endpoint}/tasks` to accept `TaskRequest` and return `TaskResult`.  
5. **DELETE** `{CORE_URL}/agents/:id` when shutting down permanently.

## Demo script (local)

With Core, Redis, agents, and optional Voice running:

```bash
npm run demo
```

The script prints timestamped steps, waits for mesh events, and may attempt a Vapi outbound call (skipped if Vapi is not configured).

**Production demo path:** use the **dashboard** → **Settings** (autonomy config + **Run now**), **Events** (`task.remote.completed` / autonomy topics), and **`GET /reports/latest`** on **core**.

---

## Hackathon submission & demo (~3 minutes)

### What you are submitting (one paragraph you can paste)

**AgentMesh** is a **deployed** autonomous system: **core** runs an **always-on autonomy loop** over **live URLs**, **dispatches** `competitor-intel` to a **real separate `agent-research` service** (with **Tinyfish** + **GMI**/Bedrock), runs **in-process CRM/code** paths when needed, **publishes mesh events** on **Render Key Value (Redis/Valkey)**, **appends auditable `cited.md`**, optionally hits **monetization rails** (x402 / MPP / CDP / agentic.market), and can **place a Vapi** outbound briefing. **Dashboard** is the live control plane (agents, events, autonomy settings).

### Sponsor tools (pick 3+ that are true for your live demo)

| Sponsor | Role in this repo |
|--------|-------------------|
| **Redis / Render Key Value** | Registry, pub/sub bus, orchestration state |
| **Tinyfish** | Live web automation (`run-sse`) before LLM summary |
| **Vapi** | Outbound voice briefing from autonomy (`/vapi/trigger-call` on core) |
| **GMI Cloud** | OpenAI-compatible chat completions (primary LLM path when env set) |
| **AWS Bedrock** | Optional Claude path when credentials set |
| **WunderGraph** | Optional sponsor signal ingestion (`sponsors.ts` / autonomy) |
| **Chainguard** | Hardened images in Dockerfiles (optional local/CI Docker path) |

### Done in repo (nothing else required for “code complete”)

- Lean **Render** blueprint, **Key Value** Redis URL wiring, **core** + **agent-research** + **dashboard**.
- Autonomy, **`cited.md`**, payments abstraction, **remote task** events in feed, **GMI** compatibility (`max_completion_tokens`), timeouts for remote tasks.

### You must do (cannot be automated from here)

1. **Official hackathon form** — open the link from organizers (Discord / email / Devpost); we do not have your portal credentials.
2. **Submit fields** — typically: **GitHub repo URL**, **live demo URLs** (core + dashboard), **2–3 sentence description**, **video link** if required, **team / rules checkbox**.
3. **Shipables.dev** (if required by brief) — sign in with GitHub → **install a sponsor skill** → **publish this project as a skill** → paste the **Shipables / skill URL** into the submission.
4. **Senso `cited.md`** (only if brief mandates *their* network) — follow [senso.ai/cited-md](https://senso.ai/cited-md) and [docs.senso.ai](https://docs.senso.ai/docs/hello-world); otherwise **`cited.md` + `/reports/latest`** already satisfy “publish output” for many judges.
5. **Render secrets** — confirm non-placeholder: `TINYFISH_API_KEY`, `GMI_*` or Bedrock, `VAPI_*`, `AUTONOMY_SOURCES`, optional pay-rail URLs; **`REDIS_URL`** from Key Value only.
6. **Vapi assistant** — first message / prompt so the call **reads the briefing**, not a generic greeting.
7. **Optional screen recording** — 2–3 min: dashboard agents → Settings **Run now** → Events (`task.remote.completed`) → browser tab **`/reports/latest`** → mention sponsor row above.

### If something breaks during the live demo

Keep **`/health`**, **`/agents`**, and a **pre-captured** `/reports/latest` or Events tab open in another tab; narrate the **architecture** and **sponsor integrations** while you recover.

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

- **GMI Cloud** — OpenAI-compatible inference when `GMI_API_*` is set (research + core local agents).  
- **AWS** — Bedrock Claude as optional reasoning path.  
- **WunderGraph** — Optional sponsor signals for autonomy (`fetchWundergraphSignals`).  
- **Ghost / TigerData** — Optional content APIs via env template.  
- **Nexla** — Optional payload transform in `transformer.ts`.  
- **Redis / Render Key Value** — Pub/sub, registry, heartbeats (production: Valkey-compatible).  
- **Akash** — Optional decentralised deployment (`infra/k8s/agentmesh.sdl.yml`).  
- **Tinyfish** — Live web runs before LLM synthesis.  
- **Chainguard** — Hardened Node images in Dockerfiles.  
- **Vapi** — Outbound calls from **core** (`/vapi/trigger-call`); separate `packages/voice` exists for full-stack compose.  
- **Insforge** — Reserved in `.env.example` for extensions.
