import { Project, Task, TaskEvent, TaskPriority, TaskStatus } from '../../shared/types.ts';
import { addDays, addMonthsClamped, parseIsoDate, toIsoDate } from '../../shared/dates.ts';
import { Recurrence, parseRecurrenceToken } from '../../shared/recurrence.ts';

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; shortLabel: string; badgeClass: string; dotClass: string; textClass: string }
> = {
  0: {
    label: 'No Priority',
    shortLabel: 'None',
    badgeClass:
      'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700/60',
    dotClass: 'bg-zinc-400 dark:bg-zinc-600',
    textClass: 'text-zinc-500',
  },
  1: {
    label: 'Low',
    shortLabel: 'Low',
    badgeClass:
      'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/60',
    dotClass: 'bg-sky-500',
    textClass: 'text-sky-700 dark:text-sky-300',
  },
  2: {
    label: 'Medium',
    shortLabel: 'Med',
    badgeClass:
      'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  3: {
    label: 'High',
    shortLabel: 'High',
    badgeClass:
      'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800/60',
    dotClass: 'bg-orange-500',
    textClass: 'text-orange-700 dark:text-orange-300',
  },
  4: {
    label: 'Urgent',
    shortLabel: 'Urgent',
    badgeClass:
      'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800/60',
    dotClass: 'bg-red-500',
    textClass: 'text-red-700 dark:text-red-300',
  },
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Completed',
  archived: 'Archived',
};

export const PROJECT_COLORS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
];

export function formatIsoDateFromTimestamp(ts: number): string {
  return toIsoDate(new Date(ts));
}

export function getTodayIso(): string {
  return formatIsoDateFromTimestamp(Date.now());
}

export function getTomorrowIso(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatIsoDateFromTimestamp(tomorrow.getTime());
}

export type DueDateState = 'overdue' | 'today' | 'tomorrow' | 'upcoming' | 'none';

/** Label and pill colours for a due date (the due pill in list rows). */
export function getDueDateInfo(dueDate: string | null): {
  label: string;
  state: DueDateState;
  badgeClass: string;
} {
  if (!dueDate) {
    return { label: 'No date', state: 'none', badgeClass: 'text-zinc-400 dark:text-zinc-600' };
  }

  const today = getTodayIso();
  const tomorrow = getTomorrowIso();

  if (dueDate < today) {
    return {
      label: formatShortDate(dueDate),
      state: 'overdue',
      badgeClass: 'text-red-700 dark:text-red-300 bg-red-500/12',
    };
  }
  if (dueDate === today) {
    return {
      label: 'Today',
      state: 'today',
      badgeClass: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12',
    };
  }
  if (dueDate === tomorrow) {
    return {
      label: 'Tomorrow',
      state: 'tomorrow',
      badgeClass: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/15',
    };
  }

  return {
    label: formatDayDate(dueDate),
    state: 'upcoming',
    badgeClass: 'text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800',
  };
}

export function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3) return isoDate;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** `2026-10-27` -> `Tue, Oct 27` */
export function formatDayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** A tag as typed, without surrounding spaces or a leading `#`. */
export const cleanTag = (text: string) => text.trim().replace(/^#/, '');

/** The error's message, or `fallback` for non-Error values. */
export const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

/** `1 task`, `3 tasks` */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `just now`, `5 minutes ago`, `3 hours ago`, `2 days ago` */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return 'just now';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.round(hours / 24), 'day');
}

