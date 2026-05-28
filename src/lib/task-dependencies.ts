import type Database from 'better-sqlite3'

export function wouldCreateCycle(
  db: Database.Database,
  taskId: number,
  dependsOnId: number,
  workspaceId: number
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
  db: Database.Database,
  taskId: number,
  workspaceId: number
): number[] {
  return (db.prepare(
    'SELECT depends_on_task_id FROM task_dependencies WHERE task_id=? AND workspace_id=?'
  ).all(taskId, workspaceId) as { depends_on_task_id: number }[]).map(r => r.depends_on_task_id)
}

export function getBlockedBy(
  db: Database.Database,
  taskId: number,
  workspaceId: number
): number[] {
  return (db.prepare(
    'SELECT task_id FROM task_dependencies WHERE depends_on_task_id=? AND workspace_id=?'
  ).all(taskId, workspaceId) as { task_id: number }[]).map(r => r.task_id)
}

export function hasUnresolvedDeps(
  db: Database.Database,
  taskId: number,
  workspaceId: number
): boolean {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM task_dependencies td
    JOIN tasks t ON t.id = td.depends_on_task_id
    WHERE td.task_id=? AND td.workspace_id=? AND t.status != 'done'
  `).get(taskId, workspaceId) as { cnt: number }
  return row.cnt > 0
}
