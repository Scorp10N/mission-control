# Mission Control Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MC Phase 1 improvements in urgency order: weekly cost caps, task dependencies, Aegis hardening, Hermes coordinator upgrade with Copilot CLI support.

**Architecture:** Four parallel tracks (A–D) + documentation track (E). Tracks are independent — dispatch simultaneously. Each task has CHECKPOINT markers for session-limit handover. Hermes runs coordinate-foundations.mjs to dispatch, monitor every 60s, and reassign stalled tasks (>30min) to fallback agents.

**Tech Stack:** TypeScript, Next.js 16, SQLite (better-sqlite3), Vitest, Node.js ESM (scripts).

**Agent roster:**
- `hermes` — coordinator, monitor, general research, Track D
- `codex` — primary implementer, Tracks A + B-1 + C
- `copilot-cli` — secondary implementer, Track B-2, docs
- `pi` — documentation, Track E
- `claude-code` — review, architecture

**Handover protocol (read if picking up a stalled task):**
1. `mc tasks get --id <N> --json` — read `resolution` and last comment
2. Find the `### CHECKPOINT` marker for this task in this plan
3. Check completed steps: `git log --oneline -10` in ~/Projects/mission-control
4. Continue from first unchecked step

---

## Coordination: Hermes as Dispatcher

Hermes runs this to create and monitor all child tasks:

```bash
cd ~/Projects/mission-control
node scripts/coordinate-foundations.mjs
```

Script created in Task D-1. Creates MC tasks for every track, polls every 60s, logs progress, reassigns stalled tasks to fallback agent.

---

## Track A — Cost Caps and Alerts (DISPATCH FIRST — most urgent)

*The Fool finding #1: cost caps were Phase 3 but are needed now.*

**Files:**
- Create: `src/lib/agent-limits.ts`
- Create: `src/app/api/limits/route.ts`
- Create: `src/app/api/limits/usage/route.ts`
- Create: `src/lib/__tests__/agent-limits.test.ts`
- Modify: `src/lib/task-dispatch.ts`
- Modify: `src/lib/db.ts`

### Task A-1: agent_limits table migration

**Assign to:** `codex`

**Files:** Modify `src/lib/db.ts`, Create `src/lib/__tests__/agent-limits.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/__tests__/agent-limits.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/db'

describe('agent_limits table', () => {
  it('creates agent_limits table via migration', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_limits'"
    ).get()
    expect(row).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/lib/__tests__/agent-limits.test.ts
```
Expected: FAIL — table not found.

- [ ] **Step 3: Add migration to src/lib/db.ts**

Find the `runMigrations` function. Get the highest existing version number with:
```bash
sqlite3 .data/mission-control.db "SELECT MAX(version) FROM schema_migrations" 2>/dev/null
```
Add after the last migration entry:

```typescript
{
  version: <MAX+1>,
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS agent_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_name TEXT NOT NULL,
        weekly_token_limit INTEGER,
        weekly_usd_limit REAL,
        workspace_id INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(agent_name, workspace_id)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_limits_agent
        ON agent_limits(agent_name, workspace_id);
    `)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/lib/__tests__/agent-limits.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/lib/__tests__/agent-limits.test.ts
git commit -m "feat: add agent_limits table migration"
```

### CHECKPOINT A-1
`agent_limits` table created via migration, test passes.

---

### Task A-2: agent-limits.ts — weekly usage query and enforcement

**Assign to:** `codex`
**Depends on:** A-1 complete

**Files:** Create `src/lib/agent-limits.ts`, extend `src/lib/__tests__/agent-limits.test.ts`

- [ ] **Step 1: Append failing tests to agent-limits.test.ts**

```typescript
import { getWeeklyUsage, isAgentOverLimit, setAgentLimit, getAgentLimit, limitUsagePercent } from '@/lib/agent-limits'

describe('getWeeklyUsage', () => {
  it('returns zero for unknown agent', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const u = getWeeklyUsage(db, 'nobody', 1)
    expect(u.tokens).toBe(0)
    expect(u.costUsd).toBe(0)
  })
})

