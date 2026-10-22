/**
 * Calendar-date helpers on local time, shared by client and server (which run on the same
 * machine). Dates are exchanged as `YYYY-MM-DD` strings.
 */

export function toIsoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `YYYY-MM-DD` -> local midnight. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Adds calendar months, clamping to the target month's last day (31 Jan + 1 = 28/29 Feb). */
export function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

/** Steps forward `count` Monday-to-Friday days. */
export function addWeekdays(date: Date, count: number): Date {
  let d = new Date(date);
  for (let added = 0; added < count; ) {
    d = addDays(d, 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}
