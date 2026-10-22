import { z } from 'zod';
import { addDays, addMonthsClamped, addWeekdays, parseIsoDate, toIsoDate } from './dates.ts';

/**
 * How a task repeats. `from: 'due'` keeps a fixed schedule based on the due date;
 * `from: 'completion'` schedules the next one relative to the day it was completed.
 */
export const RecurrenceSchema = z.object({
  every: z.number().int().min(1).max(365),
  unit: z.enum(['day', 'week', 'month', 'weekday']),
  from: z.enum(['due', 'completion']),
});
export type Recurrence = z.infer<typeof RecurrenceSchema>;

function step(rule: Recurrence, date: Date): Date {
  switch (rule.unit) {
    case 'day':
      return addDays(date, rule.every);
    case 'week':
      return addDays(date, rule.every * 7);
    case 'month':
      // ponytail: steps from the previous (possibly clamped) due date, so "monthly on the 31st"
      // settles on the 28th after February; store an anchor day if that matters.
      return addMonthsClamped(date, rule.every);
    case 'weekday':
      return addWeekdays(date, rule.every);
  }
}

/**
 * Due date for the occurrence after one completed `today` (all `YYYY-MM-DD`).
 * Fixed schedules skip ahead past today, so an overdue task doesn't spawn an overdue copy.
 */
export function nextOccurrence(rule: Recurrence, dueDate: string | null, today: string): string {
  const todayDate = parseIsoDate(today);
  if (rule.from === 'completion' || dueDate === null) return toIsoDate(step(rule, todayDate));

  let next = step(rule, parseIsoDate(dueDate));
  for (let i = 0; next <= todayDate && i < 10_000; i++) next = step(rule, next);
  return toIsoDate(next);
}

const UNIT_NAMES = { day: 'day', week: 'week', month: 'month', weekday: 'weekday' } as const;
const SINGLE = { day: 'Daily', week: 'Weekly', month: 'Monthly', weekday: 'Every weekday' } as const;

/** "Weekly", "Every 2 weeks", "Every weekday (after completion)" */
export function describeRecurrence(rule: Recurrence): string {
  const base =
    rule.every === 1 ? SINGLE[rule.unit] : `Every ${rule.every} ${UNIT_NAMES[rule.unit]}s`;
  return rule.from === 'completion' ? `${base} (after completion)` : base;
}

/**
 * Quick-add token without its `~`: `daily`, `weekly`, `monthly`, `weekdays`, `3d`, `2w`, `1m`.
 * A trailing `!` repeats from completion (`2w!`). Returns null if not a recurrence.
 */
export function parseRecurrenceToken(word: string): Recurrence | null {
  const match = /^(?:(daily|weekly|monthly|weekdays?)|(\d{1,3})([dwm]))(!)?$/i.exec(word);
  if (!match) return null;
  const [, named, count, letter, bang] = match;
  const from = bang ? 'completion' : 'due';

  if (named) {
    const unit = ({ daily: 'day', weekly: 'week', monthly: 'month' } as const)[
      named.toLowerCase() as 'daily' | 'weekly' | 'monthly'
    ];
    return { every: 1, unit: unit ?? 'weekday', from };
  }
  const every = Number(count);
  if (every < 1) return null;
  const unit = ({ d: 'day', w: 'week', m: 'month' } as const)[
    letter.toLowerCase() as 'd' | 'w' | 'm'
  ];
  return { every, unit, from };
}
