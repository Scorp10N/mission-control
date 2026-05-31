# MCP Per-Agent API Keys — Design

**Date:** 2026-06-01  
**Task:** TASK-065  
**Status:** Implemented

## Problem

`POST /api/mcp` previously authenticated via a shared operator key (`x-api-key`). Multiple agents sharing one key cannot be:
- Individually revoked (revoking one kills all)
- Independently rate-limited
- Attributed in audit logs by agent identity

## Existing Infrastructure (already built)

| Component | Location | Notes |
|-----------|----------|-------|
| `agent_api_keys` table | migration `040_agent_api_keys` | key_hash, scopes, revoked_at, expires_at |
| `GET/POST/DELETE /api/agents/[id]/keys` | `src/app/api/agents/[id]/keys/route.ts` | Full CRUD for agent keys |
| Auth resolution | `src/lib/auth.ts` lines 503–555 | Sets `user.agent_id` + `user.agent_name` when agent key used |

## What Was Added (TASK-065)

### 1. `mcp_audit_log` table (migration `054_mcp_audit_log`)

Logs every MCP tool call with agent attribution:

```sql
CREATE TABLE mcp_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER,       -- null for shared-key requests
  agent_name TEXT,        -- null for shared-key requests
  username TEXT NOT NULL, -- e.g. "agent:copilot-cli" or "admin"
  tool_name TEXT,         -- e.g. "mc_list_tasks", null for non-tools/call requests
  workspace_id INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ok',  -- ok | rate_limited | auth_error
  called_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

### 2. Per-agent rate limiting (MCP route)

- Only applies to agent-scoped keys (when `user.agent_id` is set)
- Default: 120 calls/minute per agent (configurable via `MCP_RATE_LIMIT_PER_MINUTE` env)
- Uses sliding window: counts `mcp_audit_log` rows for `agent_id` in last 60 seconds
- Returns HTTP 429 when exceeded; logs the blocked attempt

### 3. `mc agents keys` CLI subcommand

```bash
mc agents keys list --id <agent_id_or_name>
mc agents keys create --id <agent_id> --name mcp-key [--scopes operator] [--expires-in-days 365]
mc agents keys revoke --id <agent_id> --key-id <key_id>
```

## How Agents Use Their Own Keys

### Initial setup (run once per agent)

```bash
# 1. Get the agent's numeric ID
AGENT_ID=$(mc agents list --json | python3 -c "
import json,sys
agents = json.load(sys.stdin)['data']['agents']
print(next(a['id'] for a in agents if a['name'] == 'copilot-cli'))
")

# 2. Create an agent-scoped MCP key (admin required)
mc agents keys create --id $AGENT_ID --name mcp-key --scopes operator

# 3. Copy the returned api_key value to ~/.copilot/mcp-config.json
```

### mcp-config.json (per-agent key)

```json
{
  "mcpServers": {
    "mission-control": {
      "type": "http",
      "url": "http://localhost:3001/api/mcp",
      "headers": {
        "x-api-key": "mca_<your-agent-key-here>"
      },
      "tools": ["*"]
    }
  }
}
```

### Scopes

| Scope | Grants |
|-------|--------|
| `viewer` | Read-only MCP tools |
| `operator` | Read + mutate MCP tools (recommended for agents) |
| `agent:self` | Heartbeat + memory for this agent only |

## Architecture Flow

```
Agent → POST /api/mcp (x-api-key: mca_xxx)
  └─ requireRole() → looks up agent_api_keys table
       → returns User { agent_id, agent_name, role: 'operator', ... }
  └─ parseMcpToolName() → reads request clone for tools/call tool name
  └─ checkRateLimit(agent_id) → sliding window check
  └─ logMcpCall(agent_id, tool_name, 'ok') → mcp_audit_log row
  └─ buildMcpTools + transport.handleRequest
```

## What Remains Shared (by design)

- Agents without individual keys still work via the global operator key
- The global key is not rate-limited or per-agent attributed (anonymous in audit log)
- Migration path: create keys for existing agents, update their configs

## Configuration

```bash
# Tune per-agent rate limit (default: 120/minute)
MCP_RATE_LIMIT_PER_MINUTE=60
```
