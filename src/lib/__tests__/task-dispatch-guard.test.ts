import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/policy-router', () => ({ routePolicy: vi.fn() }))
vi.mock('@/lib/command', () => ({ runOpenClaw: vi.fn() }))
vi.mock('@/lib/openclaw-gateway', () => ({ callOpenClawGateway: vi.fn() }))
vi.mock('@/lib/event-bus', () => ({ eventBus: { broadcast: vi.fn() } }))
vi.mock('@/lib/github-sync-engine', () => ({ syncTaskOutbound: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/config', () => ({ config: { openclawHome: null, dbPath: ':memory:' } }))

const mockLogActivity = vi.fn()
const mockDbRun = vi.fn()
const mockDbGet = vi.fn()
const mockDbAll = vi.fn()

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => mockDbAll(sql, ...args),
      get: (...args: unknown[]) => mockDbGet(sql, ...args),
      run: (...args: unknown[]) => mockDbRun(sql, ...args),
    }),
  }),
  db_helpers: {
    get logActivity() { return mockLogActivity },
  },
}))

import { routePolicy } from '@/lib/policy-router'
import { runOpenClaw } from '@/lib/command'

const mockRoutePolicy = routePolicy as ReturnType<typeof vi.fn>
const mockRunOpenClaw = runOpenClaw as ReturnType<typeof vi.fn>

import { dispatchAssignedTasks } from '@/lib/task-dispatch'

const baseTask = {
  id: 1,
  title: 'Implement auth',
  description: 'Add OAuth2',
  status: 'assigned',
  priority: 'medium',
  assigned_to: 'cloud-agent',
  workspace_id: 1,
  agent_name: 'cloud-agent',
  agent_id: 1,
  agent_config: null,
  ticket_prefix: null,
  project_ticket_no: null,
  project_id: null,
  tags: '[]',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDbAll.mockImplementation((sql: string) =>
    sql.includes('JOIN agents') ? [baseTask] : []
  )
  mockDbGet.mockImplementation((sql: string) => {
    if (sql.includes('SELECT metadata')) return { metadata: '{}' }
    if (sql.includes('dispatch_attempts')) return { dispatch_attempts: 0 }
    if (sql.includes('estimated_hours')) return { estimated_hours: null }
    if (sql.includes('FROM gateways')) return { c: 0 }
    if (sql.includes('COUNT(*)')) return { c: 0 }
    return undefined
  })
})

describe('dispatchAssignedTasks policy guard', () => {
  it('skips queue-driven local agents instead of invoking OpenClaw', async () => {
    const localTask = {
      ...baseTask,
      assigned_to: 'codex',
      agent_name: 'codex',
      agent_config: JSON.stringify({
        framework: 'codex-cli',
        capabilities: ['coding', 'file-editing', 'test-running', 'parallel-execution', 'worktrees'],
      }),
    }
    mockDbAll.mockImplementation((sql: string) =>
      sql.includes('JOIN agents') ? [localTask] : []
    )

    const result = await dispatchAssignedTasks()

    expect(mockRoutePolicy).not.toHaveBeenCalled()
    expect(mockRunOpenClaw).not.toHaveBeenCalled()
    expect(mockDbRun).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
    expect(result.ok).toBe(true)
    expect(result.message).toContain('Skipped 1 queue-driven task')
  })

  it('does not call runOpenClaw when policy rejects the task', async () => {
    mockRoutePolicy.mockResolvedValue({
      action: 'reject',
      reason: 'local_only tasks cannot be routed to cloud agents.',
      audit: { eventType: 'policy_route_decision', severity: 'error' },
    })

    const result = await dispatchAssignedTasks()

    expect(mockRunOpenClaw).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Policy rejected')
  })

  it('does not call runOpenClaw when policy requires approval', async () => {
    mockRoutePolicy.mockResolvedValue({
      action: 'approval_required',
      reason: 'Side-effecting tools require explicit approval before dispatch.',
      audit: { eventType: 'policy_route_decision', severity: 'warning' },
    })

    const result = await dispatchAssignedTasks()

    expect(mockRunOpenClaw).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Approval required')
  })

  it('records a policy_route_decision activity event for every dispatched task', async () => {
    mockRoutePolicy.mockResolvedValue({
      action: 'reject',
      reason: 'test rejection',
      audit: { eventType: 'policy_route_decision', severity: 'error' },
    })

    await dispatchAssignedTasks()

    expect(mockLogActivity).toHaveBeenCalledWith(
      'policy_route_decision',
      'task',
      1,
      'policy-router',
      expect.stringContaining('Policy:'),
      expect.objectContaining({ action: 'reject' }),
      1,
    )
  })

  it('reverts task to assigned with error_message when policy rejects', async () => {
    mockRoutePolicy.mockResolvedValue({
      action: 'reject',
      reason: 'Budget exceeded.',
      audit: { eventType: 'policy_route_decision', severity: 'error' },
    })

    await dispatchAssignedTasks()

    const updateCall = mockDbRun.mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('UPDATE tasks SET status') && args[0].includes('error_message')
    )
    expect(updateCall).toBeDefined()
    expect(updateCall![1]).toBe('assigned')
    expect(updateCall![2]).toContain('Policy rejected')
  })
})
