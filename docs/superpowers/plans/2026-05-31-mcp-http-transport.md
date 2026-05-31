# MCP HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/mcp` to Mission Control's Next.js App Router, exposing 49 tools via MCP Streamable HTTP with role-gated access.

**Architecture:** Single stateless endpoint; fresh `McpServer` + `StreamableHTTPServerTransport` per request with `try/finally` cleanup. Viewer tools use `getDatabase()` SQL directly; operator/admin mutation tools call MC's own REST API via `fetch` with the original request's API key header (preserves Aegis gates, GitHub sync, mentions).

**Tech Stack:** `@modelcontextprotocol/sdk ^1.9.0` (StreamableHTTPServerTransport), Next.js 15 App Router, better-sqlite3, Zod, Vitest

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `package.json` | modify | Add `@modelcontextprotocol/sdk` dependency |
| `src/app/api/mcp/route.ts` | create | Auth → build tools → handle request |
| `src/lib/mcp-tools.ts` | create | Role-gated tool registry, all 49 tools |
| `src/lib/__tests__/mcp-tools.test.ts` | create | Unit tests for tool registry |
| `src/app/api/mcp/__tests__/route.test.ts` | create | Integration tests for endpoint |

---

## Task 1: Install SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the MCP SDK**

```bash
cd ~/Projects/mission-control
pnpm add @modelcontextprotocol/sdk@^1.9.0
```

Expected: `package.json` updated, `node_modules/@modelcontextprotocol/sdk` present.

- [ ] **Step 2: Verify import paths exist**

```bash
node -e "require('@modelcontextprotocol/sdk/server/mcp.js'); console.log('McpServer OK')"
node -e "require('@modelcontextprotocol/sdk/server/streamableHttp.js'); console.log('StreamableHTTPServerTransport OK')"
```

Expected: both print `OK`. If not, check `node_modules/@modelcontextprotocol/sdk/dist/server/` for correct paths and adjust imports accordingly.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: add @modelcontextprotocol/sdk ^1.9.0"
```

---

## Task 2: Create `src/lib/mcp-tools.ts` — Viewer tools (agents, memory, knowledge)

**Files:**
- Create: `src/lib/mcp-tools.ts`

- [ ] **Step 1: Write failing unit test for viewer agent tools**

Create `src/lib/__tests__/mcp-tools.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Mock getDatabase
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    run: vi.fn().mockReturnValue({ lastInsertRowid: 1, changes: 1 }),
  })
}
vi.mock('@/lib/db', () => ({
  getDatabase: vi.fn(() => mockDb),
  db_helpers: { logActivity: vi.fn() }
}))

import { buildMcpTools } from '@/lib/mcp-tools'