/** One activity log row, e.g. `Due Tue, Oct 12 → Tue, Oct 19`. */
export function describeTaskEvent(event: TaskEvent, projects: Project[]): string {
  const { from, to } = event;
  const status = (s: string | null) => STATUS_LABELS[s as TaskStatus] ?? s;
  const due = (d: string | null) => (d ? formatDayDate(d) : 'none');
  const priority = (p: string | null) => PRIORITY_CONFIG[Number(p) as TaskPriority]?.label ?? p;
  const project = (id: string | null) =>
    id === null ? 'No project' : (projects.find((p) => p.id === id)?.name ?? 'Deleted project');

  switch (event.kind) {
    case 'created':
      return 'Created';
    case 'status':
      if (from === 'archived') return `Restored to ${status(to)}`;
      if (to === 'done' || to === 'archived') return status(to)!;
      if (from === 'done') return `Reopened as ${status(to)}`;
      return `Status ${status(from)} → ${status(to)}`;
    case 'due':
      if (from === null) return `Due ${due(to)}`;
      if (to === null) return `Due date removed (was ${due(from)})`;
      return `Due ${due(from)} → ${due(to)}`;
    case 'priority':
      return `Priority ${priority(from)} → ${priority(to)}`;
    case 'project':
      return `Project ${project(from)} → ${project(to)}`;
    case 'title':
      return `Renamed “${from}” → “${to}”`;
    case 'subtask_added':
      return `Subtask added: ${to}`;
    case 'subtask_completed':
      return `Subtask completed: ${to}`;
    case 'subtask_reopened':
      return `Subtask reopened: ${to}`;
    case 'session_linked':
      return `Claude session linked: ${to}`;
    case 'session_unlinked':
      return `Claude session unlinked: ${from}`;
  }
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/** Next given weekday strictly after `today` (so `mon` on a Monday is a week away). */
function nextWeekday(today: Date, weekday: number): Date {
  return addDays(today, (weekday - today.getDay() + 7) % 7 || 7);
}

/**
 * Resolves a quick-add date word (without the `@`, case-insensitive) to YYYY-MM-DD in local time:
 * `today`, `tomorrow`/`tmrw`, weekdays (`mon`, `friday`, ...), `next-week` (next Monday),
 * `eom` (end of month), `+3d` / `+2w` / `+1m`, or an ISO date. Returns null if not a date.
 */
export function resolveDateToken(word: string, today: Date = new Date()): string | null {
  const w = word.toLowerCase();
  const iso = (d: Date) => formatIsoDateFromTimestamp(d.getTime());

  if (w === 'today') return iso(today);
  if (w === 'tomorrow' || w === 'tmrw') return iso(addDays(today, 1));
  if (w in WEEKDAYS) return iso(nextWeekday(today, WEEKDAYS[w]));
  if (w === 'next-week') return iso(nextWeekday(today, 1));
  if (w === 'eom') return iso(new Date(today.getFullYear(), today.getMonth() + 1, 0));

  const relative = /^\+(\d{1,3})([dwm])$/.exec(w);
  if (relative) {
    const n = Number(relative[1]);
    const unit = relative[2];
    return iso(unit === 'm' ? addMonthsClamped(today, n) : addDays(today, unit === 'w' ? n * 7 : n));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) {
    const [y, m, d] = w.split('-').map(Number);
    // Reject impossible dates such as 2026-02-31 (Date would roll them over)
    return iso(new Date(y, m - 1, d)) === w ? w : null;
  }
  return null;
}

/**
 * Parses quick-add syntax tokens from a raw task title string:
 * - `!urgent` / `!p4`, `!high` / `!p3`, `!med` / `!medium` / `!p2`, `!low` / `!p1`
 * - `@` dates: see `resolveDateToken` (`@today`, `@fri`, `@+3d`, `@2026-11-01`, ...)
 * - `#projectName` (if matching an existing project name, case-insensitive) or `#tag`
 * - `~` repeats: see `parseRecurrenceToken` (`~daily`, `~weekdays`, `~2w`, `~2w!`, ...)
 * Unrecognised `@words` and `~words` stay in the title.
 */
export function parseQuickAddSyntax(
  rawInput: string,
  projects: Project[],
  defaults: {
    priority: TaskPriority;
    projectId: string | null;
    dueDate: string | null;
    tags: string[];
  },
  today: Date = new Date()
): {
  title: string;
  priority: TaskPriority;
  projectId: string | null;
  dueDate: string | null;
  tags: string[];
  recurrence: Recurrence | null;
} {
  let priority = defaults.priority;
  let recurrence: Recurrence | null = null;
  let projectId = defaults.projectId;
  let dueDate = defaults.dueDate;
  const tags = [...defaults.tags];

  const priorityMap: Record<string, TaskPriority> = {
    '!urgent': 4,
    '!p4': 4,
    '!high': 3,
    '!p3': 3,
    '!medium': 2,
    '!med': 2,
    '!p2': 2,
    '!low': 1,
    '!p1': 1,
    '!none': 0,
    '!p0': 0,
  };

  const tokens = rawInput.trim().split(/\s+/);
  const keptTokens: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower in priorityMap) {
      priority = priorityMap[lower];
      continue;
    }

    if (token.startsWith('@') && token.length > 1) {
      const resolved = resolveDateToken(token.slice(1), today);
      if (resolved) {
        dueDate = resolved;
        continue;
      }
    }

    if (token.startsWith('#') && token.length > 1) {
      const value = token.slice(1);
      const matchedProject = projects.find(
        (p) => p.name.toLowerCase() === value.toLowerCase()
      );
      if (matchedProject) {
        projectId = matchedProject.id;
      } else if (!tags.includes(value)) {
        tags.push(value);
      }
      continue;
    }

    if (token.startsWith('~') && token.length > 1) {
      const rule = parseRecurrenceToken(token.slice(1));
      if (rule) {
        recurrence = rule;
        continue;
      }
    }

    keptTokens.push(token);
  }

  const finalTitle = keptTokens.join(' ').trim() || rawInput.trim();

  return {
    title: finalTitle,
    priority,
    projectId,
    dueDate,
    tags,
    recurrence,
  };
}

