#!/usr/bin/env node
// Hermes Coordinator — uses mc CLI to monitor tasks
// Simpler, more reliable than direct API calls

import { execSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const TASK_IDS = [27, 28, 29, 30, 31, 32, 33, 34, 35]
const POLL_INTERVAL = 30000 // 30 seconds
const STALL_THRESHOLD = 20 * 60 * 1000 // 20 minutes

const state = new Map()

function formatTime(ts) {
  return new Date(ts * 1000).toISOString().split('T')[1].slice(0, 5)
}

function getIcon(status) {
  const icons = {
    done: '✓',
    in_progress: '→',
    review: '🔍',
    quality_review: '🔍',
    assigned: '◎',
    failed: '✗',
    inbox: '○',
  }
  return icons[status] || '?'
}

function fetchTasks() {
  try {
    const output = execSync('mc tasks list --json', { encoding: 'utf8' })
    const data = JSON.parse(output)
    const tasks = data?.data?.tasks || []

    // Filter to our task IDs
    const filtered = tasks.filter(t => TASK_IDS.includes(t.id))

    // Update state
    filtered.forEach(task => {
      const now = Math.floor(Date.now() / 1000)
      const prev = state.get(task.id)
      const updated_at = task.updated_at || now

      // Track stalls
      let stall_count = 0
      if (prev && prev.status === task.status) {
        const staleness = now - updated_at
        if (staleness > STALL_THRESHOLD / 1000) {
          stall_count = (prev.stall_count || 0) + 1
        }
      }

      state.set(task.id, {
        id: task.id,
        status: task.status,
        assigned_to: task.assigned_to,
        title: task.title,
        updated_at,
        last_checked: now,
        stall_count,
      })
    })

    return true
  } catch (err) {
    console.error(`[error] Failed to fetch tasks: ${err.message}`)
    return false
  }
}

async function poll() {
  const now = new Date()
  const timestamp = now.toISOString().split('T')[1].slice(0, 5)

  // Fetch all tasks
  if (!fetchTasks()) {
    console.log(`[${timestamp}] ⚠️  Failed to fetch tasks from MC`)
    return
  }

  // Calculate progress
  const done = Array.from(state.values()).filter(t => ['done', 'review'].includes(t.status)).length
  const total = state.size
  const progress = total > 0 ? done / total : 0

  console.log(`\n[${timestamp}] ${getIcon('in_progress')} Progress: ${done}/${total} (${Math.round(progress * 100)}%)`)

  // Group by status
  const byStatus = new Map()
  state.forEach(task => {
    if (!byStatus.has(task.status)) byStatus.set(task.status, [])
    byStatus.get(task.status).push(task)
  })

  // Display by status
  const statusOrder = ['in_progress', 'assigned', 'review', 'done', 'failed', 'inbox']
  for (const status of statusOrder) {
    const tasks = byStatus.get(status) || []
    if (tasks.length === 0) continue

    for (const task of tasks.sort((a, b) => a.id - b.id)) {
      const icon = getIcon(status)
      const bar = status === 'in_progress' ? ` [working since ${formatTime(task.updated_at)}]` : ''
      console.log(
        `  ${icon} TASK-${task.id.toString().padStart(2, '0')} [${status.padEnd(12)}] ` +
        `${task.assigned_to.padEnd(15)} | ${task.title.slice(0, 45)}${bar}`
      )
    }
  }

  // Summary section
  const inProgress = Array.from(state.values()).filter(t => t.status === 'in_progress')
  if (inProgress.length > 0) {
    console.log(`\n👷 Currently working:`)
    for (const task of inProgress) {
      console.log(`   • ${task.assigned_to}: TASK-${task.id}`)
    }
  }

  const review = Array.from(state.values()).filter(t => t.status === 'review')
  if (review.length > 0) {
    console.log(`\n🔍 In quality review:`)
    for (const task of review) {
      console.log(`   • TASK-${task.id}: ${task.title.slice(0, 50)}`)
    }
  }

  const failed = Array.from(state.values()).filter(t => t.status === 'failed')
  if (failed.length > 0) {
    console.log(`\n⚠️  Failed tasks:`)
    for (const task of failed) {
      console.log(`   • TASK-${task.id}: ${task.title.slice(0, 50)}`)
    }
  }
}

async function main() {
  console.log('\n🚀 Hermes Coordinator starting')
  console.log(`   Monitoring ${TASK_IDS.length} tasks`)
  console.log(`   Poll interval: 30 seconds`)
  console.log(`   Using: mc CLI for task queries`)
  console.log(`   Press Ctrl+C to stop\n`)

  // Initial poll
  await poll()

  // Continuous monitoring
  let pollCount = 0
  while (true) {
    await delay(POLL_INTERVAL)
    pollCount++
    try {
      await poll()
    } catch (err) {
      console.error(`\n[error] Poll #${pollCount} failed: ${err.message}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
