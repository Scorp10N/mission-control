import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getWeeklyUsage, getAgentLimit, limitUsagePercent } from '@/lib/agent-limits'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const agents = db.prepare(
    'SELECT DISTINCT agent_name FROM token_usage WHERE workspace_id = ? AND agent_name IS NOT NULL'
  ).all(workspaceId) as { agent_name: string }[]

  const usage = agents.map(({ agent_name }) => ({
    agent: agent_name,
    ...getWeeklyUsage(db, agent_name, workspaceId),
    limit: getAgentLimit(db, agent_name, workspaceId),
    percent: Math.round(limitUsagePercent(db, agent_name, workspaceId)),
  }))

  return NextResponse.json({ usage })
}
