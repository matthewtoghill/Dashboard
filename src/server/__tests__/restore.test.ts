import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';
import { MIGRATIONS, runMigrations } from '../db/migrations.ts';
import type { RestoreDiff } from '../../shared/types.ts';

describe('selective restore', () => {
  let dir: string;
  let app: FastifyInstance;
  let sqlite: Database.Database;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-restore-'));
    const built = await buildApp({ dbPath: path.join(dir, 'test.db') });
    app = built.app;
    sqlite = built.db.$client;
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const request = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload });
  const backUp = async (): Promise<string> => (await request('POST', '/api/backups')).json().backup.file;
  const diff = async (file: string): Promise<RestoreDiff> =>
    (await request('GET', `/api/backups/${encodeURIComponent(file)}/diff`)).json();

  it('lists missing and changed items, changed fields and settings', async () => {
    const kept = (await request('POST', '/api/tasks', { title: 'Kept' })).json().task;
    const deleted = (await request('POST', '/api/tasks', { title: 'Deleted' })).json().task;
    await request('POST', `/api/tasks/${deleted.id}/subtasks`, { title: 'Step' });
    const note = (await request('POST', '/api/notes', { title: 'Plan', body: 'v1' })).json().note;
    await request('PUT', '/api/settings', { backupKeep: 5 });
    const file = await backUp();

    await request('DELETE', `/api/tasks/${deleted.id}`);
    await request('PATCH', `/api/notes/${note.id}`, { body: 'v2' });
    await request('PUT', '/api/settings', { backupKeep: 9, primaryColor: 'blue' });
    await request('POST', '/api/tasks', { title: 'Added after the backup' });

    const result = await diff(file);
    expect(result.sections.tasks).toEqual([{ id: deleted.id, label: 'Deleted', state: 'missing', changes: [] }]);
    expect(result.sections.notes).toEqual([
      {
        id: note.id,
        label: 'Plan',
        state: 'changed',
        changes: expect.arrayContaining([{ field: 'body', backup: 'v1', live: 'v2' }]),
      },
    ]);
    expect(result.settings).toEqual(
      expect.arrayContaining([
        { field: 'backupKeep', backup: 5, live: 9 },
        { field: 'primaryColor', backup: 'indigo', live: 'blue' },
      ])
    );
    expect(result.settings).toHaveLength(2);
    expect(result.sections.tasks.some((t) => t.id === kept.id)).toBe(false);
  });

  it('ignores ADO link snapshots and updatedAt-only differences', async () => {
    const task = (await request('POST', '/api/tasks', { title: 'Linked' })).json().task;
    sqlite
      .prepare('INSERT INTO task_ado_links (external_id, task_id, url, state, linked_at) VALUES (?, ?, ?, ?, ?)')
      .run('workitem/1', task.id, 'https://dev.azure.com/acme/_workitems/edit/1', 'New', 1);
    const file = await backUp();

    // What a background ADO check does: refresh the link and bump the task
    sqlite.prepare("UPDATE task_ado_links SET state = 'Active', title = 'Renamed'").run();
    sqlite.prepare('UPDATE tasks SET updated_at = updated_at + 1000').run();
    expect((await diff(file)).sections.tasks).toEqual([]);

    // A real edit lists updatedAt alongside it
    await request('PATCH', `/api/tasks/${task.id}`, { title: 'Edited' });
    const [changed] = (await diff(file)).sections.tasks;
    expect(changed).toMatchObject({ id: task.id, label: 'Linked', state: 'changed' });
    expect(changed.changes.map((c) => c.field).sort()).toEqual(['title', 'updatedAt']);
  });

  it('offers only missing Claude sessions that were linked to a task', async () => {
    const task = (await request('POST', '/api/tasks', { title: 'With session' })).json().task;
    const insert = sqlite.prepare(
      'INSERT INTO claude_sessions (session_id, cwd, state, task_id, started_at, last_event_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run('linked', 'C:/a', 'idle', task.id, 1, 1);
    insert.run('unlinked', 'C:/b', 'idle', null, 1, 1);
    insert.run('active', 'C:/c', 'idle', task.id, 1, 1);
    const file = await backUp();

    sqlite.prepare("DELETE FROM claude_sessions WHERE session_id IN ('linked', 'unlinked')").run();
    sqlite.prepare("UPDATE claude_sessions SET state = 'running', last_event_at = 99").run();
    expect((await diff(file)).sections.claudeSessions).toEqual([
      { id: 'linked', label: 'C:/a', state: 'missing', changes: [] },
    ]);
  });

  it('reads a backup written at an older schema version', async () => {
    const backupDir = path.join(dir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const file = 'dashboard-2020-01-01T00-00-00-000Z.db';
    const old = new Database(path.join(backupDir, file));
    runMigrations(old, MIGRATIONS.slice(0, 14));
    old.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run('old', 'Old task', 1, 1);
    // Saved before planSize existed: it is not offered, though the live value differs from its default
    old
      .prepare('INSERT INTO key_value_store (key, value, updated_at) VALUES (?, ?, ?)')
      .run('settings', JSON.stringify({ backupKeep: 3 }), 1);
    old.close();
    await request('PUT', '/api/settings', { planSize: 10 });

    const result = await diff(file);
    expect(result.sections.tasks).toEqual([{ id: 'old', label: 'Old task', state: 'missing', changes: [] }]);
    expect(result.settings).toEqual([{ field: 'backupKeep', backup: 3, live: 14 }]);
    // The backup file itself is left at its old version
    const check = new Database(path.join(backupDir, file), { readonly: true });
    expect(check.pragma('user_version', { simple: true })).toBe(14);
    check.close();
  });

  it('refuses unknown and path-traversal file names', async () => {
    await backUp();
    fs.writeFileSync(path.join(dir, 'dashboard-outside.db'), '');
    for (const file of ['dashboard-missing.db', '../dashboard-outside.db', '..%2Fdashboard-outside.db']) {
      expect((await request('GET', `/api/backups/${encodeURIComponent(file)}/diff`)).statusCode).toBe(404);
    }
  });

  it('is unavailable for in-memory databases', async () => {
    const { app: memory } = await buildApp({ dbPath: ':memory:' });
    expect((await memory.inject({ method: 'GET', url: '/api/backups/x.db/diff' })).statusCode).toBe(400);
    await memory.close();
  });
});
