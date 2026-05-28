import type Database from 'better-sqlite3'

export interface AgentLimit {
  agentName: string
  weeklyTokenLimit: number | null
  weeklyUsdLimit: number | null
  workspaceId: number
}

export interface WeeklyUsage {
  tokens: number
  costUsd: number
}

function weekStartEpoch(): number {
  const now = new Date()
  const day = now.getUTCDay()
  const daysToMon = day === 0 ? 6 : day - 1
  const mon = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - daysToMon
  ))
  return Math.floor(mon.getTime() / 1000)
}

export function getWeeklyUsage(
  db: Database.Database, agentName: string, workspaceId: number
): WeeklyUsage {
  const start = weekStartEpoch()
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM token_usage
    WHERE agent_name = ? AND workspace_id = ? AND created_at >= ?
  `).get(agentName, workspaceId, start) as { tokens: number; cost_usd: number }
  return { tokens: row.tokens, costUsd: row.cost_usd }
}

export function getAgentLimit(
  db: Database.Database, agentName: string, workspaceId: number
): AgentLimit | null {
  const row = db.prepare(
    'SELECT * FROM agent_limits WHERE agent_name = ? AND workspace_id = ?'
  ).get(agentName, workspaceId) as {
    weekly_token_limit: number | null; weekly_usd_limit: number | null
  } | undefined
  if (!row) return null
  return {
    agentName,
    workspaceId,
    weeklyTokenLimit: row.weekly_token_limit,
    weeklyUsdLimit: row.weekly_usd_limit,
  }
}

export function setAgentLimit(
  db: Database.Database,
  agentName: string,
  opts: { weeklyTokenLimit?: number | null; weeklyUsdLimit?: number | null; workspaceId: number }
): void {
  db.prepare(`
    INSERT INTO agent_limits
      (agent_name, weekly_token_limit, weekly_usd_limit, workspace_id, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(agent_name, workspace_id) DO UPDATE SET
      weekly_token_limit = excluded.weekly_token_limit,
      weekly_usd_limit   = excluded.weekly_usd_limit,
      updated_at         = unixepoch()
  `).run(
    agentName,
    opts.weeklyTokenLimit ?? null,
    opts.weeklyUsdLimit ?? null,
    opts.workspaceId
  )
}

export function isAgentOverLimit(
  db: Database.Database, agentName: string, workspaceId: number
): boolean {
  const limit = getAgentLimit(db, agentName, workspaceId)
  if (!limit) return false
  const usage = getWeeklyUsage(db, agentName, workspaceId)
  if (limit.weeklyTokenLimit !== null && usage.tokens >= limit.weeklyTokenLimit) return true
  if (limit.weeklyUsdLimit !== null && usage.costUsd >= limit.weeklyUsdLimit) return true
  return false
}

export function limitUsagePercent(
  db: Database.Database, agentName: string, workspaceId: number
): number {
  const limit = getAgentLimit(db, agentName, workspaceId)
  if (!limit) return 0
  const usage = getWeeklyUsage(db, agentName, workspaceId)
  const tPct = limit.weeklyTokenLimit ? usage.tokens / limit.weeklyTokenLimit : 0
  const uPct = limit.weeklyUsdLimit ? usage.costUsd / limit.weeklyUsdLimit : 0
  return Math.max(tPct, uPct) * 100
}
