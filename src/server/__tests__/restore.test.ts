import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';
import { MIGRATIONS, runMigrations } from '../db/migrations.ts';
import type { RestoreDiff } from '../../shared/types.ts';
import { DEFAULT_VIEW_STATE } from '../../client/utils/taskView.ts';

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
    expect((await memory.inject({ method: 'POST', url: '/api/backups/x.db/restore', payload: {} })).statusCode).toBe(400);
    await memory.close();
  });

  describe('restoring', () => {
    const restore = (file: string, payload: object) =>
      request('POST', `/api/backups/${encodeURIComponent(file)}/restore`, payload);
    const backupCount = () => fs.readdirSync(path.join(dir, 'backups')).length;
    const eventCount = (taskId: string) =>
      (sqlite.prepare('SELECT count(*) AS n FROM task_events WHERE task_id = ?').get(taskId) as { n: number }).n;

    it('brings back only the ticked task, with its subtasks and history, after a safety backup', async () => {
      const wanted = (await request('POST', '/api/tasks', { title: 'Wanted' })).json().task;
      const unwanted = (await request('POST', '/api/tasks', { title: 'Unwanted' })).json().task;
      await request('POST', `/api/tasks/${wanted.id}/subtasks`, { title: 'Step' });
      const events = eventCount(wanted.id);
      expect(events).toBeGreaterThan(0);
      const file = await backUp();
      await request('DELETE', `/api/tasks/${wanted.id}`);
      await request('DELETE', `/api/tasks/${unwanted.id}`);
      const before = backupCount();

      const res = await restore(file, { add: { tasks: [wanted.id] } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ restored: { tasks: 1, projects: 0 }, settings: 0, scratchpad: false, warnings: [] });

      const tasks = (await request('GET', '/api/tasks')).json().tasks;
      expect(tasks.map((t: { title: string }) => t.title)).toEqual(['Wanted']);
      expect(tasks[0].subtasks.map((s: { title: string }) => s.title)).toEqual(['Step']);
      expect(eventCount(wanted.id)).toBe(events);
      expect(backupCount()).toBe(before + 1);
    });

    it('does not prune the backup being restored from', async () => {
      await request('PUT', '/api/settings', { backupKeep: 1 });
      const task = (await request('POST', '/api/tasks', { title: 'Only' })).json().task;
      const file = await backUp(); // prunes down to this one
      await request('DELETE', `/api/tasks/${task.id}`);
      expect((await restore(file, { add: { tasks: [task.id] } })).statusCode).toBe(200);
      expect(fs.existsSync(path.join(dir, 'backups', file))).toBe(true);
    });

    it('restores chosen settings fields only, and the scratchpad when asked', async () => {
      await request('PUT', '/api/settings', { backupKeep: 3, planSize: 4, primaryColor: 'rose' });
      await request('PUT', '/api/dashboard/scratchpad', { content: 'old notes' });
      const file = await backUp();
      await request('PUT', '/api/settings', { backupKeep: 8, planSize: 9, primaryColor: 'blue', density: 'compact' });
      await request('PUT', '/api/dashboard/scratchpad', { content: 'new notes' });

      const res = await restore(file, { settings: ['backupKeep', 'planSize'], scratchpad: true });
      expect(res.json()).toMatchObject({ settings: 2, scratchpad: true });
      const settings = (await request('GET', '/api/settings')).json().settings;
      expect(settings).toMatchObject({ backupKeep: 3, planSize: 4, primaryColor: 'blue', density: 'compact' });
      expect((await request('GET', '/api/dashboard')).json().scratchpad).toBe('old notes');
    });

    it('drops a project that is not restored, and keeps it when ticked too', async () => {
      const project = (await request('POST', '/api/projects', { name: 'Gone' })).json().project;
      const task = (await request('POST', '/api/tasks', { title: 'In project', projectId: project.id })).json().task;
      const file = await backUp();
      await request('DELETE', `/api/tasks/${task.id}`);
      await request('DELETE', `/api/projects/${project.id}`);

      const alone = await restore(file, { add: { tasks: [task.id] } });
      expect(alone.json().warnings).toEqual(['Task "In project" was restored without its project "Gone".']);
      expect((await request('GET', '/api/tasks')).json().tasks[0].projectId).toBeNull();

      await request('DELETE', `/api/tasks/${task.id}`);
      const both = await restore(file, { add: { tasks: [task.id], projects: [project.id] } });
      expect(both.json()).toMatchObject({ restored: { tasks: 1, projects: 1 }, warnings: [] });
      expect((await request('GET', '/api/tasks')).json().tasks[0].projectId).toBe(project.id);
    });

    it('skips a Claude session whose task is not in the database', async () => {
      const task = (await request('POST', '/api/tasks', { title: 'Has session' })).json().task;
      sqlite
        .prepare('INSERT INTO claude_sessions (session_id, cwd, title, state, task_id, started_at, last_event_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('s1', 'C:/a', 'Work', 'idle', task.id, 1, 1);
      const file = await backUp();
      await request('DELETE', `/api/tasks/${task.id}`); // the session stays, unlinked
      sqlite.prepare('DELETE FROM claude_sessions').run();

      const alone = await restore(file, { add: { claudeSessions: ['s1'] } });
      expect(alone.json()).toMatchObject({
        restored: { claudeSessions: 0 },
        warnings: ['Claude session "Work" was skipped because its task isn\'t in the database.'],
      });

      await restore(file, { add: { claudeSessions: ['s1'], tasks: [task.id] } });
      expect(sqlite.prepare('SELECT task_id FROM claude_sessions').all()).toEqual([{ task_id: task.id }]);
    });

    it('overwrites a changed task in place, keeping its history, newer links and sessions', async () => {
      const task = (await request('POST', '/api/tasks', { title: 'Original', priority: 1 })).json().task;
      const step = (await request('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Step' })).json().subtask;
      const linkAdo = sqlite.prepare(
        'INSERT INTO task_ado_links (external_id, task_id, url, linked_at) VALUES (?, ?, ?, ?)'
      );
      linkAdo.run('workitem/1', task.id, 'https://dev.azure.com/acme/_workitems/edit/1', 1);
      sqlite
        .prepare('INSERT INTO claude_sessions (session_id, cwd, state, task_id, started_at, last_event_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run('s1', 'C:/a', 'idle', task.id, 1, 1);
      const file = await backUp();
      const backupUpdatedAt = (sqlite.prepare('SELECT updated_at FROM tasks').get() as { updated_at: number }).updated_at;

      await request('PATCH', `/api/tasks/${task.id}`, { title: 'Edited', priority: 3, status: 'done' });
      await request('PATCH', `/api/subtasks/${step.id}`, { title: 'Renamed' });
      await request('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Added later' });
      sqlite.prepare('DELETE FROM task_ado_links').run();
      linkAdo.run('workitem/2', task.id, 'https://dev.azure.com/acme/_workitems/edit/2', 2);
      const events = eventCount(task.id);

      const res = await restore(file, { overwrite: { tasks: [task.id] } });
      expect(res.json()).toMatchObject({ restored: { tasks: 0 }, overwritten: { tasks: 1 }, warnings: [] });

      const [restored] = (await request('GET', '/api/tasks')).json().tasks;
      expect(restored).toMatchObject({ title: 'Original', priority: 1, status: 'todo', updatedAt: backupUpdatedAt });
      expect(restored.subtasks.map((s: { title: string }) => s.title)).toEqual(['Step']);
      expect(restored.adoLinks.map((l: { externalId: string }) => l.externalId).sort()).toEqual(['workitem/1', 'workitem/2']);
      expect(eventCount(task.id)).toBe(events);
      expect(sqlite.prepare('SELECT task_id FROM claude_sessions').get()).toEqual({ task_id: task.id });
    });

    it('overwrites changed projects, notes, quick links, saved views and ADO project mappings', async () => {
      const project = (await request('POST', '/api/projects', { name: 'Work', color: '#112233' })).json().project;
      const note = (await request('POST', '/api/notes', { title: 'Note', body: 'v1', tags: ['a'] })).json().note;
      const link = (await request('POST', '/api/quick-links', { title: 'Docs', url: 'https://a.example' })).json().quickLink;
      const view = { id: 'v1', name: 'Mine', view: DEFAULT_VIEW_STATE, createdAt: 1 };
      await request('PUT', '/api/dashboard/saved-views', { savedViews: [view] });
      const mapping = { adoProject: 'Acme', projectId: project.id, workItemTypes: null, ignoredStates: ['Done'] };
      await request('PUT', '/api/ado/projects', { links: [mapping] });
      const file = await backUp();

      await request('PATCH', `/api/projects/${project.id}`, { name: 'Renamed', color: '#445566' });
      await request('PATCH', `/api/notes/${note.id}`, { body: 'v2', tags: ['b'] });
      await request('PUT', `/api/quick-links/${link.id}`, { title: 'Wiki', url: 'https://b.example', category: 'Other' });
      await request('PUT', '/api/dashboard/saved-views', {
        savedViews: [{ ...view, name: 'Changed' }, { ...view, id: 'v2', name: 'Newer' }],
      });
      await request('PUT', '/api/ado/projects', { links: [{ ...mapping, ignoredStates: null }] });

      const res = await restore(file, {
        overwrite: {
          projects: [project.id],
          notes: [note.id],
          quickLinks: [link.id],
          savedViews: ['v1'],
          adoProjectLinks: ['Acme'],
        },
      });
      expect(res.statusCode).toBe(200);
      const after = await diff(file);
      for (const section of ['projects', 'notes', 'quickLinks', 'savedViews', 'adoProjectLinks'] as const) {
        expect(after.sections[section]).toEqual([]);
      }
      const views = (await request('GET', '/api/dashboard')).json().savedViews;
      expect(views.map((v: { name: string }) => v.name)).toEqual(['Mine', 'Newer']);
    });

    it('rejects anything the diff does not offer, without a safety backup', async () => {
      const task = (await request('POST', '/api/tasks', { title: 'Still here' })).json().task;
      const file = await backUp();
      const before = backupCount();
      for (const body of [
        { add: { tasks: [task.id] } }, // not missing
        { overwrite: { tasks: [task.id] } }, // unchanged
        { overwrite: { tasks: ['nope'] } },
        { overwrite: { adoDismissed: [] }, add: { notes: ['nope'] } },
        { add: { notes: ['nope'] } },
        { settings: ['primaryColor'] }, // unchanged
        { settings: ['backupDir'] },
        { scratchpad: true }, // backup has none
        { add: { widgets: [] } },
        { unexpected: true },
      ]) {
        expect((await restore(file, body)).statusCode).toBe(400);
      }
      expect((await restore('dashboard-missing.db', {})).statusCode).toBe(404);
      expect(backupCount()).toBe(before);
    });
  });
});
