import React, { useState } from 'react';
import { X } from 'lucide-react';

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

const PANEL_MIN_WIDTH = 300;
// Leave the main view at least 400px
const clampPanelWidth = (w: number) => Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(w, window.innerWidth - 400)));

/**
 * Right-hand panel docked beside the main view, with a title bar and a resize handle on its
 * left edge. Width is remembered per browser under `widthKey`.
 */
export const DockedPanel: React.FC<{
  title: string;
  /** Rendered before the title; give it its own colour class. */
  icon?: React.ReactNode;
  widthKey: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, icon, widthKey, onClose, children }) => {
  const [width, setWidth] = useState(() => Number(localStorage.getItem(widthKey)) || 380);
  const saveWidth = (w: number) => localStorage.setItem(widthKey, String(w));

  return (
    <aside
      aria-label={title}
      style={{ width }}
      className="relative shrink-0 max-w-full h-full flex flex-col border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
    >
      {/* Resize handle: drag, or focus and use Left/Right arrows */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${title.toLowerCase()} panel`}
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN_WIDTH}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            setWidth(clampPanelWidth(window.innerWidth - e.clientX));
          }
        }}
        onPointerUp={() => saveWidth(width)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const next = clampPanelWidth(width + (e.key === 'ArrowLeft' ? 32 : -32));
          setWidth(next);
          saveWidth(next);
        }}
        className="absolute inset-y-0 left-0 w-1.5 z-10 cursor-col-resize touch-none focus:outline-none group/resize"
      >
        <div className="mx-auto h-full w-0.5 bg-transparent group-hover/resize:bg-primary-500/60 group-focus-visible/resize:bg-primary-500 group-active/resize:bg-primary-500 transition-colors" />
      </div>

      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
        <h2 className="min-w-0 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {icon}
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          title={`Close ${title.toLowerCase()}`}
          className="p-1.5 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {children}
    </aside>
  );
};
