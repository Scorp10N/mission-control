# ADR-003: Aegis Quality Gate

**Status:** Accepted (amended 2026-05-28) | **Date:** 2026-05-28

## Context

Tasks need a reviewer distinct from the implementer to prevent self-approval.

## Decision

Require `quality_reviews` row with `reviewer=aegis, status=approved` before `done` transition.

## Amendment

Aegis auto-approval now requires machine-checkable signals: test pass, typecheck pass, no innerHTML. See `src/lib/aegis-verifier.ts`.

## Consequences

- Prevents agent self-approval loops
- Per-task `gate_config` (Phase 2) will allow `aegis_optional` for low-risk tasks
