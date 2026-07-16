import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { resolveTaskDispatchModelOverride, buildPolicyRequestFromTask, insertDispatchTokenUsage } from '@/lib/task-dispatch'

describe('insertDispatchTokenUsage', () => {
  it('persists dispatch usage using the current token_usage schema', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE token_usage (
        model TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        workspace_id INTEGER NOT NULL,
        cost_usd REAL
      )
    `)

    insertDispatchTokenUsage(db, {
      model: 'test-model',
      sessionId: 'task-42',
      inputTokens: 120,
      outputTokens: 30,
      workspaceId: 7,
    }, 1_700_000_000)

    expect(db.prepare('SELECT * FROM token_usage').get()).toEqual({
      model: 'test-model',
      session_id: 'task-42',
      input_tokens: 120,
      output_tokens: 30,
      created_at: 1_700_000_000,
      workspace_id: 7,
      cost_usd: 0,
    })
    db.close()
  })
})

describe('resolveTaskDispatchModelOverride', () => {
  it('returns null when the agent has no explicit dispatch model override', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: null })).toBeNull()
    expect(resolveTaskDispatchModelOverride({ agent_config: '{"openclawId":"main"}' })).toBeNull()
  })

  it('returns the explicit dispatch model override when present', () => {
    expect(
      resolveTaskDispatchModelOverride({
        agent_config: '{"openclawId":"main","dispatchModel":"openai-codex/gpt-5.4"}',
      })
    ).toBe('openai-codex/gpt-5.4')
  })

  it('ignores malformed agent config payloads', () => {
    expect(resolveTaskDispatchModelOverride({ agent_config: '{not json' })).toBeNull()
  })
})

describe('buildPolicyRequestFromTask', () => {
  it('maps task fields to a PolicyRouteRequest', () => {
    const req = buildPolicyRequestFromTask(
      { id: 42, title: 'Fix login bug', description: 'Auth is broken', assigned_to: 'cloud-agent', workspace_id: 1, tags: ['auth', 'backend'] },
      { maxCostUsd: 2.0 },
      ['repo.read', 'repo.write'],
    )
    expect(req.taskId).toBe('42')
    expect(req.title).toBe('Fix login bug')
    expect(req.requestedAgent).toBe('cloud-agent')
    expect(req.tools).toEqual(['repo.read', 'repo.write'])
    expect(req.budget?.maxUsd).toBe(2.0)
    expect(req.tags).toEqual(['auth', 'backend'])
    expect(req.workspaceId).toBe('1')
  })

  it('handles null description and absent tags gracefully', () => {
    const req = buildPolicyRequestFromTask(
      { id: 1, title: 'Quick task', description: null, assigned_to: null, workspace_id: 2 },
      {},
      [],
    )
    expect(req.description).toBeNull()
    expect(req.tags).toEqual([])
    expect(req.requestedAgent).toBeNull()
    expect(req.budget).toBeNull()
  })

  it('passes metadata through to the policy request', () => {
    const meta = { privacyClass: 'local_only', approvedSecretScope: true }
    const req = buildPolicyRequestFromTask(
      { id: 1, title: 'Secret task', description: null, assigned_to: 'hermes', workspace_id: 1 },
      meta,
      [],
    )
    expect(req.metadata).toEqual(meta)
  })
})
