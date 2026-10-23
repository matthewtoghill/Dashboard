import { describe, it, expect } from 'vitest';
import { Project, Task } from '../../shared/types.ts';
import { completionsByDay, projectProgress } from '../../client/utils/taskUtils.ts';

const TODAY = '2026-10-22';
const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

let seq = 0;
const task = (overrides: Partial<Task>): Task => ({
  id: `t${++seq}`,
  title: 'Task',
  description: '',
  status: 'todo',
  priority: 0,
  projectId: null,
  tags: [],
  dueDate: null,
  sortOrder: 0,
  completedAt: null,
  createdAt: 0,
  updatedAt: 0,
  statusBeforeArchive: null,
  recurrence: null,
  recurrenceParentId: null,
  externalSource: null,
  externalId: null,
  externalUrl: null,
  subtasks: [],
  ...overrides,
});

describe('completionsByDay', () => {
  it('covers every day in the range, oldest first, with zeros', () => {
    const days = completionsByDay([], 14, TODAY);
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ date: '2026-10-09', count: 0 });
    expect(days[13]).toEqual({ date: TODAY, count: 0 });
  });

  it('crosses month ends', () => {
    expect(completionsByDay([], 3, '2026-03-01').map((d) => d.date)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
  });

  it('buckets completions at local midnight boundaries', () => {
    const midnight = localMidnight(2026, 10, 22);
    const days = completionsByDay(
      [
        task({ status: 'done', completedAt: midnight }),
        task({ status: 'done', completedAt: midnight - 1 }),
      ],
      2,
      TODAY
    );
    expect(days).toEqual([
      { date: '2026-10-21', count: 1 },
      { date: '2026-10-22', count: 1 },
    ]);
  });

  it('counts archived completions but not reopened or out-of-range tasks', () => {
    const noon = localMidnight(2026, 10, 20) + 12 * 3600_000;
    const days = completionsByDay(
      [
        task({ status: 'done', completedAt: noon }),
        task({ status: 'archived', completedAt: noon }),
        task({ status: 'todo', completedAt: noon }),
        task({ status: 'done', completedAt: localMidnight(2026, 1, 1) }),
      ],
      14,
      TODAY
    );
    expect(days.find((d) => d.date === '2026-10-20')!.count).toBe(2);
    expect(days.reduce((sum, d) => sum + d.count, 0)).toBe(2);
  });
});

describe('projectProgress', () => {
  const projects: Project[] = [
    { id: 'work', name: 'Work', color: '#6366f1', sortOrder: 1, createdAt: 1 },
    { id: 'home', name: 'Home', color: '#10b981', sortOrder: 2, createdAt: 1 },
    { id: 'idle', name: 'Idle', color: '#f59e0b', sortOrder: 3, createdAt: 1 },
  ];

  it('includes a No project row, excludes archived tasks and sorts by most open', () => {
    const rows = projectProgress(
      [
        task({ projectId: 'work', status: 'done' }),
        task({ projectId: 'work' }),
        task({ projectId: 'home' }),
        task({ projectId: 'home', status: 'in_progress' }),
        task({ projectId: 'home', status: 'archived' }),
        task({ projectId: null }),
        task({ projectId: 'deleted-project', status: 'done' }),
      ],
      projects
    );
    expect(rows).toEqual([
      { projectId: 'home', name: 'Home', color: '#10b981', done: 0, total: 2 },
      { projectId: 'work', name: 'Work', color: '#6366f1', done: 1, total: 2 },
      { projectId: null, name: 'No project', color: null, done: 1, total: 2 },
      { projectId: 'idle', name: 'Idle', color: '#f59e0b', done: 0, total: 0 },
    ]);
  });

  it('omits the No project row when every task has a project', () => {
    const rows = projectProgress([task({ projectId: 'work' })], projects);
    expect(rows.some((r) => r.projectId === null)).toBe(false);
  });
});
