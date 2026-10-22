import { useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 5000;

interface PendingJob {
  ids: string[];
  timer: number;
  commit: () => Promise<void>;
}

/**
 * Hides items immediately and only runs `commit` (the real delete) after the undo window.
 * Pending jobs are flushed on page hide so a closed tab still completes the delete.
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
    window.clearTimeout(job.timer);
    try {
      await job.commit();
    } catch (err) {
      onErrorRef.current(err);
    } finally {
      release(job.ids);
    }
  };

  /** Returns an undo function; calling it after the commit has started does nothing. */
  const schedule = (ids: string[], commit: () => Promise<void>): (() => void) => {
    const key = nextKey.current++;
    setPendingIds((prev) => new Set([...prev, ...ids]));
    const timer = window.setTimeout(() => void run(key), UNDO_WINDOW_MS);
    jobs.current.set(key, { ids, timer, commit });

    return () => {
      const job = jobs.current.get(key);
      if (!job) return;
      window.clearTimeout(job.timer);
      jobs.current.delete(key);
      release(ids);
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
