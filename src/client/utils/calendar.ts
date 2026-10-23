import { Task } from '../../shared/types.ts';
import { addDays, addMonthsClamped, parseIsoDate, toIsoDate } from '../../shared/dates.ts';
import { occurrencesBetween } from '../../shared/recurrence.ts';

export type CalendarLayout = 'month' | 'week';
export type WeekStartDay = 0 | 1;

/** A task on a calendar day. Ghosts are future occurrences of a recurring task, never stored. */
export interface CalendarEntry {
  task: Task;
  ghost: boolean;
}

function startOfWeek(date: Date, weekStart: WeekStartDay): Date {
  return addDays(date, -((date.getDay() - weekStart + 7) % 7));
}

/** Every day shown (`YYYY-MM-DD`): whole weeks covering the anchor's month, or the anchor's week. */
export function calendarDays(layout: CalendarLayout, anchor: string, weekStart: WeekStartDay): string[] {
  const date = parseIsoDate(anchor);
  const first = startOfWeek(
    layout === 'week' ? date : new Date(date.getFullYear(), date.getMonth(), 1),
    weekStart
  );
  const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const end = layout === 'week' ? addDays(first, 6) : addDays(startOfWeek(lastOfMonth, weekStart), 6);
  const days: string[] = [];
  for (let d = first; d <= end; d = addDays(d, 1)) days.push(toIsoDate(d));
  return days;
}

/** The anchor one month or week earlier (`direction` -1) or later (+1). */
export function shiftAnchor(layout: CalendarLayout, anchor: string, direction: -1 | 1): string {
  const date = parseIsoDate(anchor);
  return toIsoDate(layout === 'week' ? addDays(date, 7 * direction) : addMonthsClamped(date, direction));
}

/** Entries per day for `days`, from already-filtered tasks. Done tasks sort last, then by priority. */
export function calendarEntries(
  tasks: Task[],
  days: string[],
  showCompleted: boolean
): Map<string, CalendarEntry[]> {
  const byDay = new Map<string, CalendarEntry[]>(days.map((d) => [d, []]));
  const from = days[0];
  const to = days[days.length - 1];

  for (const task of tasks) {
    if (!task.dueDate || (task.status === 'done' && !showCompleted)) continue;
    byDay.get(task.dueDate)?.push({ task, ghost: false });
    // A completed recurring task has already spawned its next occurrence as a real task
    if (task.recurrence && task.status !== 'done' && task.status !== 'archived') {
      for (const day of occurrencesBetween(task.recurrence, task.dueDate, from, to)) {
        byDay.get(day)?.push({ task, ghost: true });
      }
    }
  }

  const rank = (e: CalendarEntry) => (e.task.status === 'done' ? 1 : 0);
  for (const entries of byDay.values()) {
    entries.sort((a, b) => rank(a) - rank(b) || Number(a.ghost) - Number(b.ghost) || b.task.priority - a.task.priority);
  }
  return byDay;
}

/** `October 2026`, or `Oct 19 – Oct 25 2026` for a week. */
export function calendarTitle(layout: CalendarLayout, days: string[], anchor: string): string {
  if (layout === 'month') {
    return parseIsoDate(anchor).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  const fmt = (iso: string) => parseIsoDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(days[0])} – ${fmt(days[6])} ${parseIsoDate(days[6]).getFullYear()}`;
}
