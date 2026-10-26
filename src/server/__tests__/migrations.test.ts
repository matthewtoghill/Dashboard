import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../db/index.ts';
import { MIGRATIONS, runMigrations } from '../db/migrations.ts';

describe('schema migrations', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-migrations-'));
    dbPath = path.join(dir, 'test.db');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('brings a pre-migration database (tables present, user_version 0) up to date without losing rows', () => {
    // Simulate a database created before migrations existed
    const legacy = new Database(dbPath);
    legacy.exec(MIGRATIONS[0]);
    legacy
      .prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('t1', 'Existing task', 1, 1);
    expect(legacy.pragma('user_version', { simple: true })).toBe(0);
    legacy.close();

    const { sqlite } = createDatabase(dbPath);
    expect(sqlite.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(sqlite.prepare('SELECT title FROM tasks').all()).toEqual([{ title: 'Existing task' }]);
    sqlite.close();
  });

  it('moves a task\'s Azure DevOps link into task_ado_links', () => {
    const old = new Database(dbPath);
    runMigrations(old, MIGRATIONS.slice(0, 9));
    old
      .prepare(
        'INSERT INTO tasks (id, title, created_at, updated_at, external_source, external_id, external_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('t1', 'Linked', 3, 3, 'ado', 'workitem/1', 'https://dev.azure.com/o/_workitems/edit/1');
    old.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('t2', 'Plain', 4, 4);
    old.close();

    const { sqlite } = createDatabase(dbPath);
    expect(sqlite.prepare('SELECT * FROM task_ado_links').all()).toEqual([
      {
        external_id: 'workitem/1',
        task_id: 't1',
        url: 'https://dev.azure.com/o/_workitems/edit/1',
        title: 'Linked',
        type: '',
        state: '',
        linked_at: 3,
      },
    ]);
    const columns = (sqlite.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain('external_id');
    sqlite.close();
  });

  it('applies new migrations in order and rolls back a failing one', () => {
    const sqlite = new Database(dbPath);
    const migrations = [
      ...MIGRATIONS,
      'ALTER TABLE tasks ADD COLUMN example TEXT',
      'ALTER TABLE tasks ADD COLUMN later TEXT; SELECT * FROM no_such_table',
    ];

    expect(() => runMigrations(sqlite, migrations)).toThrow(/no_such_table/);
    // Everything before the failing migration is kept; the failing one left no trace
    expect(sqlite.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length + 1);
    const columns = (sqlite.pragma('table_info(tasks)') as { name: string }[]).map((c) => c.name);
    expect(columns).toContain('example');
    expect(columns).not.toContain('later');
    sqlite.close();
  });

  it('refuses to open a database from a newer app version', () => {
    const newer = new Database(dbPath);
    newer.pragma(`user_version = ${MIGRATIONS.length + 1}`);
    newer.close();

    expect(() => createDatabase(dbPath)).toThrow(/newer than this app supports/);
  });
});
