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
    pollMs    = 60_000,
    timeoutMs = 30 * 60 * 1000,
    stallMs   = 20 * 60 * 1000,
    onStall   = null,
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
