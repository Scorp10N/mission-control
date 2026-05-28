#!/usr/bin/env node
// coordinate.mjs — decompose a goal into MC tasks, assign to agents, poll, summarize.
// Usage: node scripts/coordinate.mjs "your goal here"

import fetch from 'node-fetch'
import { readFileSync } from 'fs'

function loadMcConfig() {
  const profilePath = `${process.env.HOME}/.mission-control/profiles/default.json`
  try {
    const p = JSON.parse(readFileSync(profilePath, 'utf8'))
    return { url: p.url, apiKey: p.apiKey }
  } catch {
    return { url: process.env.MC_URL, apiKey: process.env.MC_API_KEY }
  }
}

const { url: MC_URL, apiKey: MC_API_KEY } = loadMcConfig()

if (!MC_URL || !MC_API_KEY) {
  console.error('MC config not found. Set MC_URL + MC_API_KEY or configure ~/.mission-control/profiles/default.json')
  process.exit(1)
}

const HEADERS = { 'Content-Type': 'application/json', 'x-api-key': MC_API_KEY }
const POLL_MS = 15_000
const TIMEOUT_MS = 10 * 60 * 1000

async function mcPost(path, body) {
  const res = await fetch(`${MC_URL}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function mcPut(path, body) {
  const res = await fetch(`${MC_URL}${path}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function mcGet(path) {
  const res = await fetch(`${MC_URL}${path}`, { headers: HEADERS })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function createTask({ title, description, assignedTo, priority = 'medium', tags = [] }) {
  const data = await mcPost('/api/tasks', {
    title,
    description,
    assigned_to: assignedTo,
    priority,
    tags,
  })
  const t = data.task
  console.log(`  [${t.ticket_ref}] ${t.title.slice(0, 60)} → ${assignedTo}`)
  return t.id
}

async function getTaskStatus(id) {
  const data = await mcGet(`/api/tasks/${id}`)
  const t = data.data?.task ?? data.task
  return { id, status: t.status, title: t.title, resolution: t.resolution }
}

async function pollUntilDone(taskIds) {
  const terminal = new Set(['done', 'review', 'failed'])
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    const settled = await Promise.allSettled(taskIds.map(getTaskStatus))
    const statuses = settled.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { id: taskIds[i], status: 'failed', title: 'unknown', resolution: r.reason?.message }
    )
    const pending = statuses.filter(s => !terminal.has(s.status))
    console.log(`  Progress: ${taskIds.length - pending.length}/${taskIds.length} done`)
    if (pending.length === 0) return statuses
    await new Promise(r => setTimeout(r, POLL_MS))
  }

  throw new Error('Timed out waiting for child tasks to complete (10 min)')
}

async function coordinate(goal) {
  console.log(`\n Coordinating: "${goal}"\n`)

  const parentId = await createTask({
    title: `[COORD] ${goal.slice(0, 80)}`,
    description: `Coordinator parent task.\n\nGoal: ${goal}`,
    assignedTo: 'claude-code',
    priority: 'high',
    tags: ['coordinator', 'parent'],
  })

  // Rules-based decomposition for Downdog voice command POC.
  // Replace with LLM classifier (ADR-006) for general goals.
  const childIds = await Promise.all([
    createTask({
      title: 'Analyze privacy and safety constraints for voice commands in a Chrome extension',
      description: `Context: considering adding voice commands to the Downdog yoga extension (~/Projects/downdog-extension).\n\nAnalyze: privacy risks, permission requirements, user-consent implications of adding microphone access to a Chrome MV3 extension. Output a structured list of constraints and risks.`,
      assignedTo: 'hermes',
      priority: 'high',
      tags: ['voice', 'privacy', `parent:${parentId}`],
    }),
    createTask({
      title: 'Inspect downdog-extension source and identify voice command implementation seams',
      description: `Repo: ~/Projects/downdog-extension\n\nRead AGENTS.md, content.js, interceptor.js, manifest.json.\nIdentify where voice command hooks could be added.\nConstraint: NO innerHTML anywhere (security hook blocks it).\nOutput: list of candidate integration points with file:line references.`,
      assignedTo: 'pi',
      priority: 'high',
      tags: ['voice', 'implementation', `parent:${parentId}`],
    }),
    createTask({
      title: 'Research Chrome MV3 Speech API limits and Web Store voice permission policies',
      description: `Research task (internet access required, no local files needed).\n\nQuestions:\n1. What are Chrome MV3 constraints on webkitSpeechRecognition / Web Speech API?\n2. What does Chrome Web Store require for extensions requesting microphone permission?\n3. Are offscreen documents needed for continuous audio in MV3?\n\nSummarize findings in bullet points.`,
      assignedTo: 'cloud-run-worker',
      priority: 'medium',
      tags: ['voice', 'research', `parent:${parentId}`],
    }),
  ])

  console.log(`\n Waiting for ${childIds.length} child tasks (timeout: 10 min)...\n`)
  const results = await pollUntilDone(childIds)

  const lines = [
    `# Coordination Summary`,
    `Goal: ${goal}`,
    `Parent: TASK-${String(parentId).padStart(3, '0')} | Date: ${new Date().toISOString()}`,
    '',
    '## Results',
    ...results.map(r =>
      `- **${r.title.slice(0, 70)}**\n  Status: ${r.status}\n  Resolution: ${(r.resolution ?? 'no resolution').slice(0, 200)}`
    ),
    '',
    '## Next Steps',
    'Review child task comments in Mission Control for full output.',
    'Optionally assign claude-code a follow-up review task for expert analysis.',
  ]
  const summary = lines.join('\n')

  console.log('\n' + summary)

  await mcPut(`/api/tasks/${parentId}`, {
    status: 'review',
    resolution: summary.slice(0, 500),
  })

  console.log(`\n Parent TASK-${String(parentId).padStart(3, '0')} moved to review.`)
}

const goal = process.argv.slice(2).join(' ')
if (!goal) { console.error('Usage: node scripts/coordinate.mjs "your goal here"'); process.exit(1) }
coordinate(goal).catch(err => { console.error(err.message); process.exit(1) })
