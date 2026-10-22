import { Project, Task, TaskPriority, TaskStatus } from '../../shared/types.ts';

export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; shortLabel: string; badgeClass: string; dotClass: string }
> = {
  0: {
    label: 'No Priority',
    shortLabel: 'None',
    badgeClass:
      'text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800/80 border-zinc-200 dark:border-zinc-700/60',
    dotClass: 'bg-zinc-400',
  },
  1: {
    label: 'Low',
    shortLabel: 'Low',
    badgeClass:
      'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/50 border-sky-200 dark:border-sky-800/60',
    dotClass: 'bg-sky-500',
  },
  2: {
    label: 'Medium',
    shortLabel: 'Med',
    badgeClass:
      'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800/60',
    dotClass: 'bg-amber-500',
  },
  3: {
    label: 'High',
    shortLabel: 'High',
    badgeClass:
      'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/50 border-orange-200 dark:border-orange-800/60',
    dotClass: 'bg-orange-500',
  },
  4: {
    label: 'Urgent',
    shortLabel: 'Urgent',
    badgeClass:
      'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800/60',
    dotClass: 'bg-red-500',
  },
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
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
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function getDueDateInfo(dueDate: string | null): {
  label: string;
  state: DueDateState;
  badgeClass: string;
} {
  if (!dueDate) {
    return {
      label: 'No date',
      state: 'none',
      badgeClass:
        'text-zinc-400 dark:text-zinc-500 border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800',
    };
  }

  const today = getTodayIso();
  const tomorrow = getTomorrowIso();

  if (dueDate < today) {
    return {
      label: `Overdue (${formatShortDate(dueDate)})`,
      state: 'overdue',
      badgeClass:
        'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/50 border-red-200 dark:border-red-800/60',
    };
  }
  if (dueDate === today) {
    return {
      label: 'Today',
      state: 'today',
      badgeClass:
        'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800/60',
    };
  }
  if (dueDate === tomorrow) {
    return {
      label: 'Tomorrow',
      state: 'tomorrow',
      badgeClass:
        'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/50 border-indigo-200 dark:border-indigo-800/60',
    };
  }

  return {
    label: formatShortDate(dueDate),
    state: 'upcoming',
    badgeClass:
      'text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700',
  };
}

export function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length !== 3) return isoDate;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

/**
 * Parses quick-add syntax tokens from a raw task title string:
 * - `!urgent` / `!p4`, `!high` / `!p3`, `!med` / `!medium` / `!p2`, `!low` / `!p1`
 * - `@today`, `@tomorrow`, `@YYYY-MM-DD`
 * - `#projectName` (if matching an existing project name, case-insensitive) or `#tag`
 */
export function parseQuickAddSyntax(
  rawInput: string,
  projects: Project[],
  defaults: {
    priority: TaskPriority;
    projectId: string | null;
    dueDate: string | null;
    tags: string[];
  }
): {
  title: string;
  priority: TaskPriority;
  projectId: string | null;
  dueDate: string | null;
  tags: string[];
} {
  let priority = defaults.priority;
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

    if (lower === '@today') {
      dueDate = getTodayIso();
      continue;
    }

    if (lower === '@tomorrow' || lower === '@tmrw') {
      dueDate = getTomorrowIso();
      continue;
    }

    if (/^@\d{4}-\d{2}-\d{2}$/.test(token)) {
      dueDate = token.slice(1);
      continue;
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

    keptTokens.push(token);
  }

  const finalTitle = keptTokens.join(' ').trim() || rawInput.trim();

  return {
    title: finalTitle,
    priority,
    projectId,
    dueDate,
    tags,
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

  // Archived tasks keep completedAt, so they still count as completions for the day/streak.
  const completionDays = tasks
    .filter((t) => t.completedAt !== null && (t.status === 'done' || t.status === 'archived'))
    .map((t) => formatIsoDateFromTimestamp(t.completedAt!));

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
