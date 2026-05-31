import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { buildMcpTools } from '@/lib/mcp-tools'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

// Per-agent rate limit: calls per minute window (configurable via env)
const MCP_RATE_LIMIT = parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? '120', 10)

function getMcBaseUrl(req: NextRequest): string {
  // For internal server-to-server calls, always use localhost with the actual server port.
  // The Host header reflects the external port (e.g. 3001 in Docker) which is not
  // reachable from within the container itself. The server always binds to PORT internally.
  const port = process.env.PORT ?? '3000'
  return `http://localhost:${port}`
}

function getApiKey(req: NextRequest): string {
  return req.headers.get('x-api-key') ?? ''
}

/** Parse the MCP tool name from a tools/call request body (best-effort). */
async function parseMcpToolName(req: NextRequest): Promise<string | null> {
  try {
    const body = await req.clone().json()
    if (body?.method === 'tools/call' && typeof body?.params?.name === 'string') {
      return body.params.name
    }
  } catch {}
  return null
}

/** Check per-agent rate limit using a 60-second sliding window in the audit log. */
function checkRateLimit(agentId: number, workspaceId: number): boolean {
  try {
    const db = getDatabase()
    const windowStart = Math.floor(Date.now() / 1000) - 60
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt FROM mcp_audit_log
      WHERE agent_id = ? AND workspace_id = ? AND called_at >= ?
    `).get(agentId, workspaceId, windowStart) as { cnt: number } | undefined
    return (row?.cnt ?? 0) < MCP_RATE_LIMIT
  } catch {
    return true // fail open during startup
  }
}

/** Write one row to mcp_audit_log. Best-effort — never throws. */
function logMcpCall(
  username: string,
  agentId: number | null | undefined,
  agentName: string | null | undefined,
  workspaceId: number,
  toolName: string | null,
  status: 'ok' | 'rate_limited' | 'auth_error',
): void {
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO mcp_audit_log (agent_id, agent_name, username, tool_name, workspace_id, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agentId ?? null, agentName ?? null, username, toolName, workspaceId, status)
  } catch (err) {
    logger.warn({ err }, 'mcp_audit_log write failed')
  }
}

export async function POST(request: NextRequest) {
  // Minimum role required to use the MCP endpoint at all is viewer
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { user } = auth
  const mcBaseUrl = getMcBaseUrl(request)
  const apiKey = getApiKey(request)

  // Parse tool name before the transport consumes the body
  const toolName = await parseMcpToolName(request)

  // Per-agent rate limiting (only applies to agent-scoped keys)
  if (user.agent_id != null) {
    const allowed = checkRateLimit(user.agent_id, user.workspace_id)
    if (!allowed) {
      logMcpCall(user.username, user.agent_id, user.agent_name, user.workspace_id, toolName, 'rate_limited')
      return NextResponse.json(
        { error: `Rate limit exceeded: max ${MCP_RATE_LIMIT} MCP calls per minute per agent` },
        { status: 429 },
      )
    }
  }

  // Audit log: record this call (best-effort, non-blocking)
  logMcpCall(user.username, user.agent_id, user.agent_name, user.workspace_id, toolName, 'ok')

  const server = new McpServer({ name: 'mission-control', version: '2.0.1' })
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — safe for buffering proxies
    enableJsonResponse: true,      // return JSON not SSE; simpler for agents and proxies
  })

  try {
    buildMcpTools(server, user.role, user.workspace_id, mcBaseUrl, apiKey)
    await server.connect(transport)
    return await transport.handleRequest(request)
  } finally {
    await transport.close()
    await server.close()
  }
}

// MCP over HTTP is POST-only (stateless JSON transport, no SSE sessions)
export function GET() {
  return NextResponse.json({ error: 'Use POST for MCP requests' }, { status: 405 })
}
