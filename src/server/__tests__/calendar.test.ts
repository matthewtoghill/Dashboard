import { describe, it, expect } from 'vitest';
import { Task } from '../../shared/types.ts';
import { occurrencesBetween } from '../../shared/recurrence.ts';
import { calendarDays, calendarEntries, calendarTitle, shiftAnchor } from '../../client/utils/calendar.ts';

let seq = 0;
function task(overrides: Partial<Task>): Task {
  seq++;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    description: '',
    status: 'todo',
    priority: 0,
    projectId: null,
    tags: [],
    dueDate: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: seq,
    updatedAt: seq,
    statusBeforeArchive: null,
    recurrence: null,
    recurrenceParentId: null,
    externalSource: null,
    externalId: null,
    externalUrl: null,
    subtasks: [],
    ...overrides,
  };
}

describe('calendarDays', () => {
  it('covers the month in whole weeks from the week start', () => {
    // October 2026 starts on a Thursday and ends on a Saturday
    const monday = calendarDays('month', '2026-10-23', 1);
    expect(monday[0]).toBe('2026-09-28');
    expect(monday.at(-1)).toBe('2026-11-01');
    expect(monday).toHaveLength(35);

    const sunday = calendarDays('month', '2026-10-23', 0);
    expect(sunday[0]).toBe('2026-09-27');
    expect(sunday.at(-1)).toBe('2026-10-31');
  });

  it('gives the seven days of the anchor week', () => {
    expect(calendarDays('week', '2026-10-25', 1)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    expect(calendarDays('week', '2026-10-25', 0)[0]).toBe('2026-10-25');
  });
});

describe('shiftAnchor and calendarTitle', () => {
  it('steps by month (clamped) or week', () => {
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftAnchor('week', '2026-10-23', 1)).toBe('2026-10-30');
  });

  it('names the month or week range', () => {
    expect(calendarTitle('month', [], '2026-10-23')).toBe('October 2026');
    expect(calendarTitle('week', calendarDays('week', '2026-10-23', 1), '2026-10-23')).toBe('Oct 19 – Oct 25 2026');
  });
});

describe('occurrencesBetween', () => {
  it('lists fixed-schedule dates after the due date within the range', () => {
    const weekly = { every: 1, unit: 'week', from: 'due' } as const;
    expect(occurrencesBetween(weekly, '2026-10-01', '2026-10-10', '2026-10-31')).toEqual([
      '2026-10-15', '2026-10-22', '2026-10-29',
    ]);
  });

  it('projects nothing for completion-based rules', () => {
    expect(occurrencesBetween({ every: 1, unit: 'day', from: 'completion' }, '2026-10-01', '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('calendarEntries', () => {
  const days = calendarDays('week', '2026-10-23', 1);

  it('places tasks on their due day, done last, then by priority', () => {
    const done = task({ dueDate: '2026-10-20', status: 'done', priority: 4 });
    const low = task({ dueDate: '2026-10-20', priority: 1 });
    const high = task({ dueDate: '2026-10-20', priority: 3 });
    const undated = task({});
    const entries = calendarEntries([done, low, high, undated], days, true);
    expect(entries.get('2026-10-20')!.map((e) => e.task.id)).toEqual([high.id, low.id, done.id]);
    expect([...entries.values()].flat()).toHaveLength(3);
  });

  it('hides completed tasks unless asked', () => {
    const done = task({ dueDate: '2026-10-20', status: 'done' });
    expect(calendarEntries([done], days, false).get('2026-10-20')).toEqual([]);
  });

  it('adds ghost occurrences for unfinished recurring tasks only', () => {
    const rule = { every: 2, unit: 'day', from: 'due' } as const;
    const open = task({ dueDate: '2026-10-19', recurrence: rule });
    const finished = task({ dueDate: '2026-10-19', recurrence: rule, status: 'done' });
    const entries = calendarEntries([open, finished], days, true);
    const ghosts = [...entries.entries()].flatMap(([day, list]) =>
      list.filter((e) => e.ghost).map((e) => `${day}:${e.task.id}`)
    );
    expect(ghosts).toEqual([`2026-10-21:${open.id}`, `2026-10-23:${open.id}`, `2026-10-25:${open.id}`]);
  });
});
