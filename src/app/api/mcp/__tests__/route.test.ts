import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth before importing route (vi.hoisted ensures this runs first)
vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(() => Promise.resolve({ user: { role: 'admin', workspace_id: 1 } })),
}))

// Mock mcp-tools — we test route plumbing here, not tool execution
vi.mock('@/lib/mcp-tools', () => ({
  buildMcpTools: vi.fn(),
}))

// Mock SDK
const mockTransportHandleRequest = vi.fn()
const mockTransportClose = vi.fn()
const mockServerConnect = vi.fn()
const mockServerClose = vi.fn()

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn(() => ({
    connect: mockServerConnect,
    close: mockServerClose,
  })),
}))

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn(() => ({
    handleRequest: mockTransportHandleRequest,
    close: mockTransportClose,
  })),
}))

import { POST, GET } from '@/app/api/mcp/route'
import { requireRole } from '@/lib/auth'
import { buildMcpTools } from '@/lib/mcp-tools'

function makeRequest(overrides: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'test-api-key',
      ...overrides,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  })
}

describe('/api/mcp route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTransportHandleRequest.mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    mockTransportClose.mockResolvedValue(undefined)
    mockServerConnect.mockResolvedValue(undefined)
    mockServerClose.mockResolvedValue(undefined)
  })

  it('GET returns 405', async () => {
    const res = await GET()
    expect(res.status).toBe(405)
  })

  it('returns 401 when auth fails', async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: 'Unauthorized', status: 401 } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 403 when role is insufficient', async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({ error: 'Forbidden', status: 403 } as any)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(403)
  })

  it('calls buildMcpTools with correct role and workspace', async () => {
    vi.mocked(requireRole).mockResolvedValueOnce({
      user: { role: 'operator', workspace_id: 42 },
    } as any)
    await POST(makeRequest() as any)
    expect(buildMcpTools).toHaveBeenCalledWith(
      expect.anything(), // McpServer instance
      'operator',
      42,
      expect.stringContaining('localhost'),
      'test-api-key',
    )
  })

  it('calls transport.close() even if handleRequest throws', async () => {
    mockTransportHandleRequest.mockRejectedValueOnce(new Error('boom'))
    await expect(POST(makeRequest() as any)).rejects.toThrow('boom')
    expect(mockTransportClose).toHaveBeenCalledOnce()
    expect(mockServerClose).toHaveBeenCalledOnce()
  })

  it('delegates to transport.handleRequest for valid requests', async () => {
    const req = makeRequest()
    await POST(req as any)
    expect(mockTransportHandleRequest).toHaveBeenCalledWith(req)
  })
})
