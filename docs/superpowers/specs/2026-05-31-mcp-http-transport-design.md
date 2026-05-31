# MCP HTTP Transport for Mission Control

**Date:** 2026-05-31  
**Status:** Approved  
**Task:** [#58](http://127.0.0.1:3001) — MCP HTTP/SSE transport — expose mc-mcp-server via container port  

---

## Problem

`mc-mcp-server.cjs` is stdio-only. Agents must have the file on their local filesystem and spawn it as a child process. Remote agents (cloud codex, pi, future LAN agents) cannot connect to Mission Control's tool registry without host filesystem access.

## Goal

Expose Mission Control's tool registry as an MCP endpoint at `POST /api/mcp` so any agent can connect via URL:

```json
{
  "mcpServers": {
    "mission-control": {
      "url": "http://<mc-host>:3001/api/mcp",
      "headers": { "x-api-key": "<agent-key>" }
    }
  }
}
```

No new ports, no new containers. Stdio transport preserved unchanged for local agents.

---

## Architecture

```
Agent (Claude Code / codex / gemini / copilot)
  │
  │  POST https://<mc-host>:3001/api/mcp
  │  x-api-key: <agent-key>
  │
  ▼
Next.js App Router  (/api/mcp/route.ts)
  │
  ├── 1. Auth: requireRole(request, 'viewer') → resolve user + role
  ├── 2. buildMcpTools(server, role) → register role-appropriate tools only
  ├── 3. McpServer + StreamableHTTPServerTransport (stateless per-request)
  └── 4. transport.handleRequest(request) → Response

src/lib/mcp-tools.ts
  └── Tool definitions call src/lib/db.ts functions directly (no HTTP round-trip)

scripts/mc-mcp-server.cjs
  └── Unchanged — stdio transport for local agents
```

### Transport

**MCP Streamable HTTP** (`@modelcontextprotocol/sdk` — `StreamableHTTPServerTransport`).

- Single `POST /api/mcp` endpoint handles all MCP operations
- Returns JSON for simple requests, SSE stream for streaming responses
- Uses Web API `Request`/`Response` — compatible with Next.js App Router
- **Stateless** (`sessionIdGenerator: undefined`) — new transport per request, safe for Next.js serverless model

Legacy SSE transport (separate GET + POST) is explicitly excluded — Streamable HTTP is the current MCP standard and all current agent clients support it.

---

## Components

### New files

**`src/app/api/mcp/route.ts`** (~25 lines)
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { requireRole } from '@/lib/auth'
import { buildMcpTools } from '@/lib/mcp-tools'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const server = new McpServer({ name: 'mission-control', version: '1.0.0' })
  buildMcpTools(server, auth.user.role)

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)
  return transport.handleRequest(request)
}
```

**`src/lib/mcp-tools.ts`** — role-gated tool registry

Tool signatures below show representative examples. The implementation plan will enumerate all tools by mapping them from `mc-mcp-server.cjs`'s tool registry (~56 tools total).

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import * as db from '@/lib/db'

export function buildMcpTools(server: McpServer, role: 'viewer' | 'operator' | 'admin') {
  // --- viewer tools (always registered — representative sample) ---
  server.tool('mc_tasks_list', { status: z.string().optional() }, async ({ status }) => ({
    content: [{ type: 'text', text: JSON.stringify(db.getTasks({ status })) }]
  }))
  server.tool('mc_tasks_get', { id: z.number() }, ...)
  server.tool('mc_agents_list', {}, ...)
  server.tool('mc_status_overview', {}, ...)
  // Full tool list enumerated in implementation plan

  if (role === 'operator' || role === 'admin') {
    // --- operator tools (representative sample) ---
    server.tool('mc_tasks_create', { title: z.string(), description: z.string().optional() }, ...)
    server.tool('mc_tasks_update', { id: z.number(), status: z.string().optional() }, ...)
    server.tool('mc_comments_add', { taskId: z.number(), content: z.string() }, ...)
    server.tool('mc_agents_heartbeat', { id: z.number() }, ...)
    // Full operator tool list in implementation plan
  }

  if (role === 'admin') {
    // --- admin tools (representative sample) ---
    server.tool('mc_agents_delete', { id: z.number() }, ...)
    // Full admin tool list in implementation plan
  }
}
```

### Modified files

**`package.json`** — add dependency:
```json
"@modelcontextprotocol/sdk": "^1.x"
```

### Unchanged

- `scripts/mc-mcp-server.cjs` — stdio transport, local agents
- `docker-compose.yml` — no new ports needed

---

## Role Scoping

| Role | Tool access |
|---|---|
| `viewer` | Read-only: tasks list/get, agents list/get, status, comments list, memory read |
| `operator` | All viewer tools + create/update tasks, add comments, heartbeat, memory write, soul write |
| `admin` | All operator tools + delete agents, manage API keys |

Tools for higher roles are **never registered** in the MCP manifest for a lower-role key — they structurally cannot be called.

---

## Error Avoidance

| Risk | Avoidance by design |
|---|---|
| Wrong tool called for role | Higher-role tools never registered → not in manifest, impossible to call |
| Invalid tool input | Zod schemas on all parameters — invalid input rejected at schema boundary |
| Unexpected DB shape | Handlers call typed lib functions — return shapes are compile-time known |
| Mutating non-existent resource | Handlers check existence first, return structured "not found" content, never throw |
| Double-submit / duplicate | Ops designed idempotent — updating an already-updated task is a no-op |
| Unauthenticated access | Auth resolves before McpServer is instantiated — server object never created for invalid key |

---

## Testing

**Unit** (`src/lib/mcp-tools.test.ts`):
- `buildMcpTools(server, 'viewer')` → tools list contains zero write tools
- `buildMcpTools(server, 'operator')` → includes `mc_tasks_create`
- Zod rejects malformed inputs at schema level
- Typed DB mock confirms handlers receive and return expected shapes

**Integration** (`tests/mcp-endpoint.spec.ts`):
- `POST /api/mcp` no key → 401
- `POST /api/mcp` viewer key + `tools/list` → only read tools in manifest
- `POST /api/mcp` operator key + `tools/call mc_tasks_create` → task created
- `POST /api/mcp` viewer key + `tools/call mc_tasks_create` → method not found (by design, not error)

**Smoke test**: `claude mcp add mission-control -- <url>` → `mc_tasks_list` in Claude Code session → result returned.

---

## Out of Scope

- Sessions / stateful transport (YAGNI — stateless covers all agent use cases)
- WebSocket transport
- Legacy SSE GET endpoint
- Rate limiting (beyond existing MC middleware)
- New container ports or docker-compose changes

---

## Agent Config Examples

**Claude Code** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "mission-control": {
      "url": "http://127.0.0.1:3001/api/mcp",
      "headers": { "x-api-key": "<key>" }
    }
  }
}
```

**Codex** (`.mcp.json` or `config.toml` — check codex docs for exact format):
```json
{
  "mcpServers": {
    "mission-control": {
      "url": "http://127.0.0.1:3001/api/mcp",
      "headers": { "x-api-key": "<key>" }
    }
  }
}
```

**Gemini** (`~/.gemini/config/mcp_config.json`):
```json
{
  "servers": [{
    "name": "mission-control",
    "url": "http://127.0.0.1:3001/api/mcp",
    "headers": { "x-api-key": "<key>" }
  }]
}
```
