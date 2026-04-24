# Redis Agent Stack Integration

This project supports both:

- **Redis Agent Memory Server** for long-term memory used by autonomous runs
- **Redis MCP Server** for natural-language operations over Redis from MCP-capable clients

## 1) Redis Agent Memory Server (runtime memory)

Reference:
- https://github.com/redis/agent-memory-server

Quick start via Docker:

```bash
docker run -p 8000:8000 \
  -e REDIS_URL=redis://localhost:6379 \
  -e OPENAI_API_KEY=your-key \
  redislabs/agent-memory-server:latest \
  agent-memory api --host 0.0.0.0 --port 8000 --task-backend=asyncio
```

Then set env vars for AgentMesh core:

```bash
AGENT_MEMORY_API_URL=http://localhost:8000
AGENT_MEMORY_API_KEY=your_optional_api_key
AGENT_MEMORY_USER_ID=agentmesh
AGENT_MEMORY_SESSION_ID=autonomy
AGENT_MEMORY_LIMIT=5
```

AgentMesh will:

- search previous memories before each autonomy cycle
- write cycle summaries back to memory after each run

## 2) Redis MCP Server (developer/ops MCP tooling)

References:
- https://github.com/redis/mcp-redis
- https://redis.io/docs/latest/integrate/redis-mcp/

Recommended MCP config uses `uvx`:

```json
{
  "servers": {
    "redis": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "-qq",
        "--from",
        "redis-mcp-server@latest",
        "redis-mcp-server",
        "--url",
        "redis://localhost:6379/0"
      ]
    }
  }
}
```

This repo includes an example at:

- `.vscode/mcp.json`

Update the URL to match your Redis environment (including `rediss://` for TLS if needed).
