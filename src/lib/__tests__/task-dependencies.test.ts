import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '@/lib/migrations'
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
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (1,'t1','assigned',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (2,'t2','assigned',1)").run()
    db.prepare(
      'INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (1,2,1)'
    ).run()
    expect(wouldCreateCycle(db, 2, 1, 1)).toBe(true)
  })

  it('detects transitive cycle', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    // 1 → 2 → 3, adding 3 → 1 would be a cycle
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (1,'t1','assigned',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (2,'t2','assigned',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (3,'t3','assigned',1)").run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (1,2,1)').run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (2,3,1)').run()
    expect(wouldCreateCycle(db, 3, 1, 1)).toBe(true)
  })

  it('returns false for non-cycle', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(wouldCreateCycle(db, 3, 4, 1)).toBe(false)
  })
})

describe('getDependsOn / getBlockedBy', () => {
  it('returns dependencies and reverse dependencies', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (5,'t5','assigned',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (6,'t6','assigned',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (7,'t7','assigned',1)").run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (5,6,1)').run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (5,7,1)').run()

    expect(getDependsOn(db, 5, 1)).toEqual(expect.arrayContaining([6, 7]))
    expect(getBlockedBy(db, 6, 1)).toEqual([5])
  })
})

describe('hasUnresolvedDeps', () => {
  it('returns true when dependency is not done', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (10,'dep','in_progress',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (11,'task','assigned',1)").run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (11,10,1)').run()
    expect(hasUnresolvedDeps(db, 11, 1)).toBe(true)
  })

  it('returns false when all dependencies are done', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (20,'dep','done',1)").run()
    db.prepare("INSERT INTO tasks (id, title, status, workspace_id) VALUES (21,'task','assigned',1)").run()
    db.prepare('INSERT INTO task_dependencies (task_id, depends_on_task_id, workspace_id) VALUES (21,20,1)').run()
    expect(hasUnresolvedDeps(db, 21, 1)).toBe(false)
  })

  it('returns false when no dependencies', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(hasUnresolvedDeps(db, 99, 1)).toBe(false)
  })
})
