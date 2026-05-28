export type PolicyRouteAction = 'allow' | 'approval_required' | 'reject'
export type PolicyAuditSeverity = 'info' | 'warning' | 'error'
export type PolicyRecommendationConfidence = 'high' | 'medium' | 'low'
export type PolicyRecommendationProvider = 'local' | 'bifrost'

export interface PolicyRouteRequest {
  taskId: string
  title: string
  description?: string | null
  tags?: string[]
  metadata?: Record<string, unknown> | null
  budget?: {
    maxUsd?: number | null
    estimatedUsd?: number | null
  } | null
  tools?: string[]
  requestedAgent?: string | null
  workspaceId?: string | null
}

export interface PolicyRouteDecision {
  action: PolicyRouteAction
  target?: string
  recommendation?: PolicyRouteRecommendation
  reason: string
  audit: {
    eventType: 'policy_route_decision'
    severity: PolicyAuditSeverity
  }
}

export interface PolicyRouteRecommendation {
  agent: string
  model: string
  provider: PolicyRecommendationProvider
  endpoint: string
  confidence: PolicyRecommendationConfidence
  reason: string
}

function hasTool(request: PolicyRouteRequest, tool: string): boolean {
  return request.tools?.includes(tool) ?? false
}

function hasApprovedSecretScope(metadata: PolicyRouteRequest['metadata']): boolean {
  return metadata?.approvedSecretScope === true
}

function metadataString(metadata: PolicyRouteRequest['metadata'], key: string): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function requestText(request: PolicyRouteRequest): string {
  return `${request.title} ${request.description ?? ''} ${(request.tags ?? []).join(' ')}`.toLowerCase()
}

function isCloudAgent(agent: string | null | undefined): boolean {
  return typeof agent === 'string' && agent.toLowerCase().includes('cloud')
}

function exceedsBudgetCap(request: PolicyRouteRequest): boolean {
  const maxUsd = request.budget?.maxUsd
  const estimatedUsd = request.budget?.estimatedUsd
  return typeof maxUsd === 'number' && typeof estimatedUsd === 'number' && estimatedUsd > maxUsd
}

function containsPii(request: PolicyRouteRequest): boolean {
  const text = `${request.title} ${request.description ?? ''}`
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)
    || /\b(?:\+?\d[\d .-]{7,}\d)\b/.test(text)
}

function inferredPrivacyClass(request: PolicyRouteRequest): string | null {
  const explicit = metadataString(request.metadata, 'privacyClass')
  if (explicit) return explicit

  const text = requestText(request)
  const localOnlyKeywords = ['api token', 'secret', 'credential', 'password', 'private key', 'leaked']
  return localOnlyKeywords.some((keyword) => text.includes(keyword)) ? 'local_only' : null
}

function usesSideEffectingTool(request: PolicyRouteRequest): boolean {
  const sideEffectingTools = new Set([
    'repo.write',
    'shell.exec',
    'db.write',
    'git.push',
    'message.send',
  ])
  return request.tools?.some((tool) => sideEffectingTools.has(tool)) ?? false
}

function inferredDomain(request: PolicyRouteRequest): string {
  const explicit = metadataString(request.metadata, 'domain')
  if (explicit) return explicit.toLowerCase()

  const text = requestText(request)
  if (/(terminal|shell|bash|cli|git|ci|workflow|infra|automation)/.test(text)) return 'terminal'
  if (/(security|threat|audit|vulnerability|secret|token)/.test(text)) return 'security'
  if (/(research|summarize|analysis|investigate)/.test(text)) return 'research'
  if (/(code|coding|implement|debug|refactor|test)/.test(text)) return 'coding'
  return 'coding'
}

function inferredQuality(request: PolicyRouteRequest): string {
  const explicit = metadataString(request.metadata, 'quality')
  if (explicit) return explicit.toLowerCase()

  const text = requestText(request)
  if (/(expert|architecture|security|complex|critical)/.test(text)) return 'expert'
  return 'standard'
}

