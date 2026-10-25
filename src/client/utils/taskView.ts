import { z } from 'zod';
import {
  ActiveNavigationSchema,
  Project,
  SmartViewIdSchema,
  Task,
  ViewStateSchema,
} from '../../shared/types.ts';
import { PRIORITY_CONFIG, STATUS_LABELS, getTodayIso } from './taskUtils.ts';
import { addDays, parseIsoDate, toIsoDate } from '../../shared/dates.ts';

export type SmartViewId = z.infer<typeof SmartViewIdSchema>;
export type ActiveNavigation = z.infer<typeof ActiveNavigationSchema>;

/** Everything that decides which tasks the list shows and how. Saved views store exactly this. */
export type ViewState = z.infer<typeof ViewStateSchema>;
export type GroupByOption = ViewState['groupBy'];
export type SortByOption = ViewState['sortBy'];
export type PriorityFilter = ViewState['priority'];

export const DEFAULT_VIEW_STATE: ViewState = {
  nav: { type: 'smart', id: 'inbox' },
  search: '',
  priority: 'all',
  groupBy: 'none',
  sortBy: 'created',
  layout: 'list',
};

export interface TaskSection {
  key: string;
  label: string;
  tasks: Task[];
}

const isSmart = (nav: ActiveNavigation, id: SmartViewId) => nav.type === 'smart' && nav.id === id;

/** Applies the view's navigation, priority filter and search. `today` is a YYYY-MM-DD string. */
export function filterTasks(
  tasks: Task[],
  view: Pick<ViewState, 'nav' | 'search' | 'priority'>,
  projects: Project[],
  today: string
): Task[] {
  const { nav, priority } = view;
  const isArchiveView = isSmart(nav, 'archived');
  const q = view.search.trim().toLowerCase();

  return tasks.filter((task) => {
    // Archived tasks appear only in the Archive view, and only they do
    if ((task.status === 'archived') !== isArchiveView) return false;

    if (nav.type === 'smart') {
      if (nav.id === 'today' && (task.dueDate === null || task.dueDate > today)) return false;
      if (nav.id === 'upcoming' && (task.dueDate === null || task.dueDate <= today)) return false;
      if (nav.id === 'completed' && task.status !== 'done') return false;
    } else if (nav.type === 'project') {
      if (task.projectId !== nav.id) return false;
    } else if (!task.tags.includes(nav.id)) {
      return false;
    }

    if (priority !== 'all' && task.priority !== priority) return false;

    if (q) {
      const projectName = projects.find((p) => p.id === task.projectId)?.name.toLowerCase();
      const matches =
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        task.tags.some((t) => t.toLowerCase().includes(q)) ||
        Boolean(projectName?.includes(q));
      if (!matches) return false;
    }

    return true;
  });
}

/** Returns a sorted copy. Ties (and the 'created' option) fall back to newest first. */
export function sortTasks(tasks: Task[], sortBy: SortByOption): Task[] {
  return [...tasks].sort((a, b) => {
    if (sortBy === 'priority') {
      if (b.priority !== a.priority) return b.priority - a.priority;
    } else if (sortBy === 'dueDate') {
      if (a.dueDate && b.dueDate) {
        const cmp = a.dueDate.localeCompare(b.dueDate);
        if (cmp !== 0) return cmp;
      } else if (a.dueDate && !b.dueDate) {
        return -1;
      } else if (!a.dueDate && b.dueDate) {
        return 1;
      }
    } else if (sortBy === 'manual') {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    }
    return b.createdAt - a.createdAt;
  });
}

/** Due-date buckets, in order. `later` (over 7 days out) is collapsed by default in the list. */
export const DUE_BUCKETS = {
  overdue: { label: 'Overdue', order: 1 },
  today: { label: 'Today', order: 2 },
  tomorrow: { label: 'Tomorrow', order: 3 },
  week: { label: 'This week', order: 4 },
  later: { label: 'Later', order: 5 },
  none: { label: 'No date', order: 6 },
} as const;
export type DueBucket = keyof typeof DUE_BUCKETS;

export function dueBucket(dueDate: string | null, today: string): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  const day = parseIsoDate(today);
  if (dueDate === toIsoDate(addDays(day, 1))) return 'tomorrow';
  return dueDate <= toIsoDate(addDays(day, 7)) ? 'week' : 'later';
}

const STATUS_ORDER = { in_progress: 1, todo: 2, done: 3, archived: 4 } as const;

