import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, parseIsoDate, toIsoDate } from '../../shared/dates.ts';
import { fetchSettings } from '../api.ts';
import { calendarDays, calendarTitle, shiftAnchor } from '../utils/calendar.ts';
import { formatDayDate, getTodayIso, getTomorrowIso } from '../utils/taskUtils.ts';

const quickButtonClass =
  'text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-primary-50 dark:hover:bg-primary-950/50 text-zinc-700 dark:text-zinc-200 cursor-pointer';
const navButtonClass =
  'p-1 rounded text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer';

/** Quick picks, a month grid and a clear button. `onChange(null)` clears the date. */
export const DatePanel: React.FC<{
  value: string | null;
  onChange: (date: string | null) => void;
}> = ({ value, onChange }) => {
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const weekStart = settingsData?.settings.weekStartDay ?? 1;
  const today = getTodayIso();
  const [anchor, setAnchor] = useState(value ?? today);
  const days = useMemo(() => calendarDays('month', anchor, weekStart), [anchor, weekStart]);
  const month = parseIsoDate(anchor).getMonth();
  const nextWeek = toIsoDate(addDays(parseIsoDate(today), 7));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1">
        <button type="button" onClick={() => onChange(today)} className={quickButtonClass}>
          Today
        </button>
        <button type="button" onClick={() => onChange(getTomorrowIso())} className={quickButtonClass}>
          Tomorrow
        </button>
        <button type="button" onClick={() => onChange(nextWeek)} className={quickButtonClass}>
          +1 week
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setAnchor(shiftAnchor('month', anchor, -1))}
          aria-label="Previous month"
          className={navButtonClass}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          {calendarTitle('month', days, anchor)}
        </span>
        <button
          type="button"
          onClick={() => setAnchor(shiftAnchor('month', anchor, 1))}
          aria-label="Next month"
          className={navButtonClass}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {days.slice(0, 7).map((day) => (
          <span key={day} className="text-[10px] font-semibold text-zinc-400">
            {parseIsoDate(day).toLocaleDateString('en-US', { weekday: 'narrow' })}
          </span>
        ))}
        {days.map((day) => {
          const selected = day === value;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onChange(day)}
              aria-label={formatDayDate(day)}
              aria-pressed={selected}
              className={`h-7 text-xs rounded-md cursor-pointer transition-colors ${
                selected
                  ? 'bg-primary-600 text-white font-semibold'
                  : day === today
                    ? 'text-primary-600 dark:text-primary-400 font-semibold ring-1 ring-inset ring-primary-300 dark:ring-primary-700 hover:bg-primary-50 dark:hover:bg-primary-950/50'
                    : parseIsoDate(day).getMonth() === month
                      ? 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      : 'text-zinc-300 dark:text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {parseIsoDate(day).getDate()}
            </button>
          );
        })}
      </div>

      {value && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="w-full text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
        >
          Clear date
        </button>
      )}
    </div>
  );
};

/** Wraps the trigger in a popover holding a DatePanel; closes on pick, outside click or Escape. */
export const DatePopover: React.FC<{
  value: string | null;
  onChange: (date: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}> = ({ value, onChange, open, onOpenChange, trigger, className = 'relative', align = 'left' }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className={className}>
      {trigger}
      {open && (
        <div
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-60 p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-30`}
        >
          <DatePanel
            value={value}
            onChange={(date) => {
              onChange(date);
              onOpenChange(false);
            }}
          />
        </div>
      )}
    </div>
  );
};

/** Drop-in for `<input type="date">`: a button showing the date that opens a DatePopover. */
export const DateInput: React.FC<{
  value: string | null;
  onChange: (date: string | null) => void;
  ariaLabel: string;
  className?: string;
  /** Shows an inline clear button when a date is set. */
  clearable?: boolean;
}> = ({ value, onChange, ariaLabel, className, clearable }) => {
  const [open, setOpen] = useState(false);
  return (
    <DatePopover
      value={value}
      onChange={onChange}
      open={open}
      onOpenChange={setOpen}
      className="relative flex items-center gap-1 min-w-0"
      trigger={
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={ariaLabel}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={className}
          >
            {value ? formatDayDate(value) : 'No date'}
          </button>
          {clearable && value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={`Clear ${ariaLabel.toLowerCase()}`}
              className="text-zinc-400 hover:text-zinc-600 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </>
      }
    />
  );
};
