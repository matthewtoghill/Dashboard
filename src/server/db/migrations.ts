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

  // 3: Claude Code sessions, reported by hooks (see routes/claude.ts)
  `
    CREATE TABLE claude_sessions (
      session_id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      started_at INTEGER NOT NULL,
      last_event_at INTEGER NOT NULL
    );
    CREATE INDEX idx_claude_sessions_task_id ON claude_sessions(task_id);
  `,

  // 4: Claude session details for the side panel, the desktop app's session id for deep
  // links, and "cleared" sessions hidden from the Overview until they become active again
  `
    ALTER TABLE claude_sessions ADD COLUMN entrypoint TEXT NOT NULL DEFAULT '';
    ALTER TABLE claude_sessions ADD COLUMN host_session_id TEXT;
    ALTER TABLE claude_sessions ADD COLUMN last_prompt TEXT NOT NULL DEFAULT '';
    ALTER TABLE claude_sessions ADD COLUMN last_tool TEXT NOT NULL DEFAULT '';
    ALTER TABLE claude_sessions ADD COLUMN attention_message TEXT NOT NULL DEFAULT '';
    ALTER TABLE claude_sessions ADD COLUMN dismissed_at INTEGER;
  `,

  // 5: Azure DevOps import. Tasks keep a link to their source item; the unique index stops a
  // re-import creating duplicates. ado_project_links maps ADO projects to Dashboard projects.
  `
    ALTER TABLE tasks ADD COLUMN external_source TEXT;
    ALTER TABLE tasks ADD COLUMN external_id TEXT;
    ALTER TABLE tasks ADD COLUMN external_url TEXT;
    CREATE UNIQUE INDEX idx_tasks_external ON tasks(external_source, external_id);
    CREATE TABLE ado_project_links (
      ado_project TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      work_item_types TEXT
    );
  `,

  // 6: Task activity log. One row per recorded change; from/to hold the old and new values as text.
  `
    CREATE TABLE task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      source TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE INDEX idx_task_events_task ON task_events(task_id, at);
  `,

  // 7: Azure DevOps sync check. A mapped project can override the ignored states setting.
  `
    ALTER TABLE ado_project_links ADD COLUMN ignored_states TEXT;
  `,

  // 8: A Dashboard project can switch Azure DevOps off.
  `
    ALTER TABLE projects ADD COLUMN ado_enabled INTEGER NOT NULL DEFAULT 1;
  `,

  // 9: A task can link several Azure DevOps items. Each item links to at most one task and keeps a
  // snapshot of its title, type and state, refreshed by checks. Moves the links off the tasks table.
  `
    CREATE TABLE task_ado_links (
      external_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      linked_at INTEGER NOT NULL
    );
    CREATE INDEX idx_task_ado_links_task ON task_ado_links(task_id);
    INSERT INTO task_ado_links (external_id, task_id, url, title, type, linked_at)
      SELECT external_id, id, external_url, title,
        CASE WHEN external_id LIKE 'pr/%' THEN 'Pull Request' ELSE '' END, created_at
      FROM tasks
      WHERE external_source = 'ado' AND external_id IS NOT NULL AND external_url IS NOT NULL;
    DROP INDEX idx_tasks_external;
    ALTER TABLE tasks DROP COLUMN external_source;
    ALTER TABLE tasks DROP COLUMN external_id;
    ALTER TABLE tasks DROP COLUMN external_url;
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
