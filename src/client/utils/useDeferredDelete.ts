import { useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 5000;

interface PendingJob {
  ids: string[];
  commit: () => Promise<void>;
  /** null while paused */
  timer: number | null;
  startedAt: number;
  remaining: number;
}

/** Controls for one scheduled delete; every method is a no-op once the commit has started. */
export interface DeferredHandle {
  undo: () => void;
  /** Hold the commit, e.g. while the user hovers the undo toast. */
  pause: () => void;
  resume: () => void;
}

/**
 * Hides items immediately and only runs `commit` (the real delete) after the undo window.
 * Pending jobs (paused or not) are flushed on page hide so a closed tab still completes the delete.
 */
export function useDeferredDelete(onError: (err: unknown) => void) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const jobs = useRef(new Map<number, PendingJob>());
  const nextKey = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const release = (ids: string[]) =>
    setPendingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

  const run = async (key: number) => {
    const job = jobs.current.get(key);
    if (!job) return;
    jobs.current.delete(key);
    if (job.timer !== null) window.clearTimeout(job.timer);
    try {
      await job.commit();
    } catch (err) {
      onErrorRef.current(err);
    } finally {
      release(job.ids);
    }
  };

  const schedule = (ids: string[], commit: () => Promise<void>): DeferredHandle => {
    const key = nextKey.current++;
    setPendingIds((prev) => new Set([...prev, ...ids]));
    jobs.current.set(key, {
      ids,
      commit,
      timer: window.setTimeout(() => void run(key), UNDO_WINDOW_MS),
      startedAt: Date.now(),
      remaining: UNDO_WINDOW_MS,
    });

    return {
      undo: () => {
        const job = jobs.current.get(key);
        if (!job) return;
        if (job.timer !== null) window.clearTimeout(job.timer);
        jobs.current.delete(key);
        release(ids);
      },
      pause: () => {
        const job = jobs.current.get(key);
        if (!job || job.timer === null) return;
        window.clearTimeout(job.timer);
        job.timer = null;
        job.remaining -= Date.now() - job.startedAt;
      },
      resume: () => {
        const job = jobs.current.get(key);
        if (!job || job.timer !== null) return;
        job.startedAt = Date.now();
        job.timer = window.setTimeout(() => void run(key), Math.max(job.remaining, 0));
      },
    };
  };

  useEffect(() => {
    const flushAll = () => {
      for (const key of [...jobs.current.keys()]) void run(key);
    };
    window.addEventListener('pagehide', flushAll);
    return () => window.removeEventListener('pagehide', flushAll);
  }, []);

  return { pendingIds, schedule };
}
