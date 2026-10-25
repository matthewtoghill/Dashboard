import React, { useEffect, useRef, useState } from 'react';
import { Timer, Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import {
  PomodoroMode,
  PomodoroState,
  PomodoroDurations,
  MODE_LABELS,
  initialPomodoro,
  remainingMs,
  start,
  pause,
  reset,
  setMode,
  advance,
  setDurations,
  formatClock,
} from '../utils/pomodoro.ts';
import { LABEL_CLASS } from './ui.tsx';

const STORAGE_KEY = 'dashboard_pomodoro';

// Per-browser like the theme; a running timer stores its end time so reloads resume it
const load = (): PomodoroState => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved && typeof saved.remainingMs === 'number' && saved.durations) return saved;
  } catch {
    // Corrupt entry: start fresh
  }
  return initialPomodoro();
};

const notify = (finished: PomodoroMode, next: PomodoroMode) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // Same tag across tabs so several open tabs show one notification
  new Notification(`${MODE_LABELS[finished]} finished`, {
    body: `Up next: ${MODE_LABELS[next]}`,
    tag: 'dashboard-pomodoro',
  });
};

const DURATION_FIELDS: [keyof PomodoroDurations, string][] = [
  ['focus', 'Focus'],
  ['short', 'Short'],
  ['long', 'Long'],
  ['longEvery', 'Rounds'],
];

export const PomodoroTimer: React.FC = () => {
  const [state, setState] = useState(load);
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const running = state.endsAt !== null;
  const left = remainingMs(state, now);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (running && left === 0) {
      const next = advance(state);
      notify(state.mode, next.mode);
      setState(next);
    }
  }, [running, left, state]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [open]);

  const toggleRunning = () => {
    const t = Date.now();
    setNow(t);
    if (running) return setState((s) => pause(s, t));
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    setState((s) => start(s, t));
  };

  const accent =
    state.mode === 'focus' ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400';
  const iconButton =
    'p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Pomodoro timer: ${MODE_LABELS[state.mode]} ${formatClock(left)}${running ? ', running' : ''}`}
        aria-expanded={open}
        title="Pomodoro timer"
        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[13px] font-medium tabular-nums hover:bg-zinc-200/60 dark:hover:bg-zinc-900 transition-colors duration-150 cursor-pointer ${
          running ? accent : 'text-zinc-500 dark:text-zinc-400'
        }`}
      >
        <Timer className="w-4 h-4" />
        {formatClock(left)}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-30">
          <div role="group" aria-label="Timer mode" className="flex gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800">
            {(Object.keys(MODE_LABELS) as PomodoroMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={state.mode === mode}
                onClick={() => setState((s) => setMode(s, mode))}
                className={`flex-1 py-1 rounded-md text-[12px] cursor-pointer ${
                  state.mode === mode
                    ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>

          <div className={`mt-3 text-center text-4xl font-semibold tabular-nums ${accent}`}>{formatClock(left)}</div>
          <div className="mt-1 text-center text-[12px] text-zinc-500">
            Session {state.completedFocus + 1} of {state.durations.longEvery}
          </div>

          <div className="mt-3 flex items-center justify-center gap-1">
            <button type="button" onClick={() => setState(reset)} aria-label="Reset" title="Reset" className={iconButton}>
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={toggleRunning}
              className="h-8 px-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-medium cursor-pointer"
            >
              {running ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {running ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => setState(advance)}
              aria-label="Skip to next"
              title="Skip to next"
              className={iconButton}
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <div className={`${LABEL_CLASS} text-zinc-500`}>Minutes · rounds to long break</div>
            <div className="mt-1.5 grid grid-cols-4 gap-1.5">
              {DURATION_FIELDS.map(([key, label]) => (
                <label key={key} className="flex flex-col gap-0.5 text-[11px] text-zinc-500">
                  {label}
                  <input
                    type="number"
                    min={1}
                    max={key === 'longEvery' ? 12 : 180}
                    value={state.durations[key]}
                    onChange={(e) => {
                      const value = Math.round(Number(e.target.value));
                      if (value >= 1) setState((s) => setDurations(s, { ...s.durations, [key]: value }));
                    }}
                    className="w-full h-7 px-1.5 rounded-md bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-[13px] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500/60"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
