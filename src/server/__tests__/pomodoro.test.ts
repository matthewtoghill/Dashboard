import { describe, it, expect } from 'vitest';
import {
  initialPomodoro,
  start,
  pause,
  advance,
  remainingMs,
  setDurations,
  formatClock,
} from '../../client/utils/pomodoro.ts';

describe('pomodoro', () => {
  it('pauses and resumes keeping the remaining time', () => {
    const running = start(initialPomodoro(), 0);
    const paused = pause(running, 60_000);
    expect(remainingMs(paused, 999_999)).toBe(24 * 60_000);
    expect(remainingMs(start(paused, 100_000), 160_000)).toBe(23 * 60_000);
  });

  it('cycles focus/short and takes a long break after longEvery focus sessions', () => {
    let s = initialPomodoro({ focus: 25, short: 5, long: 15, longEvery: 2 });
    const modes: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = advance(s);
      modes.push(s.mode);
    }
    expect(modes).toEqual(['short', 'focus', 'long', 'focus', 'short']);
    expect(s.endsAt).toBeNull();
    expect(s.remainingMs).toBe(5 * 60_000);
  });

  it('applies new durations only to an untouched session', () => {
    const fresh = setDurations(initialPomodoro(), { focus: 50, short: 5, long: 15, longEvery: 4 });
    expect(fresh.remainingMs).toBe(50 * 60_000);
    const running = start(initialPomodoro(), 0);
    expect(setDurations(running, { ...running.durations, focus: 50 }).endsAt).toBe(25 * 60_000);
  });

  it('formats the clock rounding up to the next second', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(61_001)).toBe('01:02');
    expect(formatClock(0)).toBe('00:00');
  });
});
