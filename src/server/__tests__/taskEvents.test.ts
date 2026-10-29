import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { TaskEvent } from '../../shared/types.ts';
import { describeTaskEvent, staleTasks } from '../../client/utils/taskUtils.ts';

describe('Task activity log', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ dbPath: ':memory:' }));
  });

  afterEach(async () => {
    await app.close();
  });

  const createTask = async (payload: object = { title: 'T' }) =>
    (await app.inject({ method: 'POST', url: '/api/tasks', payload })).json().task.id as string;
  const patch = (url: string, payload: object) => app.inject({ method: 'PATCH', url, payload });
  const events = async (taskId: string) =>
    (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}/events` })).json()
      .events as TaskEvent[];
  const changes = async (taskId: string) =>
    (await events(taskId)).map(({ kind, from, to, source }) => ({ kind, from, to, source })).reverse();

  it('records creation and only the logged fields that changed', async () => {
    const id = await createTask({ title: 'T', dueDate: '2026-10-12' });
    await patch(`/api/tasks/${id}`, {
      title: 'T',
      description: 'notes are not logged',
      tags: ['nor', 'tags'],
      dueDate: '2026-10-19',
      priority: 2,
    });
    await patch(`/api/tasks/${id}`, { sortOrder: 5 }); // reorder is not an edit
    await patch(`/api/tasks/${id}`, { title: 'Renamed', status: 'done' });
    await patch(`/api/tasks/${id}`, { status: 'todo' }); // undo of complete is a new event

    expect(await changes(id)).toEqual([
      { kind: 'created', from: null, to: null, source: 'manual' },
      { kind: 'due', from: '2026-10-12', to: '2026-10-19', source: 'manual' },
      { kind: 'priority', from: '0', to: '2', source: 'manual' },
      { kind: 'title', from: 'T', to: 'Renamed', source: 'manual' },
      { kind: 'status', from: 'todo', to: 'done', source: 'manual' },
      { kind: 'status', from: 'done', to: 'todo', source: 'manual' },
    ]);
  });

  it('logs bulk archive and restore per task', async () => {
    const a = await createTask();
    const b = await createTask();
    await patch(`/api/tasks/${b}`, { status: 'in_progress' });
    await app.inject({ method: 'POST', url: '/api/tasks/bulk-archive', payload: { ids: [a, b] } });
    await app.inject({ method: 'POST', url: '/api/tasks/bulk-restore', payload: { ids: [b] } });

    expect((await changes(a)).slice(1)).toEqual([
      { kind: 'status', from: 'todo', to: 'archived', source: 'manual' },
    ]);
    expect((await changes(b)).slice(2).map((e) => [e.from, e.to])).toEqual([
      ['in_progress', 'archived'],
      ['archived', 'in_progress'],
    ]);
  });

  it('logs subtasks added, completed and reopened', async () => {
    const id = await createTask();
    const sub = (
      await app.inject({ method: 'POST', url: `/api/tasks/${id}/subtasks`, payload: { title: 'Step' } })
    ).json().subtask;
    await patch(`/api/subtasks/${sub.id}`, { isCompleted: true });
    await patch(`/api/subtasks/${sub.id}`, { isCompleted: true }); // no change
    await patch(`/api/subtasks/${sub.id}`, { isCompleted: false });

    expect((await changes(id)).slice(1).map((e) => [e.kind, e.to])).toEqual([
      ['subtask_added', 'Step'],
      ['subtask_completed', 'Step'],
      ['subtask_reopened', 'Step'],
    ]);
  });

  it('logs Claude sessions linked and unlinked on both tasks', async () => {
    const a = await createTask();
    const b = await createTask();
    await app.inject({
      method: 'POST',
      url: '/api/claude/events',
      payload: { session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'Fix it' },
    });
    await patch('/api/claude/sessions/s1', { taskId: a });
    await patch('/api/claude/sessions/s1', { taskId: b });
    await patch('/api/claude/sessions/s1', { dismissed: true }); // not a link change

    expect((await changes(a)).slice(1).map((e) => [e.kind, e.from, e.to])).toEqual([
      ['session_linked', null, 'Fix it'],
      ['session_unlinked', 'Fix it', null],
    ]);
    expect((await changes(b)).slice(1).map((e) => e.kind)).toEqual(['session_linked']);
  });

  it('records Azure DevOps imports with the ado source', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/ado/import',
      payload: {
        items: [
          {
            externalId: 'workitem/1',
            title: 'Imported',
            url: 'https://dev.azure.com/o/p/_workitems/edit/1',
            adoProject: 'p',
            type: 'Task',
            state: 'Active',
            role: null,
          },
        ],
      },
    });
    const task = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks[0];
    expect(await changes(task.id)).toEqual([{ kind: 'created', from: null, to: null, source: 'ado' }]);
  });

  it('records the next occurrence of a recurring task as created', async () => {
    const id = await createTask({ title: 'R', recurrence: { every: 1, unit: 'day', from: 'due' } });
    const spawned = (await patch(`/api/tasks/${id}`, { status: 'done' })).json().spawnedTaskId;
    expect((await changes(spawned)).map((e) => e.kind)).toEqual(['created']);
  });

  it('round-trips events through export and import and cascades on delete', async () => {
    const id = await createTask();
    await patch(`/api/tasks/${id}`, { priority: 4 });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.taskEvents).toHaveLength(2);

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const imported = (await fresh.inject({ method: 'GET', url: `/api/tasks/${id}/events` })).json();
    expect(imported.events).toEqual(await events(id));
    await fresh.close();

    await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
    expect((await app.inject({ method: 'GET', url: `/api/tasks/${id}/events` })).statusCode).toBe(404);
    const after = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(after.taskEvents).toEqual([]);
  });
});

describe('Status notes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ dbPath: ':memory:' }));
  });

  afterEach(async () => {
    await app.close();
  });

  const createTask = async (payload: object = { title: 'T' }) =>
    (await app.inject({ method: 'POST', url: '/api/tasks', payload })).json().task.id as string;
  const note = (id: string, text: unknown) =>
    app.inject({ method: 'POST', url: `/api/tasks/${id}/notes`, payload: { text } });
  const listed = async () => (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks;
  const events = async (id: string) =>
    (await app.inject({ method: 'GET', url: `/api/tasks/${id}/events` })).json().events as TaskEvent[];

  it('records a manual note event and exposes the newest as latestNote', async () => {
    const id = await createTask();
    expect((await listed())[0].latestNote ?? null).toBeNull();

    expect((await note(id, 'Waiting on receipts')).statusCode).toBe(201);
    const second = await note(id, '  Receipts collected,\n form half done ');
    expect(second.json().task.latestNote.text).toBe('Receipts collected, form half done');

    expect((await listed())[0].latestNote.text).toBe('Receipts collected, form half done');
    expect((await events(id)).filter((e) => e.kind === 'status_note').map((e) => [e.to, e.source])).toEqual([
      ['Receipts collected, form half done', 'manual'],
      ['Waiting on receipts', 'manual'],
    ]);
  });

  it('rejects empty and over-long notes and unknown tasks', async () => {
    const id = await createTask();
    expect((await note(id, '   ')).statusCode).toBe(400);
    expect((await note(id, 'x'.repeat(281))).statusCode).toBe(400);
    expect((await note(id, 'x'.repeat(280))).statusCode).toBe(201);
    expect((await note('missing', 'hi')).statusCode).toBe(404);
  });

  it('accepts notes on archived tasks without changing their status', async () => {
    const id = await createTask();
    await app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { status: 'archived' } });
    expect((await note(id, 'Parked until Q1')).statusCode).toBe(201);
    expect((await listed())[0]).toMatchObject({ status: 'archived', latestNote: { text: 'Parked until Q1' } });
  });

  it('counts as touching the task, so it leaves the stale list', async () => {
    const id = await createTask();
    const month = 30 * 24 * 60 * 60 * 1000;
    const future = Date.now() + month;
    expect(staleTasks(await listed(), 14, future).map((t) => t.id)).toEqual([id]);
    await note(id, 'Still on it');
    const after = await listed();
    expect(after[0].updatedAt).toBeGreaterThan(after[0].createdAt - 1);
    expect(staleTasks(after, 14, after[0].updatedAt + 13 * 24 * 60 * 60 * 1000)).toEqual([]);
  });

  it('round-trips through export and import, and cascades on delete', async () => {
    const id = await createTask();
    await note(id, 'Half done');
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const tasks = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks;
    expect(tasks[0].latestNote.text).toBe('Half done');
    await fresh.close();

    await app.inject({ method: 'DELETE', url: `/api/tasks/${id}` });
    expect((await app.inject({ method: 'GET', url: '/api/export' })).json().taskEvents).toEqual([]);
  });

  it('describes a note', () => {
    const ev: TaskEvent = { id: 'e', taskId: 't', at: 0, kind: 'status_note', from: null, to: 'Half done', source: 'manual' };
    expect(describeTaskEvent(ev, [])).toBe('Note: Half done');
  });
});

describe('describeTaskEvent', () => {
  const ev = (kind: TaskEvent['kind'], from: string | null, to: string | null): TaskEvent => ({
    id: 'e',
    taskId: 't',
    at: 0,
    kind,
    from,
    to,
    source: 'manual',
  });
  const projects = [{ id: 'p1', name: 'Work', color: '#000', sortOrder: 0, createdAt: 0, adoEnabled: true }];

  it('describes each kind of change', () => {
    expect(describeTaskEvent(ev('status', 'todo', 'done'), projects)).toBe('Completed');
    expect(describeTaskEvent(ev('status', 'archived', 'todo'), projects)).toBe('Restored to To Do');
    expect(describeTaskEvent(ev('status', 'done', 'in_progress'), projects)).toBe(
      'Reopened as In Progress'
    );
    expect(describeTaskEvent(ev('status', 'todo', 'in_progress'), projects)).toBe(
      'Status To Do → In Progress'
    );
    expect(describeTaskEvent(ev('due', null, '2026-10-19'), projects)).toBe('Due Mon, Oct 19');
    expect(describeTaskEvent(ev('priority', '0', '4'), projects)).toBe('Priority No Priority → Urgent');
    expect(describeTaskEvent(ev('project', null, 'p1'), projects)).toBe('Project No project → Work');
    expect(describeTaskEvent(ev('project', 'gone', null), projects)).toBe(
      'Project Deleted project → No project'
    );
  });
});
