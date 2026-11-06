import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Project, Task } from '../../shared/types.ts';
import { fetchRecentEvents } from '../api.ts';
import {
  describeTaskEvent,
  formatDayDate,
  formatIsoDateFromTimestamp,
  formatTimestamp,
  getTodayIso,
  plural,
} from '../utils/taskUtils.ts';
import { addDays, parseIsoDate, toIsoDate } from '../../shared/dates.ts';
import { Dot, LABEL_CLASS } from './ui.tsx';

const PAGE_SIZE = 100;
const SOURCE_LABELS = { manual: null, ado: 'Azure DevOps', claude: 'Claude' } as const;

interface ActivityLogProps {
  tasks: Task[];
  projects: Project[];
  search: string;
  onOpenTask: (id: string) => void;
  onOpenProject: (id: string) => void;
}

/** Every task's history, newest first, grouped by day. */
export const ActivityLog: React.FC<ActivityLogProps> = ({ tasks, projects, search, onOpenTask, onOpenProject }) => {
  const [limit, setLimit] = useState(PAGE_SIZE);
  // Refetch when any task changes, like the drawer's history
  const lastEdit = tasks.reduce((max, t) => Math.max(max, t.updatedAt), 0);
  // ponytail: "Show more" refetches a bigger page; switch to a cursor if the log gets huge
  const { data: events = [], error, isLoading, isFetching } = useQuery({
    queryKey: ['activity', limit, lastEdit],
    queryFn: () => fetchRecentEvents(limit),
    placeholderData: (prev) => prev,
  });

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const days = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = new Map<string, typeof events>();
    for (const ev of events) {
      const task = taskById.get(ev.taskId);
      if (q && !`${task?.title ?? ''} ${describeTaskEvent(ev, projects)}`.toLowerCase().includes(q)) continue;
      const day = formatIsoDateFromTimestamp(ev.at);
      groups.set(day, [...(groups.get(day) ?? []), ev]);
    }
    return [...groups];
  }, [events, search, taskById, projects]);

  const today = getTodayIso();
  const yesterday = toIsoDate(addDays(parseIsoDate(today), -1));
  const dayLabel = (day: string) => (day === today ? 'Today' : day === yesterday ? 'Yesterday' : formatDayDate(day));

  return (
    <>
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h2 className="text-[22px] font-semibold tracking-[-0.015em] truncate">Activity Log</h2>
        <span className="text-[13px] text-zinc-500 whitespace-nowrap">{plural(events.length, 'change')}</span>
      </div>

      {error ? (
        <p className="text-sm text-red-500">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-zinc-400">Loading…</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-zinc-400 italic">{search.trim() ? 'No matching activity.' : 'No changes recorded yet.'}</p>
      ) : (
        days.map(([day, dayEvents]) => (
          <section key={day} className="flex flex-col gap-1">
            <h3 className={`${LABEL_CLASS} text-zinc-400 mt-2`}>{dayLabel(day)}</h3>
            <ul className="flex flex-col">
              {dayEvents.map((ev) => {
                const task = taskById.get(ev.taskId);
                const project = task?.projectId ? projectById.get(task.projectId) : undefined;
                return (
                  <li
                    key={ev.id}
                    className="flex items-baseline gap-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800/70 text-[13px]"
                  >
                    <time
                      className="w-16 shrink-0 text-xs text-zinc-400 tabular-nums"
                      title={formatTimestamp(ev.at)}
                    >
                      {new Date(ev.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </time>
                    <div className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2">
                      <button
                        type="button"
                        onClick={() => onOpenTask(ev.taskId)}
                        className="font-medium text-left truncate max-w-full hover:text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
                      >
                        {task?.title ?? 'Unknown task'}
                      </button>
                      <span className="text-zinc-600 dark:text-zinc-300">{describeTaskEvent(ev, projects)}</span>
                    </div>
                    {project && (
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="shrink-0 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:underline"
                      >
                        <Dot color={project.color} />
                        {project.name}
                      </button>
                    )}
                    {SOURCE_LABELS[ev.source] && (
                      <span className="shrink-0 text-xs text-zinc-400">{SOURCE_LABELS[ev.source]}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {events.length === limit && (
        <button
          type="button"
          disabled={isFetching}
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="self-start text-[13px] text-primary-600 hover:underline disabled:opacity-50"
        >
          {isFetching ? 'Loading…' : 'Show more'}
        </button>
      )}
    </>
  );
};
