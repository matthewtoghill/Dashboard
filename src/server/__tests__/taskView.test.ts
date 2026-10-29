import { describe, it, expect } from 'vitest';
import { Project, Task } from '../../shared/types.ts';
import { getTodayIso, getTomorrowIso, heldDays, needsChase } from '../../client/utils/taskUtils.ts';
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
    holdReason: null,
    heldSince: null,
    adoLinks: [],
    sourceUrls: [],
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

  it('sorts by oldest, recently updated, title and longest on hold', () => {
    const a = task({ id: 'a', title: 'beta 10', updatedAt: 50, heldSince: 200 });
    const b = task({ id: 'b', title: 'Alpha', updatedAt: 90, heldSince: null });
    const c = task({ id: 'c', title: 'beta 9', updatedAt: 70, heldSince: 100 });
    const list = [a, b, c];

    expect(ids(sortTasks(list, 'oldest'))).toEqual(['a', 'b', 'c']);
    expect(ids(sortTasks(list, 'updated'))).toEqual(['b', 'c', 'a']);
    expect(ids(sortTasks(list, 'title'))).toEqual(['b', 'c', 'a']); // case-insensitive, numeric-aware
    expect(ids(sortTasks(list, 'heldSince'))).toEqual(['c', 'a', 'b']); // not on hold last
  });

  it('groups by ADO link and age', () => {
    const link = (externalId: string) => ({
      externalId, url: 'https://x.test', title: '', type: '', state: '', linkedAt: 1,
    });
    const labels = (groupBy: 'adoLink' | 'age', list: Task[]) =>
      groupTasks(list, groupBy, projects, TODAY).map((s) => `${s.label}:${ids(s.tasks).join(',')}`);

    expect(
      labels('adoLink', [
        task({ id: 'none' }),
        task({ id: 'pr', adoLinks: [link('pr/1')] }),
        task({ id: 'both', adoLinks: [link('pr/2'), link('workitem/3')] }),
      ])
    ).toEqual(['Work item:both', 'Pull request:pr', 'Not linked:none']);

    const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime();
    expect(
      labels('age', [
        task({ id: 'old', createdAt: at('2026-08-01') }),
        task({ id: 'new', createdAt: at(TODAY) }),
        task({ id: 'wk', createdAt: at('2026-10-18') }),
        task({ id: 'mo', createdAt: at('2026-10-01') }),
      ])
    ).toEqual(['Added today:new', 'Last 7 days:wk', 'Last 30 days:mo', 'Older:old']);
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

    // Due-date groups default to the real clock, so build dates relative to it
    const realToday = task({ id: 'rt', dueDate: getTodayIso() });
    const realTomorrow = task({ id: 'rm', dueDate: getTomorrowIso() });
    expect(labels('dueDate', [undated, realTomorrow, realToday, overdue])).toEqual([
      'Overdue:overdue',
      'Today:rt',
      'Tomorrow:rm',
      'No date:undated',
    ]);

    // This week runs to 7 days out; later than that is its own bucket
    const byDue = (list: Task[]) =>
      groupTasks(list, 'dueDate', projects, TODAY).map((s) => `${s.key}:${ids(s.tasks).join(',')}`);
    expect(
      byDue([
        task({ id: 'd8', dueDate: '2026-10-30' }),
        task({ id: 'd7', dueDate: '2026-10-29' }),
        task({ id: 'd2', dueDate: '2026-10-25' }),
        task({ id: 'd1', dueDate: '2026-10-23' }),
      ])
    ).toEqual(['due-tomorrow:d1', 'due-week:d7,d2', 'due-later:d8']);
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

  it('sinks on hold tasks in lists, and lists them oldest hold first in On Hold', () => {
    const DAY = 86_400_000;
    const now = Date.now();
    const held = [
      task({ id: 'recent', status: 'on_hold', heldSince: now - 2 * DAY, createdAt: 100 }),
      task({ id: 'oldest', status: 'on_hold', heldSince: now - 9 * DAY, createdAt: 50 }),
      task({ id: 'open', createdAt: 1 }),
    ];
    expect(ids(buildTaskList(held, view({}), projects, TODAY).active)).toEqual(['open', 'recent', 'oldest']);
    const onHold = buildTaskList(held, view({ nav: { type: 'smart', id: 'on_hold' } }), projects, TODAY);
    expect(ids(onHold.active)).toEqual(['oldest', 'recent']);
    expect(heldDays(held[1], now)).toBe(9);
    expect(held.map((t) => needsChase(t, 7, now))).toEqual([false, true, false]);
  });

  it('titles views', () => {
    expect(viewTitle({ type: 'smart', id: 'today' }, projects)).toBe('Today & Overdue');
    expect(viewTitle({ type: 'project', id: 'home' }, projects)).toBe('Home');
    expect(viewTitle({ type: 'project', id: 'gone' }, projects)).toBe('Project');
    expect(viewTitle({ type: 'tag', id: 'auth' }, projects)).toBe('#auth');
  });
});
