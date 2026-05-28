# ADR-002: Self-Pickup Task Dispatch

**Status:** Accepted | **Date:** 2026-05-28

## Context

Agent frameworks vary — some support push, some only pull. Need universal dispatch.

## Decision

Agents poll `GET /api/tasks/queue?agent=<name>`. MC does not push.

## Consequences

- Works with any agent that can make HTTP calls
- Pickup latency = poll interval (default 30s)
- Phase 3: SSE push as opt-in for online agents, poll remains fallback
