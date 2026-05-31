import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { buildMcpTools } from '@/lib/mcp-tools'

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

export async function POST(request: NextRequest) {
  // Minimum role required to use the MCP endpoint at all is viewer
  const auth = await requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const { user } = auth
  const mcBaseUrl = getMcBaseUrl(request)
  const apiKey = getApiKey(request)

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