/**
 * New sortOrder for a task dropped at `targetIndex` of `orders` (the other tasks' ascending
 * sortOrders, moved task excluded). Returns null when there is no gap left between the
 * neighbours (duplicate orders or exhausted float precision): the caller must renumber.
 */
export function sortOrderForMove(orders: number[], targetIndex: number): number | null {
  if (orders.length === 0) return 0;
  if (targetIndex <= 0) return orders[0] - 1;
  if (targetIndex >= orders.length) return orders[orders.length - 1] + 1;
  const before = orders[targetIndex - 1];
  const after = orders[targetIndex];
  const mid = (before + after) / 2;
  return mid > before && mid < after ? mid : null;
}

/** Local YYYY-MM-DD of each completion. Archived tasks keep completedAt, so they still count. */
function completionDates(tasks: Task[]): string[] {
  return tasks
    .filter((t) => t.completedAt !== null && (t.status === 'done' || t.status === 'archived'))
    .map((t) => formatIsoDateFromTimestamp(t.completedAt!));
}

/** Completions per day for the `days` days ending on `today` (YYYY-MM-DD), oldest first, zeros included. */
export function completionsByDay(
  tasks: Task[],
  days = 14,
  today: string = getTodayIso()
): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const day of completionDates(tasks)) counts.set(day, (counts.get(day) ?? 0) + 1);
  const end = parseIsoDate(today);
  return Array.from({ length: days }, (_, i) => {
    const date = toIsoDate(addDays(end, i - days + 1));
    return { date, count: counts.get(date) ?? 0 };
  });
}

export interface ProjectProgressRow {
  projectId: string | null;
  name: string;
  color: string | null;
  done: number;
  total: number;
}

/** Done/total per project over non-archived tasks, plus "No project" when it has tasks; most open first. */
export function projectProgress(tasks: Task[], projects: Project[]): ProjectProgressRow[] {
  const rows = new Map<string | null, ProjectProgressRow>(
    [...projects]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => [p.id, { projectId: p.id, name: p.name, color: p.color, done: 0, total: 0 }])
  );
  const none: ProjectProgressRow = { projectId: null, name: 'No project', color: null, done: 0, total: 0 };
  for (const task of tasks) {
    if (task.status === 'archived') continue;
    const row = (task.projectId !== null && rows.get(task.projectId)) || none;
    row.total++;
    if (task.status === 'done') row.done++;
  }
  const result = [...rows.values()];
  if (none.total > 0) result.push(none);
  return result.sort((a, b) => b.total - b.done - (a.total - a.done));
}

const isOpen = (t: Task) => t.status === 'todo' || t.status === 'in_progress';

/** Whole days an on hold task has been held; 0 when not on hold. */
export function heldDays(task: Task, now = Date.now()): number {
  if (task.status !== 'on_hold' || task.heldSince === null) return 0;
  return Math.floor((now - task.heldSince) / 86_400_000);
}

/** On hold for `chaseDays` or more: time to follow up. */
export const needsChase = (task: Task, chaseDays: number, now = Date.now()) =>
  task.status === 'on_hold' && heldDays(task, now) >= chaseDays;
const byPriorityThenOrder = (a: Task, b: Task) => b.priority - a.priority || a.sortOrder - b.sortOrder;

export interface AgendaGroup {
  /** Null for the overdue group. */
  date: string | null;
  tasks: Task[];
}

