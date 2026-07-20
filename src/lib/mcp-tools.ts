import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { User } from '@/lib/auth'

type Role = User['role']

/**
 * Register all MCP tools on the given server, scoped to the authenticated user's role.
 *
 * All tools proxy to MC's own REST API internally — this preserves business logic
 * (Aegis gates, GitHub sync, mentions, etc.) and mirrors mc-mcp-server.cjs exactly.
 *
 * Viewer tools: read-only, always registered.
 * Operator tools: mutations, registered for operator + admin.
 * Admin tools: reserved for future admin-only operations.
 *
 * @param mcBaseUrl - MC's own origin, e.g. "http://localhost:3000"
 * @param apiKey    - the x-api-key from the original MCP request (forwarded)
 */
export function buildMcpTools(
  server: McpServer,
  role: Role,
  _workspaceId: number,
  mcBaseUrl: string,
  apiKey: string,
): void {
  // Internal HTTP proxy — same pattern as mc-mcp-server.cjs
  const mc = (method: string, path: string, body?: unknown) =>
    fetch(`${mcBaseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }).then(r => r.json())

  const text = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  })

  // ─── VIEWER TOOLS ────────────────────────────────────────────────────────

  // Agents
  server.tool('mc_list_agents',
    { status: z.string().optional(), limit: z.number().optional() },
    async ({ status, limit }) => {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (limit) qs.set('limit', String(limit))
      return text(await mc('GET', `/api/agents?${qs}`))
    }
  )

  server.tool('mc_get_agent',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => text(await mc('GET', `/api/agents/${id}`))
  )

  server.tool('mc_agent_diagnostics',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => text(await mc('GET', `/api/agents/${id}/diagnostics`))
  )

  server.tool('mc_agent_attribution',
    {
      id: z.union([z.string(), z.number()]),
      hours: z.number().optional(),
      section: z.string().optional(),
    },
    async ({ id, hours, section }) => {
      const qs = new URLSearchParams()
      if (hours) qs.set('hours', String(hours))
      if (section) qs.set('section', section)
      return text(await mc('GET', `/api/agents/${id}/attribution?${qs}`))
    }
  )

  server.tool('mc_agent_costs',
    { timeframe: z.string().optional() },
    async ({ timeframe }) => {
      const qs = `?action=agent-costs${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      return text(await mc('GET', `/api/tokens${qs}`))
    }
  )

  server.tool('mc_costs_by_agent',
    { days: z.number().optional() },
    async ({ days }) => text(await mc('GET', `/api/tokens/by-agent?days=${days ?? 30}`))
  )

  server.tool('mc_token_task_costs',
    { timeframe: z.string().optional() },
    async ({ timeframe }) => {
      const qs = `?action=task-costs${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      return text(await mc('GET', `/api/tokens${qs}`))
    }
  )

  server.tool('mc_token_trends',
    { timeframe: z.string().optional() },
    async ({ timeframe }) => {
      const qs = `?action=trends${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      return text(await mc('GET', `/api/tokens${qs}`))
    }
  )

  server.tool('mc_token_export',
    { timeframe: z.string().optional() },
    async ({ timeframe }) => {
      const qs = `?action=export&format=json${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      return text(await mc('GET', `/api/tokens${qs}`))
    }
  )

  server.tool('mc_token_stats',
    { timeframe: z.string().optional() },
    async ({ timeframe }) => {
      const qs = `?action=stats${timeframe ? `&timeframe=${encodeURIComponent(timeframe)}` : ''}`
      return text(await mc('GET', `/api/tokens${qs}`))
    }
  )

  // Memory (read)
  server.tool('mc_read_memory',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => text(await mc('GET', `/api/agents/${id}/memory`))
  )

  // Knowledge (read)
  server.tool('mc_search_knowledge',
    { q: z.string(), limit: z.number().optional() },
    async ({ q, limit }) => {
      const qs = new URLSearchParams({ q })
      if (limit) qs.set('limit', String(limit))
      return text(await mc('GET', `/api/memory/search?${qs}`))
    }
  )

  server.tool('mc_read_knowledge_file',
    { path: z.string() },
    async ({ path }) =>
      text(await mc('GET', `/api/memory?action=content&path=${encodeURIComponent(path)}`))
  )

  server.tool('mc_knowledge_health', {},
    async () => text(await mc('GET', '/api/memory/health'))
  )

  server.tool('mc_knowledge_gaps', {},
    async () => text(await mc('POST', '/api/memory/process', { action: 'gap-detect' }))
  )

  server.tool('mc_knowledge_consolidate', {},
    async () => text(await mc('POST', '/api/memory/process', { action: 'consolidate' }))
  )

  // Soul (read)
  server.tool('mc_read_soul',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => text(await mc('GET', `/api/agents/${id}/soul`))
  )

  server.tool('mc_list_soul_templates',
    { id: z.union([z.string(), z.number()]), template: z.string().optional() },
    async ({ id, template }) => {
      const qs = template ? `?template=${encodeURIComponent(template)}` : ''
      return text(await mc('PATCH', `/api/agents/${id}/soul${qs}`))
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
    async (args) => {
      const qs = new URLSearchParams()
      if (args.status) qs.set('status', args.status)
      if (args.assigned_to) qs.set('assigned_to', args.assigned_to)
      if (args.priority) qs.set('priority', args.priority)
      if (args.search) qs.set('search', args.search)
      if (args.limit) qs.set('limit', String(args.limit))
      return text(await mc('GET', `/api/tasks?${qs}`))
    }
  )

  server.tool('mc_get_task',
    { id: z.union([z.string(), z.number()]) },
    async ({ id }) => text(await mc('GET', `/api/tasks/${id}`))
  )

  server.tool('mc_poll_task_queue',
    { agent: z.string(), max_capacity: z.number().optional() },
    async ({ agent, max_capacity }) => {
      const qs = new URLSearchParams({ agent })
      if (max_capacity) qs.set('max_capacity', String(max_capacity))
      return text(await mc('GET', `/api/tasks/queue?${qs}`))
    }
  )

  server.tool('mc_list_comments',
    { task_id: z.union([z.string(), z.number()]) },
    async ({ task_id }) => text(await mc('GET', `/api/tasks/${task_id}/comments`))
  )

  // Sessions (read)
  server.tool('mc_list_sessions',
    { agent_id: z.union([z.string(), z.number()]).optional(), limit: z.number().optional() },
    async ({ agent_id, limit }) => {
      const qs = new URLSearchParams()
      if (agent_id !== undefined) qs.set('agent_id', String(agent_id))
      if (limit) qs.set('limit', String(limit))
      return text(await mc('GET', `/api/sessions?${qs}`))
    }
  )

  server.tool('mc_session_transcript',
    { kind: z.string(), id: z.string(), limit: z.number().optional() },
    async ({ kind, id, limit }) => {
      const qs = `?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}${limit ? `&limit=${limit}` : ''}`
      return text(await mc('GET', `/api/sessions/transcript${qs}`))
    }
  )

  // Connections (read)
  server.tool('mc_list_connections', {},
    async () => text(await mc('GET', '/api/connect'))
  )

  // Skills (read)
  server.tool('mc_list_skills', {},
    async () => text(await mc('GET', '/api/skills'))
  )

  server.tool('mc_read_skill',
    { source: z.string(), name: z.string() },
    async ({ source, name }) =>
      text(await mc('GET', `/api/skills?mode=content&source=${encodeURIComponent(source)}&name=${encodeURIComponent(name)}`))
  )

  // System status (read)
  server.tool('mc_health', {},
    async () => text(await mc('GET', '/api/status?action=health'))
  )

  server.tool('mc_dashboard', {},
    async () => text(await mc('GET', '/api/status?action=dashboard'))
  )

  server.tool('mc_status', {},
    async () => text(await mc('GET', '/api/status?action=overview'))
  )

  server.tool('mc_gateway_status', {},
    async () => text(await mc('GET', '/api/status?action=gateway'))
  )

  server.tool('mc_list_models', {},
    async () => text(await mc('GET', '/api/status?action=models'))
  )

  server.tool('mc_capabilities', {},
    async () => text(await mc('GET', '/api/status?action=capabilities'))
  )

  // Runs (read)
  server.tool('mc_list_runs',
    {
      agent_id: z.string().optional(),
      status: z.string().optional(),
      since: z.string().optional(),
      limit: z.number().optional(),
    },
    async (args) => {
      const qs = new URLSearchParams()
      if (args.agent_id) qs.set('agent_id', args.agent_id)
      if (args.status) qs.set('status', args.status)
      if (args.since) qs.set('since', args.since)
      if (args.limit) qs.set('limit', String(args.limit))
      return text(await mc('GET', `/api/v1/runs?${qs}`))
    }
  )

  server.tool('mc_get_run',
    { run_id: z.string() },
    async ({ run_id }) => text(await mc('GET', `/api/v1/runs/${encodeURIComponent(run_id)}`))
  )

  server.tool('mc_run_provenance',
    { run_id: z.string() },
    async ({ run_id }) => text(await mc('GET', `/api/v1/runs/${encodeURIComponent(run_id)}/provenance`))
  )

  server.tool('mc_eval_leaderboard',
    { benchmark_id: z.string().optional(), limit: z.number().optional() },
    async ({ benchmark_id, limit }) => {
      const qs = new URLSearchParams()
      if (benchmark_id) qs.set('benchmark_id', benchmark_id)
      if (limit) qs.set('limit', String(limit))
      return text(await mc('GET', `/api/v1/evals/leaderboard?${qs}`))
    }
  )

  // ─── OPERATOR TOOLS ──────────────────────────────────────────────────────
  if (role === 'operator' || role === 'admin') {

    server.tool('mc_heartbeat',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('POST', `/api/agents/${id}/heartbeat`))
    )

    server.tool('mc_wake_agent',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('POST', `/api/agents/${id}/wake`))
    )

    server.tool('mc_write_memory',
      {
        id: z.union([z.string(), z.number()]),
        working_memory: z.string(),
        append: z.boolean().optional(),
      },
      async ({ id, working_memory, append }) =>
        text(await mc('PUT', `/api/agents/${id}/memory`, { working_memory, append }))
    )

    server.tool('mc_clear_memory',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('DELETE', `/api/agents/${id}/memory`))
    )

    server.tool('mc_write_knowledge_file',
      { path: z.string(), content: z.string(), create: z.boolean().optional() },
      async ({ path, content, create }) =>
        text(await mc('POST', '/api/memory', { action: create ? 'create' : 'save', path, content }))
    )

    server.tool('mc_rebuild_search_index', {},
      async () => text(await mc('POST', '/api/memory/search'))
    )

    server.tool('mc_write_soul',
      {
        id: z.union([z.string(), z.number()]),
        soul_content: z.string().optional(),
        template_name: z.string().optional(),
      },
      async ({ id, soul_content, template_name }) => {
        const body: Record<string, unknown> = {}
        if (template_name) body.template_name = template_name
        else if (soul_content) body.soul_content = soul_content
        return text(await mc('PUT', `/api/agents/${id}/soul`, body))
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
      async (args) => text(await mc('POST', '/api/tasks', args))
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
      async ({ id, ...updates }) => text(await mc('PUT', `/api/tasks/${id}`, updates))
    )

    server.tool('mc_broadcast_task',
      { id: z.union([z.string(), z.number()]), message: z.string() },
      async ({ id, message }) =>
        text(await mc('POST', `/api/tasks/${id}/broadcast`, { message }))
    )

    server.tool('mc_add_comment',
      {
        task_id: z.union([z.string(), z.number()]),
        content: z.string(),
        parent_id: z.number().optional(),
      },
      async ({ task_id, content, parent_id }) =>
        text(await mc('POST', `/api/tasks/${task_id}/comments`, { content, parent_id }))
    )

    server.tool('mc_control_session',
      { id: z.string(), action: z.string() },
      async ({ id, action }) =>
        text(await mc('POST', `/api/sessions/${id}/control`, { action }))
    )

    server.tool('mc_continue_session',
      { session_id: z.string().optional(), message: z.string() },
      async ({ session_id, message }) =>
        text(await mc('POST', '/api/sessions/continue', { session_id, message }))
    )

    server.tool('mc_register_connection',
      { name: z.string(), url: z.string(), type: z.string().optional() },
      async (args) => text(await mc('POST', '/api/connect', args))
    )

    server.tool('mc_create_run',
      {
        agent_id: z.string(),
        task_id: z.number().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      },
      async (args) => text(await mc('POST', '/api/v1/runs', args))
    )

    server.tool('mc_update_run',
      {
        run_id: z.string(),
        status: z.string().optional(),
        outcome: z.string().optional(),
      },
      async ({ run_id, ...updates }) =>
        text(await mc('PATCH', `/api/v1/runs/${encodeURIComponent(run_id)}`, updates))
    )

    server.tool('mc_attach_eval',
      {
        run_id: z.string(),
        pass: z.boolean().optional(),
        score: z.number().optional(),
        task_type: z.string().optional(),
        detail: z.string().optional(),
      },
      async ({ run_id, ...evalData }) =>
        text(await mc('PUT', `/api/v1/runs/${encodeURIComponent(run_id)}/eval`, evalData))
    )

    server.tool('mc_create_agent',
      {
        name: z.string(),
        role: z.string().optional(),
        openclaw_id: z.string().optional(),
        template: z.string().optional(),
        status: z.string().optional(),
        gateway_config: z.record(z.string(), z.unknown()).optional(),
      },
      async (args) => text(await mc('POST', '/api/agents', args))
    )

    server.tool('mc_update_agent',
      {
        id: z.union([z.string(), z.number()]),
        role: z.string().optional(),
        gateway_config: z.record(z.string(), z.unknown()).optional(),
        write_to_gateway: z.boolean().optional(),
      },
      async ({ id, ...updates }) => text(await mc('PUT', `/api/agents/${id}`, updates))
    )

    server.tool('mc_upsert_skill',
      { source: z.string(), name: z.string(), content: z.string() },
      async (args) => text(await mc('PUT', '/api/skills', args))
    )

    server.tool('mc_delete_skill',
      { source: z.string(), name: z.string() },
      async ({ source, name }) =>
        text(await mc('DELETE', '/api/skills', { source, name, confirmation: 'delete_skill' }))
    )

    server.tool('mc_delete_task',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('DELETE', `/api/tasks/${id}`))
    )

    server.tool('mc_disconnect',
      { connection_id: z.string() },
      async ({ connection_id }) => text(await mc('DELETE', '/api/connect', { connection_id }))
    )

  } // end operator

  // ─── ADMIN TOOLS ─────────────────────────────────────────────────────────
  if (role === 'admin') {

    server.tool('mc_delete_agent',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('DELETE', `/api/agents/${id}`))
    )

    server.tool('mc_list_agent_keys',
      { id: z.union([z.string(), z.number()]) },
      async ({ id }) => text(await mc('GET', `/api/agents/${id}/keys`))
    )

    server.tool('mc_create_agent_key',
      {
        id: z.union([z.string(), z.number()]),
        name: z.string().optional(),
        scopes: z.array(z.string()).optional(),
        expires_at: z.number().optional(),
        expires_in_days: z.number().optional(),
      },
      async ({ id, ...body }) => text(await mc('POST', `/api/agents/${id}/keys`, body))
    )

    server.tool('mc_revoke_agent_key',
      { id: z.union([z.string(), z.number()]), key_id: z.number() },
      async ({ id, key_id }) => text(await mc('DELETE', `/api/agents/${id}/keys`, { key_id }))
    )

    server.tool('mc_manage_cron',
      {
        action: z.enum(['toggle', 'trigger']),
        jobId: z.string().optional(),
        jobName: z.string().optional(),
        mode: z.enum(['due', 'force']).optional(),
      },
      async (args) => text(await mc('POST', '/api/cron', args))
    )

    server.tool('mc_list_cron', {},
      async () => text(await mc('GET', '/api/cron?action=list'))
    )

  } // end admin
}

/**
 * Returns sorted tool names registered for a given role.
 * Used by the parity test to assert HTTP and stdio tool registries match.
 */
export function getRegisteredToolNames(role: Role): string[] {
  const server = new McpServer({ name: 'parity-check', version: '0.0.0' })
  buildMcpTools(server, role, 1, 'http://localhost:3000', 'test-key')
  // McpServer stores registered tools in _registeredTools (internal Map)
  const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
  return Object.keys(tools).sort()
}
