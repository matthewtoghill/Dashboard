import { describe, it, expect } from 'vitest';
import { Project, Task } from '../../shared/types.ts';
import { getTodayIso, getTomorrowIso } from '../../client/utils/taskUtils.ts';
import {
  DEFAULT_VIEW_STATE,
  ViewState,
  buildTaskList,
  filterTasks,
  groupTasks,
  sortTasks,
  viewTitle,
  visibleTaskOrder,
} from '../../client/utils/taskView.ts';

const TODAY = '2026-10-22';
const projects: Project[] = [
  { id: 'work', name: 'Work', color: '#6366f1', sortOrder: 2, createdAt: 1, adoEnabled: true },
  { id: 'home', name: 'Home', color: '#10b981', sortOrder: 1, createdAt: 1, adoEnabled: true },
];

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

const view = (patch: Partial<ViewState>): ViewState => ({ ...DEFAULT_VIEW_STATE, ...patch });
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe('taskView', () => {
  const overdue = task({ id: 'overdue', dueDate: '2026-10-01', projectId: 'work' });
  const dueToday = task({ id: 'today', dueDate: TODAY, tags: ['auth'] });
  const later = task({ id: 'later', dueDate: '2026-12-01', priority: 3 });
  const undated = task({ id: 'undated', description: 'Call the bank', priority: 1 });
  const done = task({ id: 'done', status: 'done', completedAt: 5, projectId: 'home' });
  const archived = task({ id: 'archived', status: 'archived', completedAt: 5 });
  const all = [overdue, dueToday, later, undated, done, archived];

  it('filters by smart view, and shows archived tasks only in the Archive view', () => {
    const f = (id: Parameters<typeof view>[0]['nav']) =>
      ids(filterTasks(all, view({ nav: id }), projects, TODAY));

    expect(f({ type: 'smart', id: 'inbox' })).toEqual(['overdue', 'today', 'later', 'undated', 'done']);
    expect(f({ type: 'smart', id: 'today' })).toEqual(['overdue', 'today']);
    expect(f({ type: 'smart', id: 'upcoming' })).toEqual(['later']);
    expect(f({ type: 'smart', id: 'completed' })).toEqual(['done']);
    expect(f({ type: 'smart', id: 'archived' })).toEqual(['archived']);
    expect(f({ type: 'project', id: 'work' })).toEqual(['overdue']);
    expect(f({ type: 'tag', id: 'auth' })).toEqual(['today']);
  });

  it('searches title, description, tags and project name; filters by priority', () => {
    const search = (q: string) => ids(filterTasks(all, view({ search: q }), projects, TODAY));
    expect(search('bank')).toEqual(['undated']); // description
    expect(search('AUTH')).toEqual(['today']); // tag, case-insensitive
    expect(search('work')).toEqual(['overdue']); // project name
    expect(search('task 3')).toEqual(['later']); // title
    expect(search('   ')).toHaveLength(5); // blank search ignored

    expect(ids(filterTasks(all, view({ priority: 3 }), projects, TODAY))).toEqual(['later']);
  });

  it('sorts by each option, falling back to newest first', () => {
    const a = task({ id: 'a', priority: 1, dueDate: '2026-11-02', sortOrder: 2 });
    const b = task({ id: 'b', priority: 3, dueDate: null, sortOrder: 1 });
    const c = task({ id: 'c', priority: 3, dueDate: '2026-11-01', sortOrder: 1 });
    const list = [a, b, c];

    expect(ids(sortTasks(list, 'created'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortTasks(list, 'priority'))).toEqual(['c', 'b', 'a']);
    expect(ids(sortTasks(list, 'dueDate'))).toEqual(['c', 'a', 'b']); // undated last
    expect(ids(sortTasks(list, 'manual'))).toEqual(['c', 'b', 'a']); // tie on 1 -> newest first
    expect(ids(list)).toEqual(['a', 'b', 'c']); // input not mutated
  });

  it('groups into ordered sections', () => {
    const labels = (groupBy: Parameters<typeof groupTasks>[1], list: Task[]) =>
      groupTasks(list, groupBy, projects).map((s) => `${s.label}:${ids(s.tasks).join(',')}`);

    expect(labels('priority', [undated, later, overdue])).toEqual([
      'High:later',
      'Low:undated',
      'No Priority:overdue',
    ]);
    expect(labels('project', [overdue, done, undated])).toEqual([
      'Home:done', // sortOrder 1
      'Work:overdue',
      'No Project:undated',
    ]);
    expect(labels('status', [done, overdue, task({ id: 'wip', status: 'in_progress' })])).toEqual([
      'In Progress:wip',
      'To Do:overdue',
      'Completed:done',
    ]);

    // Due-date groups use the real clock, so build dates relative to it
    const realToday = task({ id: 'rt', dueDate: getTodayIso() });
    const realTomorrow = task({ id: 'rm', dueDate: getTomorrowIso() });
    expect(labels('dueDate', [undated, realTomorrow, realToday, overdue])).toEqual([
      'Overdue:overdue',
      'Today:rt',
      'Tomorrow:rm',
      'No Due Date:undated',
    ]);
  });

  it('builds the rendered list and the visible order', () => {
    const inbox = buildTaskList(all, view({}), projects, TODAY);
    expect(inbox.sections).toHaveLength(1);
    expect(inbox.sections[0].label).toBe('Tasks');
    expect(ids(inbox.completedSection!)).toEqual(['done']);
    expect(visibleTaskOrder(inbox, true)).toEqual(['undated', 'later', 'today', 'overdue', 'done']);
    expect(visibleTaskOrder(inbox, false)).not.toContain('done'); // collapsed

    const completedView = buildTaskList(all, view({ nav: { type: 'smart', id: 'completed' } }), projects, TODAY);
    expect(completedView.sections[0].label).toBe('Completed Tasks');
    expect(completedView.completedSection).toBeNull();

    const byStatus = buildTaskList(all, view({ groupBy: 'status' }), projects, TODAY);
    expect(byStatus.completedSection).toBeNull(); // done tasks are a group instead
    expect(byStatus.sections.map((s) => s.label)).toEqual(['To Do', 'Completed']);

    const archive = buildTaskList(all, view({ nav: { type: 'smart', id: 'archived' } }), projects, TODAY);
    expect(archive.sections[0].label).toBe('Archived Tasks');
    expect(ids(archive.active)).toEqual(['archived']);
  });

  it('titles views', () => {
    expect(viewTitle({ type: 'smart', id: 'today' }, projects)).toBe('Today & Overdue');
    expect(viewTitle({ type: 'project', id: 'home' }, projects)).toBe('Home');
    expect(viewTitle({ type: 'project', id: 'gone' }, projects)).toBe('Project');
    expect(viewTitle({ type: 'tag', id: 'auth' }, projects)).toBe('#auth');
  });
});