/** Splits already-sorted tasks into ordered sections, keeping their order within each. */
export function groupTasks(
  tasks: Task[],
  groupBy: Exclude<GroupByOption, 'none'>,
  projects: Project[],
  today: string = getTodayIso()
): TaskSection[] {
  const map = new Map<string, { label: string; order: number; tasks: Task[] }>();

  for (const task of tasks) {
    let key: string;
    let label: string;
    let order: number;

    if (groupBy === 'priority') {
      key = `p-${task.priority}`;
      label = PRIORITY_CONFIG[task.priority].label;
      order = 10 - task.priority; // Urgent first
    } else if (groupBy === 'project') {
      const proj = projects.find((p) => p.id === task.projectId);
      key = proj ? `proj-${proj.id}` : 'proj-none';
      label = proj ? proj.name : 'No Project';
      order = proj ? proj.sortOrder : Number.MAX_SAFE_INTEGER;
    } else if (groupBy === 'dueDate') {
      const bucket = dueBucket(task.dueDate, today);
      key = `due-${bucket}`;
      ({ label, order } = DUE_BUCKETS[bucket]);
    } else {
      key = `status-${task.status}`;
      label = STATUS_LABELS[task.status];
      order = STATUS_ORDER[task.status];
    }

    const existing = map.get(key);
    if (existing) {
      existing.tasks.push(task);
    } else {
      map.set(key, { label, order, tasks: [task] });
    }
  }

  return Array.from(map.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, { label, tasks: sectionTasks }]) => ({ key, label, tasks: sectionTasks }));
}

export interface TaskListModel {
  /** Tasks matching the view, unsorted. */
  filtered: Task[];
  /** Sorted matching tasks that are not done (in the Archive view: the archived tasks). */
  active: Task[];
  /** Sorted matching done tasks. */
  completed: Task[];
  /** The main list, as rendered. */
  sections: TaskSection[];
  /** The collapsible "Completed" list under the main one, or null when the view has none. */
  completedSection: Task[] | null;
}

/** Everything the task list renders for a view, in render order. */
export function buildTaskList(
  tasks: Task[],
  view: ViewState,
  projects: Project[],
  today: string
): TaskListModel {
  const filtered = filterTasks(tasks, view, projects, today);
  const active = sortTasks(
    filtered.filter((t) => t.status !== 'done'),
    view.sortBy
  );
  const completed = sortTasks(
    filtered.filter((t) => t.status === 'done'),
    view.sortBy
  );

  const isCompletedView = isSmart(view.nav, 'completed');
  const source = isCompletedView
    ? completed
    : view.groupBy === 'status'
    ? sortTasks(filtered, view.sortBy)
    : active;

  const sections =
    view.groupBy === 'none'
      ? [
          {
            key: 'all',
            label: isCompletedView
              ? 'Completed Tasks'
              : isSmart(view.nav, 'archived')
              ? 'Archived Tasks'
              : 'Tasks',
            tasks: source,
          },
        ]
      : groupTasks(source, view.groupBy, projects, today);

  const completedSection =
    !isCompletedView && view.groupBy !== 'status' && completed.length > 0 ? completed : null;

  return { filtered, active, completed, sections, completedSection };
}

/** Task ids in the order they appear on screen (for keyboard navigation). */
export function visibleTaskOrder(model: TaskListModel, showCompleted: boolean): string[] {
  const ids = model.sections.flatMap((s) => s.tasks.map((t) => t.id));
  if (model.completedSection && showCompleted) {
    ids.push(...model.completedSection.map((t) => t.id));
  }
  return ids;
}

const SMART_VIEW_TITLES: Record<SmartViewId, string> = {
  overview: 'Home',
  inbox: 'All Active',
  today: 'Today & Overdue',
  upcoming: 'Upcoming',
  completed: 'Completed',
  archived: 'Archive',
};

export function viewTitle(nav: ActiveNavigation, projects: Project[]): string {
  if (nav.type === 'smart') return SMART_VIEW_TITLES[nav.id];
  if (nav.type === 'project') return projects.find((p) => p.id === nav.id)?.name ?? 'Project';
  return `#${nav.id}`;
}

/** The number shown beside a view: its done tasks in Completed, otherwise its not-done tasks. */
export function viewTaskCount(
  tasks: Task[],
  view: ViewState,
  projects: Project[],
  today: string
): number {
  const isCompleted = isSmart(view.nav, 'completed');
  return filterTasks(tasks, view, projects, today).filter(
    (t) => isCompleted || t.status !== 'done'
  ).length;
}

export function sameView(a: ViewState, b: ViewState): boolean {
  return (
    a.nav.type === b.nav.type &&
    a.nav.id === b.nav.id &&
    a.search === b.search &&
    a.priority === b.priority &&
    a.groupBy === b.groupBy &&
    a.sortBy === b.sortBy &&
    a.layout === b.layout
  );
}

/**
 * A saved view as it can be applied now. If its project was deleted, or no task carries its tag
 * any more, its filters apply on top of All Active and `notice` says why.
 */
export function resolveSavedView(
  view: ViewState,
  projects: Project[],
  tasks: Task[]
): { view: ViewState; notice: string | null } {
  const { nav } = view;
  const missing =
    nav.type === 'project' && !projects.some((p) => p.id === nav.id)
      ? 'Its project no longer exists'
      : nav.type === 'tag' && !tasks.some((t) => t.tags.includes(nav.id))
      ? `No tasks are tagged #${nav.id} any more`
      : null;
  return missing
    ? { view: { ...view, nav: { type: 'smart', id: 'inbox' } }, notice: `${missing}, so its filters are shown on All Active.` }
    : { view, notice: null };
}