describe('isAgentOverLimit', () => {
  it('returns false when no limit set', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(false)
  })

  it('returns true when token usage exceeds limit', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'codex', { weeklyTokenLimit: 1000, workspaceId: 1 })
    db.prepare(`
      INSERT INTO token_usage
        (model, session_id, input_tokens, output_tokens, agent_name, workspace_id, created_at)
      VALUES ('claude-sonnet', 'sess-1', 600, 500, 'codex', 1, unixepoch())
    `).run()
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(true)
  })

  it('returns false when under limit', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    setAgentLimit(db, 'codex', { weeklyTokenLimit: 10000, workspaceId: 1 })
    db.prepare(`
      INSERT INTO token_usage
        (model, session_id, input_tokens, output_tokens, agent_name, workspace_id, created_at)
      VALUES ('claude-sonnet', 'sess-2', 100, 100, 'codex', 1, unixepoch())
    `).run()
    expect(isAgentOverLimit(db, 'codex', 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/lib/__tests__/agent-limits.test.ts 2>&1 | tail -8
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create src/lib/agent-limits.ts**

```typescript
import type Database from 'better-sqlite3'

export interface AgentLimit {
  agentName: string
  weeklyTokenLimit: number | null
  weeklyUsdLimit: number | null
  workspaceId: number
}

export interface WeeklyUsage {
  tokens: number
  costUsd: number
}

function weekStartEpoch(): number {
  const now = new Date()
  const day = now.getUTCDay()
  const daysToMon = day === 0 ? 6 : day - 1
  const mon = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - daysToMon
  ))
  return Math.floor(mon.getTime() / 1000)
}

export function getWeeklyUsage(
  db: Database.Database, agentName: string, workspaceId: number
): WeeklyUsage {
  const start = weekStartEpoch()
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
      COALESCE(SUM(cost_usd), 0) AS cost_usd
    FROM token_usage
    WHERE agent_name = ? AND workspace_id = ? AND created_at >= ?
  `).get(agentName, workspaceId, start) as { tokens: number; cost_usd: number }
  return { tokens: row.tokens, costUsd: row.cost_usd }
}

export function getAgentLimit(
  db: Database.Database, agentName: string, workspaceId: number
): AgentLimit | null {
  const row = db.prepare(
    'SELECT * FROM agent_limits WHERE agent_name = ? AND workspace_id = ?'
  ).get(agentName, workspaceId) as {
    weekly_token_limit: number | null; weekly_usd_limit: number | null
  } | undefined
  if (!row) return null
  return {
    agentName, workspaceId,
    weeklyTokenLimit: row.weekly_token_limit,
    weeklyUsdLimit: row.weekly_usd_limit,
  }
}

export function setAgentLimit(
  db: Database.Database,
  agentName: string,
  opts: { weeklyTokenLimit?: number | null; weeklyUsdLimit?: number | null; workspaceId: number }
): void {
  db.prepare(`
    INSERT INTO agent_limits
      (agent_name, weekly_token_limit, weekly_usd_limit, workspace_id, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(agent_name, workspace_id) DO UPDATE SET
      weekly_token_limit = excluded.weekly_token_limit,
      weekly_usd_limit   = excluded.weekly_usd_limit,
      updated_at         = unixepoch()
  `).run(
    agentName,
    opts.weeklyTokenLimit ?? null,
    opts.weeklyUsdLimit ?? null,
    opts.workspaceId
  )
}

export function isAgentOverLimit(
  db: Database.Database, agentName: string, workspaceId: number
): boolean {
  const limit = getAgentLimit(db, agentName, workspaceId)
  if (!limit) return false
  const usage = getWeeklyUsage(db, agentName, workspaceId)
  if (limit.weeklyTokenLimit !== null && usage.tokens >= limit.weeklyTokenLimit) return true
  if (limit.weeklyUsdLimit !== null && usage.costUsd >= limit.weeklyUsdLimit) return true
  return false
}

export function limitUsagePercent(
  db: Database.Database, agentName: string, workspaceId: number
): number {
  const limit = getAgentLimit(db, agentName, workspaceId)
  if (!limit) return 0
  const usage = getWeeklyUsage(db, agentName, workspaceId)
  const tPct = limit.weeklyTokenLimit ? usage.tokens / limit.weeklyTokenLimit : 0
  const uPct = limit.weeklyUsdLimit   ? usage.costUsd / limit.weeklyUsdLimit : 0
  return Math.max(tPct, uPct) * 100
}
```

- [ ] **Step 4: Run all tests**

```bash
pnpm test src/lib/__tests__/agent-limits.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-limits.ts src/lib/__tests__/agent-limits.test.ts
git commit -m "feat: add agent-limits weekly usage enforcement"
```

### CHECKPOINT A-2
`src/lib/agent-limits.ts` exists. `isAgentOverLimit`, `getWeeklyUsage`, `setAgentLimit` all tested and passing.

---

### Task A-3: /api/limits and /api/limits/usage endpoints

**Assign to:** `codex`
**Depends on:** A-2 complete

**Files:**
- Create: `src/app/api/limits/route.ts`
- Create: `src/app/api/limits/usage/route.ts`

- [ ] **Step 1: Create src/app/api/limits/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getAgentLimit, setAgentLimit } from '@/lib/agent-limits'
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
    weeklyUsdLimit:   weekly_usd_limit   ?? null,
    workspaceId: auth.user.workspace_id ?? 1,
  })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Create src/app/api/limits/usage/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getWeeklyUsage, getAgentLimit, limitUsagePercent } from '@/lib/agent-limits'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1
  const agents = db.prepare(
    'SELECT DISTINCT agent_name FROM token_usage WHERE workspace_id = ? AND agent_name IS NOT NULL'
  ).all(workspaceId) as { agent_name: string }[]

  const usage = agents.map(({ agent_name }) => ({
    agent: agent_name,
    ...getWeeklyUsage(db, agent_name, workspaceId),
    limit: getAgentLimit(db, agent_name, workspaceId),
    percent: Math.round(limitUsagePercent(db, agent_name, workspaceId)),
  }))

  return NextResponse.json({ usage })
}
```

- [ ] **Step 3: Verify compile**

```bash
pnpm typecheck 2>&1 | grep -E 'error|Error' | head -10
```
Expected: no errors on new files.

- [ ] **Step 4: Smoke test against running dev server**

```bash
KEY=$(grep '^API_KEY=' .env | cut -d= -f2-)
curl -sf -H "x-api-key: $KEY" http://localhost:3000/api/limits | python3 -m json.tool
```
Expected: `{"limits": []}`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/limits/route.ts src/app/api/limits/usage/route.ts
git commit -m "feat: add /api/limits and /api/limits/usage endpoints"
```

### CHECKPOINT A-3
Limit CRUD and usage endpoints live. `mc raw --method GET --path /api/limits` returns `{"limits":[]}`.

---

### Task A-4: Enforce limit in task-dispatch.ts

**Assign to:** `codex`
**Depends on:** A-3 complete

**Files:** Modify `src/lib/task-dispatch.ts`, `src/lib/__tests__/task-dispatch.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/lib/__tests__/task-dispatch.test.ts`:

```typescript
import * as agentLimits from '@/lib/agent-limits'
import { vi } from 'vitest'

describe('cost cap enforcement', () => {
  it('blocks dispatch and emits event when agent over limit', async () => {
    const overLimitSpy = vi.spyOn(agentLimits, 'isAgentOverLimit').mockReturnValue(true)
    const broadcastSpy = vi.spyOn(eventBus, 'broadcast')
    // Find the dispatchTask or dispatchToAgent function in task-dispatch.ts
    // and call it with a minimal task object
    const { dispatchToAgent } = await import('@/lib/task-dispatch')
    const result = await dispatchToAgent({
      id: 99, title: 'test', assigned_to: 'codex', workspace_id: 1
    } as any)
    expect(result).toMatchObject({ error: expect.stringMatching(/limit/i) })
    expect(broadcastSpy).toHaveBeenCalledWith('agent.limit_reached', expect.objectContaining({
      agent: 'codex', percent: 100
    }))
    overLimitSpy.mockRestore()
    broadcastSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/lib/__tests__/task-dispatch.test.ts 2>&1 | tail -8
```
Expected: FAIL.

- [ ] **Step 3: Add limit check to task-dispatch.ts**

In `src/lib/task-dispatch.ts`, add at the top of the dispatch entry function (find the function that receives a task and dispatches it to an agent — look for the function that checks `agent_config` and calls OpenClaw or the CLI):

```typescript
import { isAgentOverLimit } from './agent-limits'

// Add at the start of the dispatch function body, before any agent invocation:
const db = getDatabase()
if (task.assigned_to && isAgentOverLimit(db, task.assigned_to, task.workspace_id)) {
  logger.warn({ agent: task.assigned_to, taskId: task.id }, 'Dispatch blocked — weekly limit reached')
  eventBus.broadcast('agent.limit_reached', {
    agent: task.assigned_to,
    task_id: task.id,
    workspace_id: task.workspace_id,
    percent: 100,
  })
  return { error: `Agent ${task.assigned_to} has reached its weekly usage limit` }
}
```

- [ ] **Step 4: Run all tests**

```bash
pnpm test
pnpm typecheck
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/task-dispatch.ts src/lib/__tests__/task-dispatch.test.ts
git commit -m "feat: block task dispatch when agent over weekly cost limit, emit agent.limit_reached"
```

### CHECKPOINT A-4
Dispatch blocked + event emitted when agent over cap.

---

## Track B — Task Dependencies

### Task B-1: task_dependencies table + blocked dispatch

**Assign to:** `codex`

**Files:**
- Modify: `src/lib/db.ts`
- Create: `src/lib/task-dependencies.ts`
- Create: `src/lib/__tests__/task-dependencies.test.ts`
- Modify: `src/app/api/tasks/route.ts` (queue endpoint)
- Modify: `src/app/api/tasks/[id]/route.ts` (GET returns depends_on, blocked_by)

- [ ] **Step 1: Write failing test**

```typescript
// src/lib/__tests__/task-dependencies.test.ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/db'
import { wouldCreateCycle, getDependsOn, getBlockedBy, hasUnresolvedDeps } from '@/lib/task-dependencies'

describe('task_dependencies migration', () => {
  it('creates the table', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='task_dependencies'"
    ).get()
    expect(row).toBeTruthy()
  })
})

describe('wouldCreateCycle', () => {
  it('detects direct cycle', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (1,2,1)'
    ).run()
    expect(wouldCreateCycle(db, 2, 1, 1)).toBe(true)
  })

  it('returns false for non-cycle', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(wouldCreateCycle(db, 3, 4, 1)).toBe(false)
  })
})

