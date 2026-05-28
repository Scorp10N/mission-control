#!/usr/bin/env node
// coordinate-foundations.mjs — dispatches MC Foundations plan (Tracks A–E).
// Run: node scripts/coordinate-foundations.mjs
import { loadMcConfig, makeMcClient, pollUntilDone } from './mc-coord-lib.mjs'

const { url, apiKey } = loadMcConfig()
if (!url || !apiKey) {
  console.error('MC config missing. Check ~/.mission-control/profiles/default.json')
  process.exit(1)
}
const mc = makeMcClient(url, apiKey)

const FALLBACK = ['copilot-cli', 'codex', 'claude-code']
const PLAN = 'docs/superpowers/plans/2026-05-28-mc-foundations.md'

async function onStall(task) {
  const fallback = FALLBACK.find(a => a !== task.assigned_to)
  if (!fallback) return
  console.log(`[stall] TASK-${task.id} (${task.assigned_to}) -> reassigning to ${fallback}`)
  await mc.updateTask(task.id, { assigned_to: fallback, status: 'assigned' })
  await mc.postComment(task.id,
    `[Coordinator] No progress for 20min. Reassigned from ${task.assigned_to} to ${fallback}.\nHandover: read CHECKPOINT in ${PLAN} for this task.`
  )
}

function onProgress(tasks) {
  const icons = { done: '✓', review: '⏳', failed: '✗', in_progress: '→', assigned: '·', inbox: '○' }
  const done = tasks.filter(t => ['done','review'].includes(t.status)).length
  console.log(`\n[${new Date().toISOString()}] ${done}/${tasks.length} complete`)
  for (const t of tasks) {
    const icon = icons[t.status] ?? '?'
    console.log(`  ${icon} TASK-${t.id} [${t.status}] ${(t.title||'').slice(0,60)}`)
  }
}

function taskId(r) {
  return r?.data?.task?.id ?? r?.task?.id
}

async function run() {
  console.log('\n🚀 MC Foundations coordinator starting\n')

  const parent = await mc.createTask({
    title: '[COORD] MC Foundations Phase 1',
    description: `Coordinator for MC Foundations plan.\nPlan: ${PLAN}\nTracks: A (cost caps), B (dependencies), C (Aegis), E (ADRs)`,
    assigned_to: 'hermes',
    priority: 'high',
  })
  const pid = taskId(parent)
  console.log(`Parent: TASK-${pid}\n`)

  // Track A — cost caps (urgent, dispatch first)
  const a1 = taskId(await mc.createTask({
    title: 'MC: add agent_limits table migration',
    description: `Plan: ${PLAN} — Task A-1\nCHECKPOINT: agent_limits table exists, pnpm test src/lib/__tests__/agent-limits.test.ts passes.`,
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a2 = taskId(await mc.createTask({
    title: 'MC: implement agent-limits.ts weekly enforcement',
    description: `Plan: ${PLAN} — Task A-2\nDepends on A-1 (TASK-${a1}).\nCHECKPOINT: isAgentOverLimit, getWeeklyUsage, setAgentLimit all tested and passing.`,
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a3 = taskId(await mc.createTask({
    title: 'MC: add /api/limits and /api/limits/usage endpoints',
    description: `Plan: ${PLAN} — Task A-3\nDepends on A-2 (TASK-${a2}).\nCHECKPOINT: mc raw --method GET --path /api/limits returns {"limits":[]}.`,
    assigned_to: 'codex', priority: 'urgent',
  }))
  const a4 = taskId(await mc.createTask({
    title: 'MC: enforce weekly cost cap in task dispatch',
    description: `Plan: ${PLAN} — Task A-4\nDepends on A-3 (TASK-${a3}).\nCHECKPOINT: dispatch blocked + agent.limit_reached event emitted when over cap.`,
    assigned_to: 'codex', priority: 'urgent',
  }))

  // Track B — dependencies
  const b1 = taskId(await mc.createTask({
    title: 'MC: add task_dependencies table and blocked dispatch',
    description: `Plan: ${PLAN} — Task B-1\nCHECKPOINT: task_dependencies table live, blocked tasks excluded from queue, depends_on in task GET.`,
    assigned_to: 'codex', priority: 'high',
  }))
  const b2 = taskId(await mc.createTask({
    title: 'MC: add parent_id to tasks and subtasks in GET',
    description: `Plan: ${PLAN} — Task B-2\nCHECKPOINT: parent_id column in tasks, task GET returns subtasks array.`,
    assigned_to: 'copilot-cli', priority: 'high',
  }))

  // Track C — Aegis hardening
  const c1 = taskId(await mc.createTask({
    title: 'MC: harden Aegis with machine-checkable verification',
    description: `Plan: ${PLAN} — Task C-1\nCHECKPOINT: Aegis 422s when resolution lacks test+typecheck signals or contains innerHTML.`,
    assigned_to: 'codex', priority: 'high',
  }))

  // Track E — ADRs
  const e1 = taskId(await mc.createTask({
    title: 'MC: write ADR-001 through ADR-003',
    description: `Plan: ${PLAN} — Track E\nCreate docs/decisions/ADR-001 (SQLite), ADR-002 (self-pickup), ADR-003 (Aegis gates).\nCHECKPOINT: three files committed under docs/decisions/.`,
    assigned_to: 'pi', priority: 'medium',
  }))

  const allIds = [a1, a2, a3, a4, b1, b2, c1, e1].filter(Boolean)
  console.log(`Dispatched ${allIds.length} tasks: ${allIds.map(id => `TASK-${id}`).join(', ')}\n`)
  console.log('Monitoring every 60s. Stall threshold: 20min → auto-reassign to fallback agent.\n')

  const results = await pollUntilDone(mc, allIds, {
    pollMs: 60_000,
    stallMs: 20 * 60 * 1000,
    onStall,
    onProgress,
  })

  const done   = results.filter(r => ['done','review'].includes(r.status)).length
  const failed = results.filter(r => r.status === 'failed').length
  const summary = [
    `MC Foundations: ${done}/${allIds.length} complete, ${failed} failed`,
    '',
    ...results.map(r =>
      `- TASK-${r.id} [${r.status}] ${(r.title||'').slice(0,70)}\n  ${(r.resolution||'no resolution').slice(0,120)}`
    ),
  ].join('\n')

  await mc.updateTask(pid, { status: 'review', resolution: summary.slice(0, 500) })
  console.log('\n' + summary)
  console.log(`\nParent TASK-${pid} → review`)
}

run().catch(e => { console.error(e.message); process.exit(1) })
