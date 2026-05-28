import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
import { getWeeklyUsage, isAgentOverLimit, setAgentLimit, getAgentLimit, limitUsagePercent } from '@/lib/agent-limits'

describe('agent_limits table', () => {
  it('creates agent_limits table via migration', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_limits'"
    ).get()
    expect(row).toBeTruthy()
  })
})

describe('getWeeklyUsage', () => {
  it('returns zero for unknown agent', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const u = getWeeklyUsage(db, 'nobody', 1)
    expect(u.tokens).toBe(0)
    expect(u.costUsd).toBe(0)
  })
})

describe('isAgentOverLimit', () => {
  it('returns false when no limit set', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(false)
  })

  it('returns true when token usage exceeds limit', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'codex', { weeklyTokenLimit: 1000, workspaceId: 1 })
    db.prepare(`
      INSERT INTO token_usage
        (model, session_id, input_tokens, output_tokens, agent_name, workspace_id, created_at)
      VALUES ('claude-sonnet', 'sess-1', 600, 500, 'codex', 1, unixepoch())
    `).run()
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(true)
  })

  it('returns false when under limit', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'codex', { weeklyTokenLimit: 10000, workspaceId: 1 })
    db.prepare(`
      INSERT INTO token_usage
        (model, session_id, input_tokens, output_tokens, agent_name, workspace_id, created_at)
      VALUES ('claude-sonnet', 'sess-2', 100, 100, 'codex', 1, unixepoch())
    `).run()
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(false)
  })
})

describe('setAgentLimit / getAgentLimit', () => {
  it('upserts limits correctly', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'hermes', { weeklyTokenLimit: 5000, weeklyUsdLimit: 2.5, workspaceId: 1 })
    const l = getAgentLimit(db, 'hermes', 1)
    expect(l?.weeklyTokenLimit).toBe(5000)
    expect(l?.weeklyUsdLimit).toBe(2.5)
    // upsert update
    setAgentLimit(db, 'hermes', { weeklyTokenLimit: 9999, workspaceId: 1 })
    expect(getAgentLimit(db, 'hermes', 1)?.weeklyTokenLimit).toBe(9999)
  })
})

describe('limitUsagePercent', () => {
  it('returns 0 when no limit', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(limitUsagePercent(db, 'nobody', 1)).toBe(0)
  })

  it('returns correct percent', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'copilot', { weeklyTokenLimit: 1000, workspaceId: 1 })
    db.prepare(`
      INSERT INTO token_usage
        (model, session_id, input_tokens, output_tokens, agent_name, workspace_id, created_at)
      VALUES ('gpt-4', 'sess-3', 300, 200, 'copilot', 1, unixepoch())
    `).run()
    expect(limitUsagePercent(db, 'copilot', 1)).toBe(50)
  })
})
