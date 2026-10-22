import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import {
  Recurrence,
  describeRecurrence,
  nextOccurrence,
  parseRecurrenceToken,
} from '../../shared/recurrence.ts';
import { toIsoDate } from '../../shared/dates.ts';

const rule = (every: number, unit: Recurrence['unit'], from: Recurrence['from'] = 'due') => ({
  every,
  unit,
  from,
});

describe('recurrence rules', () => {
  const thu = '2026-10-22'; // a Thursday

  it('steps from the due date and skips ahead past today', () => {
    expect(nextOccurrence(rule(1, 'week'), thu, thu)).toBe('2026-10-29');
    expect(nextOccurrence(rule(2, 'day'), '2026-10-21', thu)).toBe('2026-10-23');
    // three weeks overdue weekly task: next one is in the future, not another overdue one
    expect(nextOccurrence(rule(1, 'week'), '2026-10-01', thu)).toBe('2026-10-29');
    // no due date: from today
    expect(nextOccurrence(rule(3, 'day'), null, thu)).toBe('2026-10-25');
  });

  it('steps from the completion date when asked', () => {
    expect(nextOccurrence(rule(2, 'week', 'completion'), '2026-09-01', thu)).toBe('2026-11-05');
  });

  it('clamps months and handles leap years', () => {
    expect(nextOccurrence(rule(1, 'month'), '2026-01-31', '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(rule(1, 'month'), '2028-01-31', '2028-01-31')).toBe('2028-02-29');
    expect(nextOccurrence(rule(12, 'month'), '2028-02-29', '2028-02-29')).toBe('2029-02-28');
  });

  it('counts weekdays only', () => {
    expect(nextOccurrence(rule(1, 'weekday'), thu, thu)).toBe('2026-10-23'); // Fri
    expect(nextOccurrence(rule(1, 'weekday'), '2026-10-23', '2026-10-23')).toBe('2026-10-26'); // Fri -> Mon
    expect(nextOccurrence(rule(2, 'weekday'), thu, thu)).toBe('2026-10-26'); // Thu + 2 -> Mon
    expect(nextOccurrence(rule(1, 'weekday'), '2026-10-24', '2026-10-24')).toBe('2026-10-26'); // Sat -> Mon
  });

  it('describes rules and parses quick-add tokens', () => {
    expect(describeRecurrence(rule(1, 'day'))).toBe('Daily');
    expect(describeRecurrence(rule(1, 'weekday'))).toBe('Every weekday');
    expect(describeRecurrence(rule(2, 'week', 'completion'))).toBe('Every 2 weeks (after completion)');

    expect(parseRecurrenceToken('daily')).toEqual(rule(1, 'day'));
    expect(parseRecurrenceToken('Weekdays')).toEqual(rule(1, 'weekday'));
    expect(parseRecurrenceToken('monthly!')).toEqual(rule(1, 'month', 'completion'));
    expect(parseRecurrenceToken('2w!')).toEqual(rule(2, 'week', 'completion'));
    expect(parseRecurrenceToken('10d')).toEqual(rule(10, 'day'));
    expect(parseRecurrenceToken('0d')).toBeNull();
    expect(parseRecurrenceToken('fortnightly')).toBeNull();
  });
});

describe('recurring tasks API', () => {
  let app: FastifyInstance;
  const today = toIsoDate(new Date());

  beforeEach(async () => {
    app = (await buildApp({ dbPath: ':memory:' })).app;
  });
  afterEach(async () => {
    await app.close();
  });

  const json = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    (await app.inject({ method, url, payload })).json();
  const allTasks = async () => (await json('GET', '/api/tasks')).tasks;

  async function createRecurring() {
    const { task } = await json('POST', '/api/tasks', {
      title: 'Water plants',
      priority: 2,
      tags: ['home'],
      dueDate: today,
      recurrence: rule(1, 'week'),
    });
    await json('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Balcony' });
    return task;
  }

  it('completing spawns exactly one next occurrence with fresh subtasks', async () => {
    const task = await createRecurring();
    const { subtask } = await json('POST', `/api/tasks/${task.id}/subtasks`, { title: 'Hallway' });
    await json('PATCH', `/api/subtasks/${subtask.id}`, { isCompleted: true });

    const done = await json('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
    expect(done.spawnedTaskId).toBeTruthy();

    const next = (await allTasks()).find((t: { id: string }) => t.id === done.spawnedTaskId);
    expect(next).toMatchObject({
      title: 'Water plants',
      status: 'todo',
      priority: 2,
      tags: ['home'],
      recurrence: rule(1, 'week'),
      recurrenceParentId: task.id,
      completedAt: null,
    });
    expect(next.dueDate > today).toBe(true);
    expect(next.subtasks.map((s: { title: string; isCompleted: boolean }) => [s.title, s.isCompleted]))
      .toEqual([['Balcony', false], ['Hallway', false]]);

    // completing the same task again (done -> done) or via archive does not spawn again
    await json('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
    await json('POST', '/api/tasks/bulk-archive', { ids: [task.id] });
    expect(await allTasks()).toHaveLength(2);
  });

  it('reopening removes an untouched next occurrence but keeps an edited one', async () => {
    const task = await createRecurring();
    const first = await json('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
    const reopened = await json('PATCH', `/api/tasks/${task.id}`, { status: 'todo' });
    expect(reopened.removedOccurrenceId).toBe(first.spawnedTaskId);
    expect(await allTasks()).toHaveLength(1);

    const second = await json('PATCH', `/api/tasks/${task.id}`, { status: 'done' });
    await json('PATCH', `/api/tasks/${second.spawnedTaskId}`, { title: 'Water plants (edited)' });
    const reopenedAgain = await json('PATCH', `/api/tasks/${task.id}`, { status: 'in_progress' });
    expect(reopenedAgain.keptOccurrenceId).toBe(second.spawnedTaskId);
    expect(await allTasks()).toHaveLength(2);
  });

  it('non-recurring tasks never spawn, and recurrence survives export/import', async () => {
    const plain = (await json('POST', '/api/tasks', { title: 'Once' })).task;
    expect((await json('PATCH', `/api/tasks/${plain.id}`, { status: 'done' })).spawnedTaskId).toBeUndefined();

    const task = await createRecurring();
    await json('PATCH', `/api/tasks/${task.id}`, { recurrence: rule(3, 'day', 'completion') });
    const exported = await json('GET', '/api/export');

    const fresh = (await buildApp({ dbPath: ':memory:' })).app;
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const imported = (await fresh.inject({ method: 'GET', url: '/api/tasks' }))
      .json()
      .tasks.find((t: { id: string }) => t.id === task.id);
    expect(imported.recurrence).toEqual(rule(3, 'day', 'completion'));
    await fresh.close();

    // clearing the rule
    const cleared = await json('PATCH', `/api/tasks/${task.id}`, { recurrence: null });
    expect(cleared.task.recurrence).toBeNull();

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { recurrence: { every: 0, unit: 'day', from: 'due' } },
    });
    expect(bad.statusCode).toBe(400);
  });
});
