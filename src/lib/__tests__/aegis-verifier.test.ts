import { describe, it, expect } from 'vitest'
import { extractVerificationSignals, meetsApprovalThreshold } from '@/lib/aegis-verifier'

describe('extractVerificationSignals', () => {
  it('detects test pass signal', () => {
    const s = extractVerificationSignals('All tests passed. pnpm test: 12 passed. typecheck clean.')
    expect(s.testsPass).toBe(true)
    expect(s.typecheckPass).toBe(true)
    expect(s.noInnerHTML).toBe(true)
    expect(s.hasResolution).toBe(true)
  })

  it('detects innerHTML violation', () => {
    const s = extractVerificationSignals('Added innerHTML to content.js for rendering')
    expect(s.noInnerHTML).toBe(false)
  })

  it('rejects empty resolution', () => {
    const s = extractVerificationSignals('done')
    expect(s.hasResolution).toBe(false)
  })

  it('detects test pass from numeric count', () => {
    const s = extractVerificationSignals('8 passed, 0 failed. pnpm typecheck pass.')
    expect(s.testsPass).toBe(true)
    expect(s.typecheckPass).toBe(true)
  })

  it('returns false for testsPass when no test signal', () => {
    const s = extractVerificationSignals('Implementation complete. typecheck clean. No issues found.')
    expect(s.testsPass).toBe(false)
    expect(s.typecheckPass).toBe(true)
  })
})

describe('meetsApprovalThreshold', () => {
  it('approves when all signals present', () => {
    expect(meetsApprovalThreshold({
      testsPass: true, typecheckPass: true, noInnerHTML: true, hasResolution: true
    })).toBe(true)
  })

  it('rejects when tests missing', () => {
    expect(meetsApprovalThreshold({
      testsPass: false, typecheckPass: true, noInnerHTML: true, hasResolution: true
    })).toBe(false)
  })

  it('rejects when typecheck missing', () => {
    expect(meetsApprovalThreshold({
      testsPass: true, typecheckPass: false, noInnerHTML: true, hasResolution: true
    })).toBe(false)
  })

  it('rejects when innerHTML present', () => {
    expect(meetsApprovalThreshold({
      testsPass: true, typecheckPass: true, noInnerHTML: false, hasResolution: true
    })).toBe(false)
  })

  it('rejects when resolution missing', () => {
    expect(meetsApprovalThreshold({
      testsPass: true, typecheckPass: true, noInnerHTML: true, hasResolution: false
    })).toBe(false)
  })
})