/** Open overdue tasks (oldest due first), then one group per day from today for `days` days; empty days are left out. */
export function agendaGroups(tasks: Task[], days = 7, today: string = getTodayIso()): AgendaGroup[] {
  const end = toIsoDate(addDays(parseIsoDate(today), days - 1));
  const open = tasks.filter((t) => isOpen(t) && t.dueDate !== null && t.dueDate <= end);
  const overdue = open
    .filter((t) => t.dueDate! < today)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || byPriorityThenOrder(a, b));
  const byDay = new Map<string, Task[]>();
  for (const t of open) if (t.dueDate! >= today) byDay.set(t.dueDate!, [...(byDay.get(t.dueDate!) ?? []), t]);
  const groups: AgendaGroup[] = [...byDay.keys()]
    .sort()
    .map((date) => ({ date, tasks: byDay.get(date)!.sort(byPriorityThenOrder) }));
  return overdue.length > 0 ? [{ date: null, tasks: overdue }, ...groups] : groups;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** To-do tasks untouched for `days` days, oldest first; tasks due today or later are scheduled, not stale. */
export function staleTasks(
  tasks: Task[],
  days: number,
  now = Date.now(),
  today: string = formatIsoDateFromTimestamp(now)
): Task[] {
  return tasks
    .filter(
      (t) =>
        t.status === 'todo' &&
        t.updatedAt <= now - days * DAY_MS &&
        (t.dueDate === null || t.dueDate < today)
    )
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

export interface AdoSummary {
  openWorkItems: number;
  openPullRequests: number;
  /** When the newest Azure DevOps link was made, or null when there are none. */
  lastImportAt: number | null;
}

export function adoSummary(tasks: Task[]): AdoSummary {
  const summary: AdoSummary = { openWorkItems: 0, openPullRequests: 0, lastImportAt: null };
  for (const t of tasks) {
    for (const link of t.adoLinks) {
      summary.lastImportAt = Math.max(summary.lastImportAt ?? 0, link.linkedAt);
      if (!isOpen(t)) continue;
      if (link.externalId.startsWith('pr/')) summary.openPullRequests++;
      else if (link.externalId.startsWith('workitem/')) summary.openWorkItems++;
    }
  }
  return summary;
}

export interface DashboardStats {
  totalActive: number;
  totalCompleted: number;
  completedToday: number;
  overdueCount: number;
  dueTodayCount: number;
  completionRate: number;
  streakDays: number;
}

export function computeDashboardStats(tasks: Task[]): DashboardStats {
  const today = getTodayIso();
  const active = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived');
  const completed = tasks.filter((t) => t.status === 'done');

  const completionDays = completionDates(tasks);

  const completedToday = completionDays.filter((day) => day === today).length;

  const overdueCount = active.filter(
    (t) => t.dueDate !== null && t.dueDate < today
  ).length;

  const dueTodayCount = active.filter((t) => t.dueDate === today).length;

  const totalNonArchived = active.length + completed.length;
  const completionRate =
    totalNonArchived > 0 ? Math.round((completed.length / totalNonArchived) * 100) : 0;

  // Calculate consecutive day completion streak
  const completedDates = new Set(completionDays);

  let streakDays = 0;
  const cursor = new Date();
  const todayStr = formatIsoDateFromTimestamp(cursor.getTime());

  // If nothing completed today yet, check if streak was alive yesterday
  if (!completedDates.has(todayStr)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (completedDates.has(formatIsoDateFromTimestamp(cursor.getTime()))) {
    streakDays++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    totalActive: active.length,
    totalCompleted: completed.length,
    completedToday,
    overdueCount,
    dueTodayCount,
    completionRate,
    streakDays,
  };
}

export function tasksToCsv(tasks: Task[], projects: Project[]): string {
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const headers = [
    'ID',
    'Title',
    'Status',
    'Priority',
    'Project',
    'Tags',
    'Due Date',
    'Subtasks Completed',
    'Created At',
    'Completed At',
  ];

  const escapeCsv = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const rows = tasks.map((t) => {
    const subs = t.subtasks ?? [];
    const doneSubs = subs.filter((s) => s.isCompleted).length;
    return [
      t.id,
      t.title,
      t.status,
      PRIORITY_CONFIG[t.priority].label,
      t.projectId ? (projectMap.get(t.projectId) ?? '') : '',
      t.tags.join(';'),
      t.dueDate ?? '',
      subs.length > 0 ? `${doneSubs}/${subs.length}` : '',
      new Date(t.createdAt).toISOString(),
      t.completedAt ? new Date(t.completedAt).toISOString() : '',
    ].map((cell) => escapeCsv(String(cell))).join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}