function buildRecommendation(request: PolicyRouteRequest, privacyClass: string | null): PolicyRouteRecommendation {
  const domain = inferredDomain(request)
  const quality = inferredQuality(request)

  if (privacyClass === 'local_only' && domain === 'coding') {
    return {
      agent: 'pi',
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      endpoint: 'http://localhost:11434/v1',
      confidence: 'high',
      reason: 'local_only coding task routes to Pi with a local coding model.',
    }
  }

  if (privacyClass === 'local_only') {
    return {
      agent: 'hermes',
      model: 'llama3.2',
      provider: 'local',
      endpoint: 'http://localhost:11434/v1',
      confidence: 'high',
      reason: 'local_only reasoning task routes to Hermes with a local model.',
    }
  }

  if (domain === 'terminal' || domain === 'ci' || domain === 'infra') {
    return {
      agent: 'codex',
      model: 'openai-codex/gpt-5.5',
      provider: 'bifrost',
      endpoint: 'http://localhost:8080/v1',
      confidence: 'high',
      reason: `Domain ${domain} matches Codex terminal automation strengths.`,
    }
  }

  if (quality === 'expert' && domain === 'security') {
    return {
      agent: 'claude-code',
      model: 'anthropic/claude-opus-4-7',
      provider: 'bifrost',
      endpoint: 'http://localhost:8080/v1',
      confidence: 'high',
      reason: 'Expert security work routes to Claude Code with Opus.',
    }
  }

  if (quality === 'expert' || domain === 'architecture') {
    return {
      agent: 'claude-code',
      model: 'anthropic/claude-sonnet-4-6',
      provider: 'bifrost',
      endpoint: 'http://localhost:8080/v1',
      confidence: 'high',
      reason: 'Expert coding or architecture work routes to Claude Code.',
    }
  }

  if (domain === 'research') {
    return {
      agent: 'hermes',
      model: 'llama3.2',
      provider: 'local',
      endpoint: 'http://localhost:11434/v1',
      confidence: 'medium',
      reason: 'Research task defaults to Hermes for local reasoning.',
    }
  }

  return {
    agent: 'pi',
    model: 'qwen2.5-coder:7b',
    provider: 'local',
    endpoint: 'http://localhost:11434/v1',
    confidence: 'medium',
    reason: 'Default coding route uses Pi with a local coding model.',
  }
}

export async function routePolicy(request: PolicyRouteRequest): Promise<PolicyRouteDecision> {
  const privacyClass = inferredPrivacyClass(request)
  const recommendation = buildRecommendation(request, privacyClass)

  if (privacyClass === 'local_only' && isCloudAgent(request.requestedAgent)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      recommendation,
      reason: 'local_only tasks cannot be routed to cloud agents.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (exceedsBudgetCap(request)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      recommendation,
      reason: 'Estimated task cost exceeds the configured budget cap.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (hasTool(request, 'secrets.read') && !hasApprovedSecretScope(request.metadata)) {
    return {
      action: 'reject',
      target: request.requestedAgent ?? undefined,
      recommendation,
      reason: 'Secret access is blocked unless an approved secret scope is present.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'error',
      },
    }
  }

  if (
    privacyClass === 'cloud_ok'
    && isCloudAgent(request.requestedAgent)
    && containsPii(request)
  ) {
    return {
      action: 'allow',
      target: metadataString(request.metadata, 'localPreferredAgent') ?? undefined,
      recommendation,
      reason: 'PII detected in cloud-ok task; routing to local preferred agent.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  if (isCloudAgent(request.requestedAgent) && hasTool(request, 'repo.write')) {
    return {
      action: 'approval_required',
      target: request.requestedAgent ?? undefined,
      recommendation,
      reason: 'Cloud write-capable delegation requires explicit approval.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  if (usesSideEffectingTool(request)) {
    return {
      action: 'approval_required',
      target: request.requestedAgent ?? undefined,
      recommendation,
      reason: 'Side-effecting tools require explicit approval before dispatch.',
      audit: {
        eventType: 'policy_route_decision',
        severity: 'warning',
      },
    }
  }

  return {
    action: 'allow',
    target: request.requestedAgent ?? recommendation.agent,
    recommendation,
    reason: 'Task stays within local execution policy.',
    audit: {
      eventType: 'policy_route_decision',
      severity: 'info',
    },
  }
}