describe('buildMcpTools', () => {
  let server: McpServer

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' })
    vi.clearAllMocks()
  })

  it('registers viewer agent tools', async () => {
    buildMcpTools(server, 'viewer', 1, 'http://localhost:3000', 'test-key')
    const tools = (server as any)._registeredTools
    expect(tools.has('mc_list_agents')).toBe(true)
    expect(tools.has('mc_get_agent')).toBe(true)
    expect(tools.has('mc_list_tasks')).toBe(true)
    expect(tools.has('mc_status')).toBe(true)
  })

  it('does NOT register operator tools for viewer', async () => {
    buildMcpTools(server, 'viewer', 1, 'http://localhost:3000', 'test-key')
    const tools = (server as any)._registeredTools
    expect(tools.has('mc_create_task')).toBe(false)
    expect(tools.has('mc_heartbeat')).toBe(false)
    expect(tools.has('mc_write_memory')).toBe(false)
  })

  it('registers operator tools for operator', async () => {
    buildMcpTools(server, 'operator', 1, 'http://localhost:3000', 'test-key')
    const tools = (server as any)._registeredTools
    expect(tools.has('mc_create_task')).toBe(true)
    expect(tools.has('mc_heartbeat')).toBe(true)
    expect(tools.has('mc_write_memory')).toBe(true)
  })

  it('registers all operator tools for admin', async () => {
    buildMcpTools(server, 'admin', 1, 'http://localhost:3000', 'test-key')
    const tools = (server as any)._registeredTools
    expect(tools.has('mc_create_task')).toBe(true)
    expect(tools.has('mc_list_agents')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd ~/Projects/mission-control
pnpm vitest run src/lib/__tests__/mcp-tools.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/mcp-tools'`

- [ ] **Step 3: Create `src/lib/mcp-tools.ts` with viewer tools**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getDatabase } from '@/lib/db'
import type { User } from '@/lib/auth'

type Role = User['role']

/**
 * Register MCP tools on the server instance scoped to the authenticated user's role.
 * Viewer tools: read-only SQL queries.
 * Operator/admin tools: call MC's internal REST API to preserve business logic.
 *
 * @param mcBaseUrl - e.g. "http://localhost:3000" — MC's own origin
 * @param apiKey - the API key used to authenticate the MCP request (forwarded to internal calls)
 */
export function buildMcpTools(
  server: McpServer,
  role: Role,
  workspaceId: number,
  mcBaseUrl: string,
  apiKey: string
): void {
  const db = getDatabase()

  // ─── Helper for internal API calls ───────────────────────────────────────
  const mcFetch = (method: string, path: string, body?: unknown) =>
    fetch(`${mcBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-forwarded-from-mcp': '1',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(r => r.json())

  // ─── VIEWER TOOLS ─────────────────────────────────────────────────────────

  // Agents
  server.tool('mc_list_agents',
    { status: z.string().optional(), limit: z.number().optional() },
    async ({ status, limit = 50 }) => {
      let q = 'SELECT * FROM agents WHERE workspace_id = ? AND hidden = 0'
      const p: unknown[] = [workspaceId]
      if (status) { q += ' AND status = ?'; p.push(status) }
      q += ' ORDER BY created_at DESC LIMIT ?'; p.push(limit)
      const rows = db.prepare(q).all(...p)
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] }
    }
  )

  server.tool('mc_get_agent',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const row = isNaN(Number(id))
        ? db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId)
        : db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId)
      if (!row) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Agent not found' }) }] }
      return { content: [{ type: 'text' as const, text: JSON.stringify(row) }] }
    }
  )

  server.tool('mc_agent_diagnostics',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const result = await mcFetch('GET', `/api/agents/${id}/diagnostics`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_agent_attribution',
    { id: z.union([z.string(), z.number()]), hours: z.number().optional(), section: z.string().optional() },
    async ({ id, hours = 24, section }) => {
      const qs = new URLSearchParams({ hours: String(hours), ...(section ? { section } : {}) })
      const result = await mcFetch('GET', `/api/agents/${id}/attribution?${qs}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_agent_costs',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const result = await mcFetch('GET', `/api/agents/${id}/costs`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_costs_by_agent', {}, async () => {
    const result = await mcFetch('GET', '/api/costs/by-agent')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_token_stats', {}, async () => {
    const result = await mcFetch('GET', '/api/costs/tokens')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  // Memory (read)
  server.tool('mc_read_memory',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const row = isNaN(Number(id))
        ? db.prepare('SELECT working_memory FROM agents WHERE name = ? AND workspace_id = ?').get(id, workspaceId)
        : db.prepare('SELECT working_memory FROM agents WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(row || { error: 'Agent not found' }) }] }
    }
  )

  // Knowledge (read)
  server.tool('mc_search_knowledge',
    { q: z.string(), limit: z.number().optional() },
    async ({ q, limit = 20 }) => {
      const result = await mcFetch('GET', `/api/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_read_knowledge_file',
    { path: z.string() },
    async ({ path: p }) => {
      const result = await mcFetch('GET', `/api/knowledge/files?path=${encodeURIComponent(p)}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_knowledge_health', {}, async () => {
    const result = await mcFetch('GET', '/api/knowledge/health')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_knowledge_gaps', {}, async () => {
    const result = await mcFetch('GET', '/api/knowledge/gaps')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_knowledge_consolidate', {}, async () => {
    const result = await mcFetch('GET', '/api/knowledge/consolidate')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  // Soul (read)
  server.tool('mc_read_soul',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const result = await mcFetch('GET', `/api/agents/${id}/soul`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_list_soul_templates',
    { id: z.union([z.string(), z.number()]), template: z.string().optional() },
    async ({ id, template }) => {
      const qs = template ? `?template=${encodeURIComponent(template)}` : ''
      const result = await mcFetch('GET', `/api/agents/${id}/soul/templates${qs}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  // Tasks (read)
  server.tool('mc_list_tasks',
    {
      status: z.string().optional(),
      assigned_to: z.string().optional(),
      priority: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ status, assigned_to, priority, search, limit = 50 }) => {
      let q = `
        SELECT t.*, p.name as project_name
        FROM tasks t
        LEFT JOIN projects p ON p.id = t.project_id AND p.workspace_id = t.workspace_id
        WHERE t.workspace_id = ?
      `
      const p: unknown[] = [workspaceId]
      if (status) { q += ' AND t.status = ?'; p.push(status) }
      if (assigned_to) { q += ' AND t.assigned_to = ?'; p.push(assigned_to) }
      if (priority) { q += ' AND t.priority = ?'; p.push(priority) }
      if (search) { q += ' AND t.title LIKE ?'; p.push(`%${search}%`) }
      q += ' ORDER BY t.created_at DESC LIMIT ?'; p.push(Math.min(limit, 200))
      const rows = db.prepare(q).all(...p)
      const tasks = rows.map((t: any) => ({
        ...t,
        tags: t.tags ? JSON.parse(t.tags) : [],
        metadata: t.metadata ? JSON.parse(t.metadata) : {},
      }))
      return { content: [{ type: 'text' as const, text: JSON.stringify({ tasks, total: tasks.length }) }] }
    }
  )

  server.tool('mc_get_task',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => {
      const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?').get(Number(id), workspaceId)
      if (!row) return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Task not found' }) }] }
      const task = row as any
      return { content: [{ type: 'text' as const, text: JSON.stringify({
        ...task,
        tags: task.tags ? JSON.parse(task.tags) : [],
        metadata: task.metadata ? JSON.parse(task.metadata) : {},
      }) }] }
    }
  )

  server.tool('mc_poll_task_queue',
    { agent_name: z.string(), limit: z.number().optional() },
    async ({ agent_name, limit = 10 }) => {
      const rows = db.prepare(`
        SELECT * FROM tasks
        WHERE workspace_id = ? AND assigned_to = ? AND status IN ('assigned', 'in_progress')
        ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at ASC
        LIMIT ?
      `).all(workspaceId, agent_name, limit)
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] }
    }
  )

  server.tool('mc_list_comments',
    { task_id: z.union([z.string(), z.number()]) },
    async ({ task_id }) => {
      const rows = db.prepare('SELECT * FROM comments WHERE task_id = ? AND workspace_id = ? ORDER BY created_at ASC').all(Number(task_id), workspaceId)
      const comments = rows.map((c: any) => ({ ...c, mentions: c.mentions ? JSON.parse(c.mentions) : [] }))
      return { content: [{ type: 'text' as const, text: JSON.stringify({ comments }) }] }
    }
  )

  // Sessions (read)
  server.tool('mc_list_sessions',
    { agent_id: z.union([z.string(), z.number()]).optional(), limit: z.number().optional() },
    async ({ agent_id, limit = 20 }) => {
      const result = await mcFetch('GET', `/api/sessions${agent_id ? `?agent_id=${agent_id}` : ''}&limit=${limit}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_session_transcript',
    { session_id: z.string() },
    async ({ session_id }) => {
      const result = await mcFetch('GET', `/api/sessions/${session_id}/transcript`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  // Connections
  server.tool('mc_list_connections', {}, async () => {
    const rows = db.prepare('SELECT * FROM connections WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId)
    return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] }
  })

  // Skills
  server.tool('mc_list_skills', {}, async () => {
    const result = await mcFetch('GET', '/api/skills')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_read_skill',
    { name: z.string(), agent_id: z.union([z.string(), z.number()]).optional() },
    async ({ name, agent_id }) => {
      const qs = new URLSearchParams({ name, ...(agent_id !== undefined ? { agent_id: String(agent_id) } : {}) })
      const result = await mcFetch('GET', `/api/skills/read?${qs}`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  // Cron
  server.tool('mc_list_cron', {}, async () => {
    const result = await mcFetch('GET', '/api/cron')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  // System status
  server.tool('mc_health', {}, async () => {
    const result = await mcFetch('GET', '/api/health')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_status', {}, async () => {
    const result = await mcFetch('GET', '/api/status')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  server.tool('mc_dashboard', {}, async () => {
    const result = await mcFetch('GET', '/api/dashboard')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  // Runs (read)
  server.tool('mc_list_runs',
    { agent_id: z.union([z.string(), z.number()]).optional(), limit: z.number().optional() },
    async ({ agent_id, limit = 20 }) => {
      let q = 'SELECT * FROM runs WHERE workspace_id = ?'
      const p: unknown[] = [workspaceId]
      if (agent_id !== undefined) { q += ' AND agent_id = ?'; p.push(Number(agent_id)) }
      q += ' ORDER BY created_at DESC LIMIT ?'; p.push(limit)
      const rows = db.prepare(q).all(...p)
      return { content: [{ type: 'text' as const, text: JSON.stringify(rows) }] }
    }
  )

  server.tool('mc_get_run',
    { id: z.number() },
    async ({ id }) => {
      const row = db.prepare('SELECT * FROM runs WHERE id = ? AND workspace_id = ?').get(id, workspaceId)
      return { content: [{ type: 'text' as const, text: JSON.stringify(row || { error: 'Run not found' }) }] }
    }
  )

  server.tool('mc_run_provenance',
    { run_id: z.number() },
    async ({ run_id }) => {
      const result = await mcFetch('GET', `/api/runs/${run_id}/provenance`)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    }
  )

  server.tool('mc_eval_leaderboard', {}, async () => {
    const result = await mcFetch('GET', '/api/evals/leaderboard')
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })

  // ─── OPERATOR TOOLS ───────────────────────────────────────────────────────
  if (role === 'operator' || role === 'admin') {

    server.tool('mc_heartbeat',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => {
        const result = await mcFetch('POST', `/api/agents/${id}/heartbeat`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_wake_agent',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => {
        const result = await mcFetch('POST', `/api/agents/${id}/wake`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_write_memory',
      { id: z.union([z.string(), z.number()]), working_memory: z.string(), append: z.boolean().optional() },
      async ({ id, working_memory, append = false }) => {
        const result = await mcFetch('PUT', `/api/agents/${id}/memory`, { working_memory, append })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_clear_memory',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => {
        const result = await mcFetch('DELETE', `/api/agents/${id}/memory`)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_write_knowledge_file',
      { path: z.string(), content: z.string(), create: z.boolean().optional() },
      async ({ path: p, content, create }) => {
        const result = await mcFetch('PUT', '/api/knowledge/files', { path: p, content, create })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_rebuild_search_index', {}, async () => {
      const result = await mcFetch('POST', '/api/knowledge/search/rebuild')
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
    })

    server.tool('mc_write_soul',
      { id: z.union([z.string(), z.number()]), soul_content: z.string().optional(), template_name: z.string().optional() },
      async ({ id, soul_content, template_name }) => {
        const result = await mcFetch('PUT', `/api/agents/${id}/soul`, { soul_content, template_name })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_create_task',
      {
        title: z.string(),
        description: z.string().optional(),
        priority: z.string().optional(),
        assigned_to: z.string().optional(),
        status: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      async (args) => {
        const result = await mcFetch('POST', '/api/tasks', args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_update_task',
      {
        id: z.union([z.string(), z.number()]),
        status: z.string().optional(),
        priority: z.string().optional(),
        assigned_to: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        outcome: z.string().optional(),
        resolution: z.string().optional(),
        error_message: z.string().optional(),
      },
      async ({ id, ...updates }) => {
        const result = await mcFetch('PUT', `/api/tasks/${id}`, updates)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_broadcast_task',
      { task_id: z.number(), message: z.string() },
      async ({ task_id, message }) => {
        const result = await mcFetch('POST', `/api/tasks/${task_id}/broadcast`, { message })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_add_comment',
      { task_id: z.union([z.string(), z.number()]), content: z.string(), parent_id: z.number().optional() },
      async ({ task_id, content, parent_id }) => {
        const result = await mcFetch('POST', `/api/tasks/${task_id}/comments`, { content, parent_id })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_control_session',
      { session_id: z.string(), action: z.string() },
      async ({ session_id, action }) => {
        const result = await mcFetch('POST', `/api/sessions/${session_id}/control`, { action })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_continue_session',
      { session_id: z.string(), message: z.string() },
      async ({ session_id, message }) => {
        const result = await mcFetch('POST', `/api/sessions/${session_id}/continue`, { message })
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_register_connection',
      { name: z.string(), url: z.string(), type: z.string().optional() },
      async (args) => {
        const result = await mcFetch('POST', '/api/connections', args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_create_run',
      { agent_id: z.number(), task_id: z.number().optional(), metadata: z.record(z.unknown()).optional() },
      async (args) => {
        const result = await mcFetch('POST', '/api/runs', args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_update_run',
      { id: z.number(), status: z.string().optional(), outcome: z.string().optional() },
      async ({ id, ...updates }) => {
        const result = await mcFetch('PUT', `/api/runs/${id}`, updates)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

    server.tool('mc_attach_eval',
      { run_id: z.number(), eval_id: z.number(), score: z.number().optional() },
      async (args) => {
        const result = await mcFetch('POST', `/api/runs/${args.run_id}/evals`, args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
      }
    )

  } // end operator

  // ─── ADMIN TOOLS ─────────────────────────────────────────────────────────
  // No additional tools beyond operator in the current tool set.
  // Future: API key management, agent delete, system config.
  if (role === 'admin') {
    // placeholder — extend as admin-only tools are added
  }
}

/**
 * Returns the sorted list of tool names that buildMcpTools registers for a given role.
 * Used by the parity test.
 */
export function getRegisteredToolNames(role: Role): string[] {
  const server = new McpServer({ name: 'test', version: '0.0.0' })
  buildMcpTools(server, role, 1, 'http://localhost:3000', 'test-key')
  return [...(server as any)._registeredTools.keys()].sort()
}
```

- [ ] **Step 4: Run test**

```bash
pnpm vitest run src/lib/__tests__/mcp-tools.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mcp-tools.ts src/lib/__tests__/mcp-tools.test.ts
git commit -m "feat: add mcp-tools.ts with 49 role-scoped tools"
```

---

## Task 3: Parity test — `mcp-tools.ts` tool names match `mc-mcp-server.cjs`

**Files:**
- Modify: `src/lib/__tests__/mcp-tools.test.ts`

- [ ] **Step 1: Extract tool names from mc-mcp-server.cjs**

```bash
node -e "
const content = require('fs').readFileSync('scripts/mc-mcp-server.cjs', 'utf8');
const names = [...content.matchAll(/name: '(mc_[^']+)'/g)].map(m => m[1]);
const unique = [...new Set(names)].sort();
console.log(JSON.stringify(unique));
" > /tmp/stdio-tool-names.json
cat /tmp/stdio-tool-names.json | python3 -m json.tool | wc -l
```

Expected: Prints the number of unique tool names (should be ~49).

- [ ] **Step 2: Add parity test to mcp-tools.test.ts**

Add this test block to `src/lib/__tests__/mcp-tools.test.ts`:

```typescript
import { getRegisteredToolNames } from '@/lib/mcp-tools'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('parity with mc-mcp-server.cjs', () => {
  it('admin role registers all tools that mc-mcp-server.cjs exposes', () => {
    // Parse tool names from stdio server
    const cjsContent = readFileSync(
      resolve(__dirname, '../../../scripts/mc-mcp-server.cjs'),
      'utf8'
    )
    const stdioNames = [...cjsContent.matchAll(/name: '(mc_[^']+)'/g)]
      .map(m => m[1])
      .filter((v, i, arr) => arr.indexOf(v) === i) // unique
      .sort()

    const httpNames = getRegisteredToolNames('admin')

    // Every stdio tool must be in the HTTP registry
    const missing = stdioNames.filter(n => !httpNames.includes(n))
    expect(missing).toEqual([])
  })
})
```

- [ ] **Step 3: Run parity test**

```bash
pnpm vitest run src/lib/__tests__/mcp-tools.test.ts
```

Expected: The parity test may fail if any tools are missing — fix `mcp-tools.ts` to add them.

- [ ] **Step 4: Fix any missing tools, re-run until green**

If missing tools appear, add them to `mcp-tools.ts` following the same pattern.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/mcp-tools.test.ts src/lib/mcp-tools.ts
git commit -m "test: add parity test ensuring mcp-tools.ts matches mc-mcp-server.cjs tool list"
```

---

## Task 4: Create `src/app/api/mcp/route.ts`

**Files:**
- Create: `src/app/api/mcp/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { buildMcpTools } from '@/lib/mcp-tools'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getMcBaseUrl(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('host') || 'localhost:3000'
  const proto = forwarded || (host.includes('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

function getApiKey(request: NextRequest): string {
  return request.headers.get('x-api-key') || ''
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const server = new McpServer({ name: 'mission-control', version: '1.0.0' })
  buildMcpTools(server, auth.user.role, auth.user.workspace_id ?? 1, getMcBaseUrl(request), getApiKey(request))

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    // Prevent event listener accumulation in the long-lived Node.js process
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
}
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
pnpm typecheck 2>&1 | grep -E 'mcp|error' | head -20
```

Expected: No errors for the mcp files. Fix any import path issues (check `node_modules/@modelcontextprotocol/sdk/dist/` for actual paths if imports fail).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mcp/route.ts
git commit -m "feat: add POST /api/mcp route with try/finally cleanup"
```

---

## Task 5: Integration tests

**Files:**
- Create: `src/app/api/mcp/__tests__/route.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `src/app/api/mcp/__tests__/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock auth
const mockRequireRole = vi.fn()
vi.mock('@/lib/auth', () => ({ requireRole: mockRequireRole }))

// Mock mcp-tools
const mockBuildMcpTools = vi.fn()
vi.mock('@/lib/mcp-tools', () => ({ buildMcpTools: mockBuildMcpTools }))

// Mock SDK
const mockConnect = vi.fn()
const mockHandleRequest = vi.fn()
const mockClose = vi.fn()
const mockServerClose = vi.fn()
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockServerClose,
  }))
}))
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation(() => ({
    handleRequest: mockHandleRequest,
    close: mockClose,
  }))
}))

import { POST } from '../route'

describe('POST /api/mcp', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 for unauthenticated request', async () => {
    mockRequireRole.mockReturnValue({ error: 'Authentication required', status: 401 })
    const req = new NextRequest('http://localhost:3000/api/mcp', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockBuildMcpTools).not.toHaveBeenCalled()
  })

  it('returns 403 for insufficient role', async () => {
    mockRequireRole.mockReturnValue({ error: 'Requires viewer role', status: 403 })
    const req = new NextRequest('http://localhost:3000/api/mcp', { method: 'POST' })
    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('calls buildMcpTools with viewer role for viewer user', async () => {
    const mockResponse = new Response(JSON.stringify({ result: 'ok' }))
    mockRequireRole.mockReturnValue({ user: { role: 'viewer', workspace_id: 1 } })
    mockConnect.mockResolvedValue(undefined)
    mockHandleRequest.mockResolvedValue(mockResponse)
    mockClose.mockResolvedValue(undefined)
    mockServerClose.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'x-api-key': 'test-key' },
    })
    const res = await POST(req)

    expect(mockBuildMcpTools).toHaveBeenCalledWith(
      expect.anything(), 'viewer', 1, 'http://localhost:3000', 'test-key'
    )
    expect(res).toBe(mockResponse)
  })

  it('calls transport.close() and server.close() in finally — even if handleRequest throws', async () => {
    mockRequireRole.mockReturnValue({ user: { role: 'operator', workspace_id: 1 } })
    mockConnect.mockResolvedValue(undefined)
    mockHandleRequest.mockRejectedValue(new Error('transport error'))
    mockClose.mockResolvedValue(undefined)
    mockServerClose.mockResolvedValue(undefined)

    const req = new NextRequest('http://localhost:3000/api/mcp', { method: 'POST' })
    await expect(POST(req)).rejects.toThrow('transport error')

    expect(mockClose).toHaveBeenCalledOnce()
    expect(mockServerClose).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Run integration tests**

```bash
pnpm vitest run src/app/api/mcp/__tests__/route.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 3: Run all tests to check no regressions**

```bash
pnpm test 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/mcp/__tests__/route.test.ts
git commit -m "test: add integration tests for POST /api/mcp"
```

---

## Task 6: Typecheck + build

**Files:** none (validation only)

- [ ] **Step 1: Full typecheck**

```bash
pnpm typecheck 2>&1 | grep -c 'error' || echo "0 errors"
```

Expected: 0 new errors (fix any that appear in mcp-related files).

- [ ] **Step 2: Build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: Build succeeds. If SDK imports fail (ESM/CJS conflict), try `import type` and check SDK `exports` field.

- [ ] **Step 3: Start server and smoke test `tools/list`**

```bash
pnpm start &
sleep 3

# Get an API key from the DB
API_KEY=$(sqlite3 ~/.data/mission-control.db "SELECT api_key FROM api_keys LIMIT 1" 2>/dev/null || \
  sqlite3 /app/.data/mission-control.db "SELECT api_key FROM api_keys LIMIT 1" 2>/dev/null)

curl -s -X POST http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool | grep '"name"' | head -10
```

Expected: List of tool names including `mc_list_tasks`, `mc_list_agents`, etc.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: MCP HTTP transport complete — POST /api/mcp live"
```

---

## Task 7: Docker standalone smoke test

**Files:** none (validation only)

- [ ] **Step 1: Build Docker image**

```bash
cd ~/Projects/mission-control
docker compose build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 2: Start container and test**

```bash
docker compose up -d
sleep 5

# Get API key from container DB
API_KEY=$(docker compose exec -T app sqlite3 /app/.data/mission-control.db "SELECT api_key FROM api_keys LIMIT 1" 2>/dev/null)

curl -s -X POST http://localhost:3001/api/mcp \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -c "
import json, sys
d = json.load(sys.stdin)
tools = d.get('result', {}).get('tools', [])
print(f'Tool count: {len(tools)}')
print('First 5:', [t[\"name\"] for t in tools[:5]])
"
```

Expected: Tool count: ~35 (viewer) or ~49 (admin key). If EROFS errors appear in container logs, check SDK's `dist/` for any file writes and add tmpfs mounts as needed.

- [ ] **Step 3: Test no-auth rejection**

```bash
curl -s -X POST http://localhost:3001/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | python3 -m json.tool
```

Expected: `{"error": "Authentication required"}` with HTTP 401.

- [ ] **Step 4: Stop container**

```bash
docker compose down
```

- [ ] **Step 5: Final commit and push**

```bash
git add -A
git commit -m "docs: MCP HTTP transport verified in Docker standalone container"
git push origin main
```

---

## Known Limitations

- **Operator mutation tools call MC's internal REST API** (not raw SQL). This preserves Aegis gates, GitHub sync, and mention handling. Self-referential HTTP call to `http://localhost:<port>` — negligible latency.
- **No streaming**: all responses are JSON. SSE streaming not supported in stateless mode.
- **Shared API keys**: per-agent token model tracked in task #60.
- **Admin tier**: no admin-only tools yet — same tool set as operator. Extend when admin-only tools are added.
