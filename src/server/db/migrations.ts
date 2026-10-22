import type Database from 'better-sqlite3';

/**
 * Schema migrations, applied in order. `PRAGMA user_version` records how many have run.
 * Never edit or reorder a shipped migration: append a new one and update `schema.ts` to match.
 */
export const MIGRATIONS: string[] = [
  // 0: initial schema (Stages 1-4). IF NOT EXISTS keeps databases created before
  // migrations existed (tables present, user_version still 0) working.
  `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority INTEGER NOT NULL DEFAULT 0,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      due_date TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      is_completed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS quick_links (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS key_value_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(sort_order);
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
  `,

  // 1: remember a task's status when it is archived, so restore can return it there
  `ALTER TABLE tasks ADD COLUMN status_before_archive TEXT;`,

  // 2: recurring tasks. recurrence is JSON (see shared/recurrence.ts); recurrence_parent_id
  // links an occurrence to the completed task that spawned it.
  `
    ALTER TABLE tasks ADD COLUMN recurrence TEXT;
    ALTER TABLE tasks ADD COLUMN recurrence_parent_id TEXT;
    CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_parent_id ON tasks(recurrence_parent_id);
  `,
];

/** Applies pending migrations, each in its own transaction together with its version bump. */
export function runMigrations(sqlite: Database.Database, migrations: string[] = MIGRATIONS): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number;
  if (current > migrations.length) {
    throw new Error(
      `Database schema version ${current} is newer than this app supports (${migrations.length}). ` +
        'Update the app, or restore a backup made by this version.'
    );
  }

  for (let version = current; version < migrations.length; version++) {
    sqlite.transaction(() => {
      sqlite.exec(migrations[version]);
      sqlite.pragma(`user_version = ${version + 1}`);
    })();
  }
}
