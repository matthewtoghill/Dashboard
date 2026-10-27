import React from 'react';
import { Download } from 'lucide-react';
import { ClaudeSession, Project, Task } from '../../shared/types.ts';
import {
  adoSummary,
  agendaGroups,
  formatDayDate,
  formatRelativeTime,
  formatShortDate,
  getTodayIso,
  getTomorrowIso,
  staleTasks,
} from '../utils/taskUtils.ts';
import { AdoBadge, ClaudeSessionBadge, TaskStatusCheckbox } from './TaskRow.tsx';
import { useAdoSync } from './AdoImport.tsx';
import { Dot, LABEL_CLASS, SectionHeader } from './ui.tsx';

/** What Home's task sections need to show and act on tasks. */
export interface TaskWidgetActions {
  projects: Project[];
  claudeSessionsByTaskId: Map<string, ClaudeSession[]>;
  onToggleTask: (task: Task) => void;
  onOpenTask: (taskId: string) => void;
  onOpenSession: (sessionId: string) => void;
}

export const EmptyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-2 py-3 text-[13px] text-zinc-500">{children}</p>
);

/** Checkbox, project dot, title (opens the task drawer) and a trailing note or badges. */
const HomeTaskRow: React.FC<{ task: Task; trailing?: React.ReactNode; actions: TaskWidgetActions }> = ({
  task,
  trailing,
  actions,
}) => {
  const project = actions.projects.find((p) => p.id === task.projectId);
  return (
    <li
      data-menu-task={task.id}
      // Transparent border on other rows so in-progress rows don't shift the layout
      className={`flex items-center gap-3 p-2 rounded-lg border transition-colors duration-150 ${
        task.status === 'in_progress'
          ? 'border-(--in-progress)/35 bg-(--in-progress)/10 hover:bg-(--in-progress)/15 dark:border-(--in-progress)/30 dark:bg-(--in-progress)/[.07] dark:hover:bg-(--in-progress)/[.12]'
          : 'border-transparent hover:bg-zinc-100/70 dark:hover:bg-zinc-900/60'
      }`}
    >
      <TaskStatusCheckbox task={task} onToggle={actions.onToggleTask} />
      <span title={project?.name}>
        <Dot color={project?.color} />
      </span>
      <button
        type="button"
        onClick={() => actions.onOpenTask(task.id)}
        className="flex-1 min-w-0 text-left text-sm truncate text-zinc-900 dark:text-zinc-100 hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer"
      >
        {task.title}
      </button>
      {trailing ?? (
        <>
          <ClaudeSessionBadge
            sessions={actions.claudeSessionsByTaskId.get(task.id) ?? []}
            onOpenSession={actions.onOpenSession}
          />
          <AdoBadge task={task} />
        </>
      )}
    </li>
  );
};

const AGENDA_DAYS = 7;

