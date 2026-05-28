export interface VerificationSignals {
  testsPass: boolean
  typecheckPass: boolean
  noInnerHTML: boolean
  hasResolution: boolean
}

const TEST_PASS = /\b(tests? pass|all tests|passed|pnpm test.*pass|\d+ passed)/i
const TYPE_PASS = /\b(typecheck.*(pass|clean)|tsc.*(clean|pass)|no.*type.*error|pnpm typecheck)/i
const INNERHTML = /innerHTML/i

export function extractVerificationSignals(resolution: string): VerificationSignals {
  return {
    testsPass:     TEST_PASS.test(resolution),
    typecheckPass: TYPE_PASS.test(resolution),
    noInnerHTML:   !INNERHTML.test(resolution),
    hasResolution: resolution.trim().length > 20,
  }
}

export function meetsApprovalThreshold(signals: VerificationSignals): boolean {
  return signals.testsPass
    && signals.typecheckPass
    && signals.noInnerHTML
    && signals.hasResolution
}
