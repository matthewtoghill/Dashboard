export type PomodoroMode = 'focus' | 'short' | 'long';

export interface PomodoroDurations {
  /** Minutes per mode */
  focus: number;
  short: number;
  long: number;
  /** A long break replaces the short one after this many focus sessions */
  longEvery: number;
}

export interface PomodoroState {
  mode: PomodoroMode;
  /** Epoch ms when the running session ends; null while paused */
  endsAt: number | null;
  /** Time left while paused */
  remainingMs: number;
  /** Focus sessions finished in the current cycle */
  completedFocus: number;
  durations: PomodoroDurations;
}

export const DEFAULT_DURATIONS: PomodoroDurations = { focus: 25, short: 5, long: 15, longEvery: 4 };

export const MODE_LABELS: Record<PomodoroMode, string> = {
  focus: 'Focus',
  short: 'Short break',
  long: 'Long break',
};

export const modeMs = (mode: PomodoroMode, d: PomodoroDurations) => d[mode] * 60_000;

export const initialPomodoro = (durations = DEFAULT_DURATIONS): PomodoroState => ({
  mode: 'focus',
  endsAt: null,
  remainingMs: modeMs('focus', durations),
  completedFocus: 0,
  durations,
});

export const remainingMs = (s: PomodoroState, now: number) =>
  s.endsAt === null ? s.remainingMs : Math.max(0, s.endsAt - now);

export const start = (s: PomodoroState, now: number): PomodoroState =>
  s.endsAt === null ? { ...s, endsAt: now + s.remainingMs } : s;

export const pause = (s: PomodoroState, now: number): PomodoroState =>
  s.endsAt === null ? s : { ...s, endsAt: null, remainingMs: remainingMs(s, now) };

export const reset = (s: PomodoroState): PomodoroState => ({
  ...s,
  endsAt: null,
  remainingMs: modeMs(s.mode, s.durations),
});

export const setMode = (s: PomodoroState, mode: PomodoroMode): PomodoroState =>
  reset({ ...s, mode });

/** Moves to the next mode (paused). Finishing focus counts toward the long break. */
export const advance = (s: PomodoroState): PomodoroState => {
  if (s.mode !== 'focus') return setMode(s, 'focus');
  const completedFocus = s.completedFocus + 1;
  const mode = completedFocus >= s.durations.longEvery ? 'long' : 'short';
  return setMode({ ...s, completedFocus: mode === 'long' ? 0 : completedFocus }, mode);
};

/** Applies new durations; a paused, untouched session picks up the new length. */
export const setDurations = (s: PomodoroState, durations: PomodoroDurations): PomodoroState => {
  const untouched = s.endsAt === null && s.remainingMs === modeMs(s.mode, s.durations);
  const next = { ...s, durations };
  return untouched ? reset(next) : next;
};

export const formatClock = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