/** Overdue tasks, then the next 7 days grouped by due date. */
export const UpNextSection: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const today = getTodayIso();
  const tomorrow = getTomorrowIso();
  const groups = agendaGroups(tasks, AGENDA_DAYS, today);
  const label = (date: string | null) =>
    date === null ? 'Overdue' : date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : formatDayDate(date);

  return (
    <section aria-labelledby="home-up-next" className="min-w-0">
      <SectionHeader id="home-up-next" title="Up Next" meta="Overdue and next 7 days" />
      {groups.length === 0 ? (
        <EmptyNote>Nothing due in the next 7 days.</EmptyNote>
      ) : (
        groups.map((group, index) => (
          <div key={group.date ?? 'overdue'}>
            <h4
              className={`px-2 ${index === 0 ? 'pt-2.5' : 'pt-3'} pb-1 ${LABEL_CLASS} ${
                group.date === null ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {label(group.date)}
              {group.date !== null && <span className="ml-1.5 font-normal text-zinc-500">{group.tasks.length}</span>}
            </h4>
            <ul>
              {group.tasks.map((task) => (
                <HomeTaskRow
                  key={task.id}
                  task={task}
                  actions={actions}
                  trailing={
                    group.date === null ? (
                      <span className="shrink-0 text-xs text-red-600 dark:text-red-400">
                        {formatDayDate(task.dueDate!)}
                      </span>
                    ) : undefined
                  }
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
};

/** Rail: tasks in progress, most recently touched first. */
export const InProgressRail: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const today = getTodayIso();
  const inProgress = tasks.filter((t) => t.status === 'in_progress').sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <section aria-labelledby="home-in-progress">
      <SectionHeader id="home-in-progress" title="In Progress" meta={inProgress.length} />
      {inProgress.length === 0 ? (
        <EmptyNote>Nothing in progress.</EmptyNote>
      ) : (
        <ul className="pt-1.5">
          {inProgress.map((task) => {
            const project = actions.projects.find((p) => p.id === task.projectId);
            return (
              <li key={task.id} data-menu-task={task.id} className="flex items-center gap-2.5 px-1 py-1.5">
                <span title={project?.name}>
                  <Dot color={project?.color} />
                </span>
                <button
                  type="button"
                  onClick={() => actions.onOpenTask(task.id)}
                  className="flex-1 min-w-0 truncate text-left text-[13px] text-zinc-800 dark:text-zinc-200 hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer"
                >
                  {task.title}
                </button>
                <span className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {task.dueDate === null ? '—' : task.dueDate === today ? 'Today' : formatShortDate(task.dueDate)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

/** Drawer tab: to-do tasks nobody has touched for `days` days. */
export const StaleList: React.FC<{ tasks: Task[]; days: number; actions: TaskWidgetActions }> = ({
  tasks,
  days,
  actions,
}) => {
  const stale = staleTasks(tasks, days);
  if (stale.length === 0) return <EmptyNote>No to-do tasks untouched for {days}+ days.</EmptyNote>;
  return (
    <ul>
      {stale.map((task) => (
        <HomeTaskRow
          key={task.id}
          task={task}
          actions={actions}
          trailing={
            <span className="shrink-0 text-xs text-zinc-500" title="Last updated">
              {formatRelativeTime(task.updatedAt)}
            </span>
          }
        />
      ))}
    </ul>
  );
};

/** Drawer tab: what the last Azure DevOps check found, imported totals, and the Import button. */
export const AdoSummaryPanel: React.FC<{ tasks: Task[]; onOpenAdoImport: () => void }> = ({
  tasks,
  onOpenAdoImport,
}) => {
  const { openWorkItems, openPullRequests, lastImportAt } = adoSummary(tasks);
  const { data } = useAdoSync();
  const items = data?.items ?? [];
  const stats: [string, number, string][] = [
    ['New items', items.filter((i) => !i.taskId && i.role !== 'reviewer' && i.role !== 'mention').length, 'text-sky-700 dark:text-sky-300'],
    ['Reviews', items.filter((i) => i.role === 'reviewer').length, 'text-violet-700 dark:text-violet-300'],
    ['Mentions', items.filter((i) => !i.taskId && i.role === 'mention').length, 'text-teal-700 dark:text-teal-300'],
    ['Closed', data?.closed.length ?? 0, 'text-amber-700 dark:text-amber-300'],
    ['Open work items', openWorkItems, ''],
    ['Open pull requests', openPullRequests, ''],
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
        {stats.map(([label, count, accent]) => (
          <span key={label}>
            <span className={`text-base font-semibold ${count > 0 && accent ? accent : 'text-zinc-900 dark:text-zinc-100'}`}>
              {count}
            </span>{' '}
            {label.toLowerCase()}
          </span>
        ))}
        <button
          type="button"
          onClick={onOpenAdoImport}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium transition-colors duration-150 cursor-pointer"
        >
          <Download className="w-3 h-3" />
          Import
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        {[
          data?.checkedAt ? `Checked ${formatRelativeTime(data.checkedAt)}` : 'Not checked yet',
          lastImportAt === null ? 'nothing imported yet' : `last import ${formatRelativeTime(lastImportAt)}`,
        ].join(' · ')}
      </p>
      {data?.error && (
        <p className="text-xs text-amber-700 dark:text-amber-300 truncate" title={data.error}>
          Last check failed: {data.error}
        </p>
      )}
    </div>
  );
};
