import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { setAgentLimit } from '@/lib/agent-limits'
import { z } from 'zod'

const setLimitSchema = z.object({
  agent_name: z.string().min(1),
  weekly_token_limit: z.number().int().positive().nullable().optional(),
  weekly_usd_limit: z.number().positive().nullable().optional(),
})

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const limits = db.prepare(
    'SELECT * FROM agent_limits WHERE workspace_id = ? ORDER BY agent_name'
  ).all(workspaceId)
  return NextResponse.json({ limits })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json().catch(() => null)
  const parsed = setLimitSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }
  const { agent_name, weekly_token_limit, weekly_usd_limit } = parsed.data
  const db = getDatabase()
  setAgentLimit(db, agent_name, {
    weeklyTokenLimit: weekly_token_limit ?? null,
    weeklyUsdLimit: weekly_usd_limit ?? null,
    workspaceId: auth.user.workspace_id ?? 1,
  })
  return NextResponse.json({ ok: true })
}
