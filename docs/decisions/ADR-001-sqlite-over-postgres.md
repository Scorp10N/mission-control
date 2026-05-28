# ADR-001: SQLite over PostgreSQL

**Status:** Accepted | **Date:** 2026-05-28

## Context

MC is a personal/small-team platform. Single-node Docker deployment. Operational simplicity over throughput.

## Decision

SQLite with WAL mode. better-sqlite3 provides synchronous API simplifying Next.js routes.

## Consequences

- Zero infrastructure, file-based backup, ships in Docker without deps
- Serialized writes under concurrent load
- **Tripwire for migration:** >10 concurrent agents with write latency >100ms, OR database file >10GB, OR multi-node required