describe('hasUnresolvedDeps', () => {
  it('returns true when dependency is not done', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    // Insert two tasks: id=10 (in_progress), id=11 (depends on 10)
    db.prepare(
      "INSERT INTO tasks (id, title, status, workspace_id) VALUES (10,'dep','in_progress',1)"
    ).run()
    db.prepare(
      "INSERT INTO tasks (id, title, status, workspace_id) VALUES (11,'task','assigned',1)"
    ).run()
    db.prepare(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (11,10,1)'
    ).run()
    expect(hasUnresolvedDeps(db, 11, 1)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/lib/__tests__/task-dependencies.test.ts 2>&1 | tail -8
```

- [ ] **Step 3: Add migration to src/lib/db.ts**

```typescript
{
  version: <MAX+2>,
  up: (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        workspace_id INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(task_id, depends_on_task_id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);
    `)
  }
}
```

- [ ] **Step 4: Create src/lib/task-dependencies.ts**

```typescript
import type Database from 'better-sqlite3'

export function wouldCreateCycle(
  db: Database.Database, taskId: number, dependsOnId: number, workspaceId: number
): boolean {
  const visited = new Set<number>()
  const queue = [dependsOnId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    if (cur === taskId) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    const deps = db.prepare(
      'SELECT depends_on_task_id FROM task_dependencies WHERE task_id=? AND workspace_id=?'
    ).all(cur, workspaceId) as { depends_on_task_id: number }[]
    queue.push(...deps.map(d => d.depends_on_task_id))
  }
  return false
}

export function getDependsOn(
  db: Database.Database, taskId: number, workspaceId: number
): number[] {
  return (db.prepare(
    'SELECT depends_on_task_id FROM task_dependencies WHERE task_id=? AND workspace_id=?'
  ).all(taskId, workspaceId) as { depends_on_task_id: number }[]).map(r => r.depends_on_task_id)
}

export function getBlockedBy(
  db: Database.Database, taskId: number, workspaceId: number
): number[] {
  return (db.prepare(
    'SELECT task_id FROM task_dependencies WHERE depends_on_task_id=? AND workspace_id=?'
  ).all(taskId, workspaceId) as { task_id: number }[]).map(r => r.task_id)
}

export function hasUnresolvedDeps(
  db: Database.Database, taskId: number, workspaceId: number
): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_task_id
    WHERE td.task_id=? AND td.workspace_id=? AND t.status != 'done'
  `).get(taskId, workspaceId) as { cnt: number }
  return row.cnt > 0
}
```

- [ ] **Step 5: Exclude blocked tasks from queue in src/app/api/tasks/route.ts**

Find the SQL query in the queue endpoint handler. Add this subquery to the WHERE clause:

```sql
AND t.id NOT IN (
  SELECT td.task_id FROM task_dependencies td
  JOIN tasks dep ON dep.id = td.depends_on_task_id
  WHERE td.workspace_id = t.workspace_id AND dep.status != 'done'
)
```

- [ ] **Step 6: Return depends_on and blocked_by in task GET**

In `src/app/api/tasks/[id]/route.ts`, after fetching the task:

```typescript
import { getDependsOn, getBlockedBy } from '@/lib/task-dependencies'

const dependsOn = getDependsOn(db, taskId, workspaceId)
const blockedBy = getBlockedBy(db, taskId, workspaceId)
return NextResponse.json({ task: { ...task, depends_on: dependsOn, blocked_by: blockedBy } })
```

- [ ] **Step 7: Run all tests**

```bash
pnpm test src/lib/__tests__/task-dependencies.test.ts
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db.ts src/lib/task-dependencies.ts src/lib/__tests__/task-dependencies.test.ts \
  src/app/api/tasks/route.ts src/app/api/tasks/[id]/route.ts
git commit -m "feat: add task_dependencies table, cycle detection, blocked dispatch"
```

### CHECKPOINT B-1
`task_dependencies` table live. Blocked tasks excluded from queue. `depends_on` + `blocked_by` in task GET.

---

### Task B-2: parent_id in tasks table

**Assign to:** `copilot-cli`

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/app/api/tasks/[id]/route.ts`

- [ ] **Step 1: Get current max migration version**

```bash
sqlite3 .data/mission-control.db "SELECT MAX(version) FROM schema_migrations"
```

- [ ] **Step 2: Add parent_id migration to src/lib/db.ts**

```typescript
{
  version: <MAX+3>,
  up: (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
    `)
  }
}
```

- [ ] **Step 3: Return subtasks in task GET in src/app/api/tasks/[id]/route.ts**

After the existing `depends_on` / `blocked_by` additions (or after the task lookup if B-1 isn't done yet):

```typescript
const subtasks = db.prepare(
  'SELECT id, title, status, assigned_to FROM tasks WHERE parent_id=? AND workspace_id=?'
).all(taskId, workspaceId)
// Add to the return:
return NextResponse.json({ task: { ...task, depends_on: dependsOn, blocked_by: blockedBy, subtasks } })
```

- [ ] **Step 4: Run tests**

```bash
pnpm test && pnpm typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db.ts src/app/api/tasks/[id]/route.ts
git commit -m "feat: add parent_id to tasks table, return subtasks in task GET"
```

### CHECKPOINT B-2
`parent_id` column in tasks. Task GET returns `subtasks: []`.

---

## Track C — Aegis Hardening

### Task C-1: Machine-checkable verification signals

**Assign to:** `codex`

**Files:**
- Create: `src/lib/aegis-verifier.ts`
- Create: `src/lib/__tests__/aegis-verifier.test.ts`
- Modify: `src/app/api/quality-review/route.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/aegis-verifier.test.ts
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

  it('rejects when innerHTML present', () => {
    expect(meetsApprovalThreshold({
      testsPass: true, typecheckPass: true, noInnerHTML: false, hasResolution: true
    })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm test src/lib/__tests__/aegis-verifier.test.ts 2>&1 | tail -5
```

- [ ] **Step 3: Create src/lib/aegis-verifier.ts**

```typescript
export interface VerificationSignals {
  testsPass: boolean
  typecheckPass: boolean
  noInnerHTML: boolean
  hasResolution: boolean
}

const TEST_PASS  = /\b(tests? pass|all tests|passed|pnpm test.*pass|\d+ passed)/i
const TYPE_PASS  = /\b(typecheck.*pass|tsc.*clean|no.*type.*error|pnpm typecheck)/i
const INNERHTML  = /innerHTML/i

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
```

- [ ] **Step 4: Wire into quality-review POST**

In `src/app/api/quality-review/route.ts`, add after the task lookup (inside the POST handler):

```typescript
import { extractVerificationSignals, meetsApprovalThreshold } from '@/lib/aegis-verifier'

// After task lookup, before INSERT:
if (reviewer === 'aegis' && status === 'approved') {
  const resolution = (task as any).resolution ?? ''
  const signals = extractVerificationSignals(resolution + ' ' + (notes ?? ''))
  if (!meetsApprovalThreshold(signals)) {
    return NextResponse.json({
      error: 'Aegis auto-approval requires: test pass, typecheck pass, no innerHTML in resolution',
      signals,
    }, { status: 422 })
  }
}
```

- [ ] **Step 5: Run all tests**

```bash
pnpm test src/lib/__tests__/aegis-verifier.test.ts
pnpm typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/aegis-verifier.ts src/lib/__tests__/aegis-verifier.test.ts \
  src/app/api/quality-review/route.ts
git commit -m "feat: harden Aegis — require machine-checkable signals before auto-approval"
```

### CHECKPOINT C-1
Aegis rejects auto-approval if resolution lacks test pass + typecheck pass, or contains innerHTML.

---

## Track D — Hermes Coordinator Upgrade

### Task D-1: mc-coord-lib.mjs and coordinate-foundations.mjs

**Assign to:** `hermes`

**Files:**
- Create: `scripts/mc-coord-lib.mjs`
- Create: `scripts/coordinate-foundations.mjs`

- [ ] **Step 1: Create scripts/mc-coord-lib.mjs**

```javascript
// scripts/mc-coord-lib.mjs — shared coordinator primitives.
import fetch from 'node-fetch'
import { readFileSync } from 'fs'

export function loadMcConfig() {
  try {
    const p = JSON.parse(readFileSync(
      `${process.env.HOME}/.mission-control/profiles/default.json`, 'utf8'
    ))
    return { url: p.url, apiKey: p.apiKey }
  } catch {
    return { url: process.env.MC_URL, apiKey: process.env.MC_API_KEY }
  }
}

export function makeMcClient(url, apiKey) {
  const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey }

  async function call(method, path, body) {
    const res = await fetch(`${url}${path}`, {
      method, headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`)
    return res.json()
  }

  return {
    createTask:  (f)         => call('POST', '/api/tasks', f),
    updateTask:  (id, f)     => call('PUT',  `/api/tasks/${id}`, f),
    getTask:     (id)        => call('GET',  `/api/tasks/${id}`),
    postComment: (id, msg)   => call('POST', `/api/tasks/${id}/comments`, { content: msg }),
    approve:     (id, notes) => call('POST', '/api/quality-review', {
      taskId: id, reviewer: 'coordinator', status: 'approved', notes
    }),
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled'])

export async function pollUntilDone(mc, taskIds, opts = {}) {
  const {
    pollMs   = 60_000,
    timeoutMs = 30 * 60 * 1000,
    stallMs  = 20 * 60 * 1000,
    onStall  = null,
    onProgress = null,
  } = opts

  const lastUpdate = new Map(taskIds.map(id => [id, { at: Date.now(), status: null }]))
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const results = await Promise.allSettled(taskIds.map(id => mc.getTask(id)))
    const tasks = results.map((r, i) => {
      if (r.status === 'fulfilled') {
        return r.value?.data?.task ?? r.value?.task ?? { id: taskIds[i], status: 'unknown' }
      }
      return { id: taskIds[i], status: 'error', title: 'fetch failed' }
    })

    const now = Date.now()
    for (const t of tasks) {
      const prev = lastUpdate.get(t.id)
      if (t.status !== prev?.status) {
        lastUpdate.set(t.id, { at: now, status: t.status })
      } else if (!TERMINAL.has(t.status) && now - prev.at > stallMs) {
        if (onStall) await onStall(t).catch(console.error)
        lastUpdate.set(t.id, { at: now, status: t.status })
      }
    }

    if (onProgress) onProgress(tasks)
    if (tasks.every(t => TERMINAL.has(t.status))) return tasks
    await new Promise(r => setTimeout(r, pollMs))
  }

  throw new Error(`Coordinator timed out after ${timeoutMs / 60000}min`)
}
```

- [ ] **Step 2: Create scripts/coordinate-foundations.mjs**

```javascript
#!/usr/bin/env node
// coordinate-foundations.mjs — dispatches MC Foundations plan (Tracks A-E).
// Run: node scripts/coordinate-foundations.mjs
import { loadMcConfig, makeMcClient, pollUntilDone } from './mc-coord-lib.mjs'

const { url, apiKey } = loadMcConfig()
if (!url || !apiKey) {
  console.error('MC config missing. Check ~/.mission-control/profiles/default.json')
  process.exit(1)
}
const mc = makeMcClient(url, apiKey)

const FALLBACK = ['copilot-cli', 'codex', 'claude-code']

async function onStall(task) {
  const fallback = FALLBACK.find(a => a !== task.assigned_to)
  if (!fallback) return
  console.log(`[stall] TASK-${task.id} (${task.assigned_to}) -> reassigning to ${fallback}`)
  await mc.updateTask(task.id, { assigned_to: fallback, status: 'assigned' })
  await mc.postComment(task.id,
    `[Coordinator] No progress for 20min. Reassigned from ${task.assigned_to} to ${fallback}.`
  )
}

function onProgress(tasks) {
  const icons = { done:'✓', review:'⏳', failed:'✗', in_progress:'→', assigned:'·' }
  console.log(`\n[${new Date().toISOString()}] Progress:`)
  for (const t of tasks) {
    const icon = icons[t.status] ?? '?'
    console.log(`  ${icon} TASK-${t.id} [${t.status}] ${(t.title||'').slice(0,55)}`)
  }
}

function taskId(r) { return r?.data?.task?.id ?? r?.task?.id }

async function run() {
  console.log('\n MC Foundations coordinator starting\n')

  const parent = await mc.createTask({
    title: '[COORD] MC Foundations Phase 1',
    description: 'Coordinator for MC Foundations plan. See docs/superpowers/plans/2026-05-28-mc-foundations.md',
    assigned_to: 'hermes', priority: 'high',
  })
  const pid = taskId(parent)
  console.log(`Parent: TASK-${pid}\n`)

  // Track A — cost caps (urgent)
  const a1 = taskId(await mc.createTask({
    title: 'MC: add agent_limits table migration',
    description: 'Plan: docs/superpowers/plans/2026-05-28-mc-foundations.md Task A-1\nCHECKPOINT: agent_limits table exists, migration test passes.',
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a2 = taskId(await mc.createTask({
    title: 'MC: implement agent-limits.ts weekly enforcement',
    description: 'Plan: Task A-2. Depends on A-1.\nCHECKPOINT: isAgentOverLimit tested and passing.',
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a3 = taskId(await mc.createTask({
    title: 'MC: add /api/limits and /api/limits/usage endpoints',
    description: 'Plan: Task A-3. Depends on A-2.\nCHECKPOINT: GET /api/limits returns {"limits":[]}.',
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a4 = taskId(await mc.createTask({
    title: 'MC: enforce weekly cost cap in task dispatch',
    description: 'Plan: Task A-4. Depends on A-3.\nCHECKPOINT: dispatch blocked + agent.limit_reached emitted.',
    assigned_to: 'codex', priority: 'urgent',
  }))

  // Track B — dependencies
  const b1 = taskId(await mc.createTask({
    title: 'MC: add task_dependencies table and blocked dispatch',
    description: 'Plan: Task B-1.\nCHECKPOINT: task_dependencies table, blocked tasks excluded from queue.',
    assigned_to: 'codex', priority: 'high',
  }))
  const b2 = taskId(await mc.createTask({
    title: 'MC: add parent_id to tasks and subtasks in GET',
    description: 'Plan: Task B-2.\nCHECKPOINT: parent_id column, task GET returns subtasks array.',
    assigned_to: 'copilot-cli', priority: 'high',
  }))

  // Track C — Aegis
  const c1 = taskId(await mc.createTask({
    title: 'MC: harden Aegis with machine-checkable verification',
    description: 'Plan: Task C-1.\nCHECKPOINT: Aegis rejects approval without test+typecheck signals.',
    assigned_to: 'codex', priority: 'high',
  }))

  // Track E — ADRs (pi)
  const e1 = taskId(await mc.createTask({
    title: 'MC: write ADR-001 through ADR-003',
    description: 'Plan: Track E.\nCreate docs/decisions/ADR-001 (SQLite), ADR-002 (self-pickup), ADR-003 (Aegis).',
    assigned_to: 'pi', priority: 'medium',
  }))

  const allIds = [a1,a2,a3,a4,b1,b2,c1,e1].filter(Boolean)
  console.log(`Dispatched ${allIds.length} tasks: ${allIds.map(id => `TASK-${id}`).join(', ')}\n`)

  const results = await pollUntilDone(mc, allIds, {
    pollMs: 60_000, stallMs: 20 * 60 * 1000, onStall, onProgress
  })

  const done   = results.filter(r => ['done','review'].includes(r.status)).length
  const failed = results.filter(r => r.status === 'failed').length
  const summary = [
    `MC Foundations: ${done}/${allIds.length} done, ${failed} failed`,
    '',
    ...results.map(r => `- TASK-${r.id} [${r.status}] ${(r.title||'').slice(0,80)}`),
  ].join('\n')

  await mc.updateTask(pid, { status: 'review', resolution: summary.slice(0,500) })
  console.log('\n' + summary)
  console.log(`\nParent TASK-${pid} -> review`)
}

run().catch(e => { console.error(e.message); process.exit(1) })
```

- [ ] **Step 3: Verify syntax**

```bash
node --check scripts/mc-coord-lib.mjs && echo "lib OK"
node --check scripts/coordinate-foundations.mjs && echo "coord OK"
```
Expected: both print OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/mc-coord-lib.mjs scripts/coordinate-foundations.mjs
git commit -m "feat: add mc-coord-lib.mjs with stall detection and coordinate-foundations.mjs dispatcher"
```

### CHECKPOINT D-1
`mc-coord-lib.mjs` and `coordinate-foundations.mjs` committed. Hermes can run `node scripts/coordinate-foundations.mjs` to dispatch and monitor all tracks.

---

## Track E — ADR Documentation

### Task E-1: ADR-001 through ADR-003

**Assign to:** `pi`

- [ ] **Step 1: Create docs/decisions/ directory**

```bash
mkdir -p docs/decisions
```

- [ ] **Step 2: Write docs/decisions/ADR-001-sqlite-over-postgres.md**

```markdown
# ADR-001: SQLite over PostgreSQL

**Status:** Accepted | **Date:** 2026-05-28

## Context
MC is a personal/small-team platform. Single-node Docker deployment. Operational simplicity over throughput.

## Decision
SQLite with WAL mode. better-sqlite3 provides synchronous API simplifying Next.js routes.

## Consequences
- Zero infrastructure, file-based backup, ships in Docker without deps
- Serialized writes under concurrent load
- **Tripwire for migration:** >10 concurrent agents with write latency >100ms,
  OR database file >10GB, OR multi-node required
```

- [ ] **Step 3: Write docs/decisions/ADR-002-self-pickup-dispatch.md**

```markdown
# ADR-002: Self-Pickup Task Dispatch

**Status:** Accepted | **Date:** 2026-05-28

## Context
Agent frameworks vary — some support push, some only pull. Need universal dispatch.

## Decision
Agents poll GET /api/tasks/queue?agent=<name>. MC does not push.

## Consequences
- Works with any agent that can make HTTP calls
- Pickup latency = poll interval (default 30s)
- Phase 3: SSE push as opt-in for online agents, poll remains fallback
```

- [ ] **Step 4: Write docs/decisions/ADR-003-aegis-quality-gates.md**

```markdown
# ADR-003: Aegis Quality Gate

**Status:** Accepted (amended 2026-05-28) | **Date:** 2026-05-28

## Context
Tasks need a reviewer distinct from the implementer to prevent self-approval.

## Decision
Require quality_reviews row with reviewer=aegis, status=approved before done transition.

## Amendment
Aegis auto-approval now requires machine-checkable signals: test pass, typecheck pass,
no innerHTML. See src/lib/aegis-verifier.ts.

## Consequences
- Prevents agent self-approval loops
- Per-task gate_config (Phase 2) will allow aegis_optional for low-risk tasks
```

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/
git commit -m "docs: add ADR-001 through ADR-003"
```

### CHECKPOINT E-1
Three ADRs committed under docs/decisions/.

---

## Copilot CLI Registration

Register Copilot CLI as an MC agent before running the coordinator:

```bash
# Check if already registered
mc agents list --json | python3 -c "
import json,sys
agents = json.load(sys.stdin)['data']['agents']
names = [a['name'] for a in agents]
print('copilot-cli registered:', 'copilot-cli' in names)
"

# Register if not present
mc raw --method POST --path /api/connect \
  --body '{"tool_name":"copilot-cli","agent_name":"copilot-cli","agent_role":"developer"}'
```

Copilot CLI polls the queue the same way as other agents:
```bash
mc tasks queue --agent copilot-cli --json
```

---

## Full Verification

Run after all tracks complete:

```bash
cd ~/Projects/mission-control

# All tests pass
pnpm test

# Typecheck clean
pnpm typecheck

# Tables present
sqlite3 .data/mission-control.db \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_limits','task_dependencies')"

# parent_id column
sqlite3 .data/mission-control.db "PRAGMA table_info(tasks)" | grep parent_id

# Limits API
KEY=$(grep '^API_KEY=' .env | cut -d= -f2-)
curl -sf -H "x-api-key: $KEY" http://localhost:3000/api/limits | python3 -m json.tool

# Aegis rejects bad approval
curl -sf -X POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"taskId":1,"reviewer":"aegis","status":"approved","notes":"looks good"}' \
  http://localhost:3000/api/quality-review
# Expected: 422

# Coordinator script syntax
node --check scripts/mc-coord-lib.mjs && node --check scripts/coordinate-foundations.mjs
```

Push to fork when all pass:
```bash
git push origin main
```
