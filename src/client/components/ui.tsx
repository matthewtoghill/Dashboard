import React from 'react';

/** Shared look of the redesign ("Calm Today"): small pieces several screens use. */

export const KBD_CLASS =
  'px-1.5 py-0.5 rounded font-mono text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400';

/** Uppercase group label: "OVERDUE", "TODAY 3", "PROJECTS". */
export const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.06em]';

/** Small row badge (subtasks, notes, PR, ...). */
export const BADGE_CLASS = 'inline-flex items-center gap-1 px-1.5 py-px rounded text-[11px] shrink-0';
export const NEUTRAL_BADGE_CLASS = `${BADGE_CLASS} bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300`;

/** Round colour dot for projects; grey ring when there is no colour. */
export const Dot: React.FC<{ color?: string | null; size?: number; className?: string }> = ({
  color,
  size = 7,
  className = '',
}) => (
  <span
    aria-hidden
    className={`shrink-0 rounded-full ${color ? '' : 'border border-zinc-400 dark:border-zinc-600'} ${className}`}
    style={{ width: size, height: size, ...(color ? { backgroundColor: color } : {}) }}
  />
);

/** Section heading with a right-hand meta line and a bottom rule, no card around it. */
export const SectionHeader: React.FC<{ title: React.ReactNode; meta?: React.ReactNode; id?: string }> = ({
  title,
  meta,
  id,
}) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-2.5">
    <h3 id={id} className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
      {title}
    </h3>
    {meta !== undefined && <span className="text-xs text-zinc-500">{meta}</span>}
  </div>
);

/** 1px vertical divider for inline stat strips. */
export const Divider: React.FC<{ height?: number }> = ({ height = 14 }) => (
  <span aria-hidden className="w-px bg-zinc-200 dark:bg-zinc-800" style={{ height }} />
);
