import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { TaskEvent } from '../../shared/types.ts';
import { describeTaskEvent } from '../../client/utils/taskUtils.ts';

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
  const projects = [{ id: 'p1', name: 'Work', color: '#000', sortOrder: 0, createdAt: 0 }];

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
