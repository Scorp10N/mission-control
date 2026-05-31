import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildMcpTools, getRegisteredToolNames } from '@/lib/mcp-tools'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Helper ─────────────────────────────────────────────────────────────────

function registeredTools(role: 'viewer' | 'operator' | 'admin'): Record<string, unknown> {
  const s = new McpServer({ name: 'test', version: '0.0.0' })
  buildMcpTools(s, role, 1, 'http://localhost:3000', 'test-key')
  return (s as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
}

// ─── Role Scoping ────────────────────────────────────────────────────────────

describe('buildMcpTools — role scoping', () => {
  it('viewer gets read-only tools only', () => {
    const tools = Object.keys(registeredTools('viewer'))
    // Viewer should have read tools
    expect(tools).toContain('mc_list_tasks')
    expect(tools).toContain('mc_get_task')
    expect(tools).toContain('mc_list_agents')
    expect(tools).toContain('mc_search_knowledge')
    expect(tools).toContain('mc_status')
    // Viewer must NOT have write/mutation tools
    expect(tools).not.toContain('mc_create_task')
    expect(tools).not.toContain('mc_update_task')
    expect(tools).not.toContain('mc_write_memory')
    expect(tools).not.toContain('mc_heartbeat')
    expect(tools).not.toContain('mc_wake_agent')
    expect(tools).not.toContain('mc_control_session')
  })

  it('operator gets viewer tools plus mutations', () => {
    const viewerTools = new Set(Object.keys(registeredTools('viewer')))
    const operatorTools = Object.keys(registeredTools('operator'))
    // All viewer tools are present
    for (const t of viewerTools) {
      expect(operatorTools).toContain(t)
    }
    // Plus mutations
    expect(operatorTools).toContain('mc_create_task')
    expect(operatorTools).toContain('mc_update_task')
    expect(operatorTools).toContain('mc_write_memory')
    expect(operatorTools).toContain('mc_heartbeat')
    expect(operatorTools).toContain('mc_wake_agent')
    expect(operatorTools).toContain('mc_control_session')
    expect(operatorTools).toContain('mc_add_comment')
    expect(operatorTools).toContain('mc_broadcast_task')
  })

  it('admin gets the same tools as operator (no admin-only tools yet)', () => {
    const operatorTools = Object.keys(registeredTools('operator')).sort()
    const adminTools = Object.keys(registeredTools('admin')).sort()
    expect(adminTools).toEqual(operatorTools)
  })
})

// ─── Parity ──────────────────────────────────────────────────────────────────

const EXPECTED_TOOLS = [
  'mc_add_comment', 'mc_agent_attribution', 'mc_agent_costs', 'mc_agent_diagnostics',
  'mc_attach_eval', 'mc_broadcast_task', 'mc_clear_memory', 'mc_continue_session',
  'mc_control_session', 'mc_costs_by_agent', 'mc_create_run', 'mc_create_task',
  'mc_dashboard', 'mc_eval_leaderboard', 'mc_get_agent', 'mc_get_run', 'mc_get_task',
  'mc_health', 'mc_heartbeat', 'mc_knowledge_consolidate', 'mc_knowledge_gaps',
  'mc_knowledge_health', 'mc_list_agents', 'mc_list_comments', 'mc_list_connections',
  'mc_list_cron', 'mc_list_runs', 'mc_list_sessions', 'mc_list_skills',
  'mc_list_soul_templates', 'mc_list_tasks', 'mc_poll_task_queue', 'mc_read_knowledge_file',
  'mc_read_memory', 'mc_read_skill', 'mc_read_soul', 'mc_rebuild_search_index',
  'mc_register_connection', 'mc_run_provenance', 'mc_search_knowledge',
  'mc_session_transcript', 'mc_status', 'mc_token_stats', 'mc_update_run', 'mc_update_task',
  'mc_wake_agent', 'mc_write_knowledge_file', 'mc_write_memory', 'mc_write_soul',
].sort()

describe('buildMcpTools — parity with mc-mcp-server.cjs', () => {
  it('admin tool set matches the 49 tools in the stdio server', () => {
    const adminTools = getRegisteredToolNames('admin')
    expect(adminTools).toEqual(EXPECTED_TOOLS)
  })

  it('stdio server has exactly 49 tools', () => {
    const cjs = readFileSync(
      resolve(process.cwd(), 'scripts/mc-mcp-server.cjs'),
      'utf-8',
    )
    const names = [...cjs.matchAll(/name: '(mc_[^']+)'/g)].map(m => m[1]).sort()
    expect(names).toHaveLength(49)
    expect(names).toEqual(EXPECTED_TOOLS)
  })
})

// ─── fetch proxy ─────────────────────────────────────────────────────────────

describe('buildMcpTools — HTTP proxy', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let server: McpServer
  let tools: Record<string, { handler: (args: unknown) => Promise<unknown> }>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    server = new McpServer({ name: 'test', version: '0.0.0' })
    buildMcpTools(server, 'admin', 1, 'http://localhost:3000', 'my-api-key')
    tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }> })._registeredTools
  })

  it('mc_list_agents calls GET /api/agents', async () => {
    await tools.mc_list_agents.handler({})
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents?',
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ 'x-api-key': 'my-api-key' }) })
    )
  })

  it('mc_get_task calls GET /api/tasks/:id', async () => {
    await tools.mc_get_task.handler({ id: 42 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/tasks/42',
      expect.objectContaining({ method: 'GET' })
    )
  })

  it('mc_create_task posts body to /api/tasks', async () => {
    await tools.mc_create_task.handler({ title: 'Do the thing', priority: 'high' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/tasks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"title":"Do the thing"'),
      })
    )
  })

  it('mc_add_comment posts to /api/tasks/:id/comments', async () => {
    await tools.mc_add_comment.handler({ task_id: 7, content: 'Hello' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/tasks/7/comments',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('mc_search_knowledge passes query param', async () => {
    await tools.mc_search_knowledge.handler({ q: 'auth flow' })
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/memory/search?')
    expect(url).toContain('q=auth+flow')
  })

  it('mc_write_soul uses PUT', async () => {
    await tools.mc_write_soul.handler({ id: 'copilot', soul_content: 'Be helpful.' })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/agents/copilot/soul',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('mc_attach_eval puts to run eval endpoint', async () => {
    await tools.mc_attach_eval.handler({ run_id: 'run-abc', pass: true, score: 95 })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/runs/run-abc/eval',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('forwards x-api-key header on every call', async () => {
    await tools.mc_status.handler({})
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.headers['x-api-key']).toBe('my-api-key')
  })
})
