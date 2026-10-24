import React, { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronRight, CircleDot, Hourglass, GitPullRequest, Download } from 'lucide-react';
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
import { ClaudeSessionBadge, TaskStatusCheckbox } from './TaskRow.tsx';
import { useAdoSync } from './AdoImport.tsx';

/** What the Overview's task widgets need to show and act on tasks. */
export interface TaskWidgetActions {
  projects: Project[];
  claudeSessionsByTaskId: Map<string, ClaudeSession[]>;
  onToggleTask: (task: Task) => void;
  onOpenTask: (taskId: string) => void;
  onOpenSession: (sessionId: string) => void;
}

const cardClass =
  'p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col gap-3';

/** Overview card whose header toggles the body; open or collapsed is remembered per browser. */
export const WidgetCard: React.FC<{
  id: string;
  icon?: React.ReactNode;
  iconClass?: string;
  title: string;
  subtitle: React.ReactNode;
  /** Header controls, hidden while collapsed. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, icon, iconClass, title, subtitle, actions, children }) => {
  const key = `dashboard_widget_collapsed_${id}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== '1');
  const toggle = () => {
    if (open) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
    setOpen(!open);
  };

  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-2 min-w-0 text-left cursor-pointer"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400 flex-shrink-0" />
          )}
          {icon && (
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{title}</span>
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{subtitle}</span>
          </span>
        </button>
        {open && actions}
      </div>
      {open && children}
    </div>
  );
};

const EmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="py-6 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
    {children}
  </p>
);

/** Checkbox, project dot, title (opens the task drawer), Claude badge and a right-hand note. */
const WidgetTaskRow: React.FC<{ task: Task; meta?: React.ReactNode; actions: TaskWidgetActions }> = ({
  task,
  meta,
  actions,
}) => {
  const project = actions.projects.find((p) => p.id === task.projectId);
  return (
    <li data-menu-task={task.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
      <TaskStatusCheckbox task={task} onToggle={actions.onToggleTask} />
      {project && (
        <span
          aria-hidden
          title={project.name}
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: project.color }}
        />
      )}
      <button
        type="button"
        onClick={() => actions.onOpenTask(task.id)}
        className="flex-1 min-w-0 text-left text-sm truncate text-zinc-800 dark:text-zinc-100 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
      >
        {task.title}
      </button>
      <ClaudeSessionBadge
        sessions={actions.claudeSessionsByTaskId.get(task.id) ?? []}
        onOpenSession={actions.onOpenSession}
      />
      {meta && (
        <span className="flex-shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">{meta}</span>
      )}
    </li>
  );
};

const listClass = 'space-y-0.5 max-h-80 overflow-y-auto';

const AGENDA_DAYS = 7;

/** Overdue tasks, then the next 7 days grouped by due date. */
export const AgendaCard: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const today = getTodayIso();
  const tomorrow = getTomorrowIso();
  const groups = agendaGroups(tasks, AGENDA_DAYS, today);
  const label = (date: string | null) =>
    date === null ? 'Overdue' : date === today ? 'Today' : date === tomorrow ? 'Tomorrow' : formatDayDate(date);

  return (
    <WidgetCard
      id="agenda"
      icon={<CalendarDays className="w-4 h-4" />}
      iconClass="bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400"
      title="Up Next"
      subtitle="Overdue and due in the next 7 days"
    >
      {groups.length === 0 ? (
        <EmptyState>Nothing due in the next 7 days.</EmptyState>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.date ?? 'overdue'}>
              <h4
                className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${
                  group.date === null ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {label(group.date)} <span className="font-normal">({group.tasks.length})</span>
              </h4>
              <ul className="space-y-0.5">
                {group.tasks.map((task) => (
                  <WidgetTaskRow
                    key={task.id}
                    task={task}
                    actions={actions}
                    meta={group.date === null ? formatShortDate(task.dueDate!) : undefined}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </WidgetCard>
  );
};

/** Tasks in progress, most recently touched first, with their linked Claude session. */
export const InProgressCard: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const inProgress = tasks
    .filter((t) => t.status === 'in_progress')
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <WidgetCard
      id="inProgress"
      icon={<CircleDot className="w-4 h-4" />}
      iconClass="bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400"
      title="In Progress"
      subtitle={`${inProgress.length} ${inProgress.length === 1 ? 'task' : 'tasks'} underway`}
    >
      {inProgress.length === 0 ? (
        <EmptyState>Nothing in progress. Tick a task once to start it.</EmptyState>
      ) : (
        <ul className={listClass}>
          {inProgress.map((task) => (
            <WidgetTaskRow
              key={task.id}
              task={task}
              actions={actions}
              meta={task.dueDate ? formatShortDate(task.dueDate) : undefined}
            />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
};

/** To-do tasks nobody has touched for `days` days. */
export const StaleCard: React.FC<{ tasks: Task[]; days: number; actions: TaskWidgetActions }> = ({
  tasks,
  days,
  actions,
}) => {
  const stale = staleTasks(tasks, days);

  return (
    <WidgetCard
      id="stale"
      icon={<Hourglass className="w-4 h-4" />}
      iconClass="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
      title="Gone Stale"
      subtitle={`To-do tasks untouched for ${days}+ days`}
    >
      {stale.length === 0 ? (
        <EmptyState>No stale tasks.</EmptyState>
      ) : (
        <ul className={listClass}>
          {stale.map((task) => (
            <WidgetTaskRow
              key={task.id}
              task={task}
              actions={actions}
              meta={<span title="Last updated">{formatRelativeTime(task.updatedAt)}</span>}
            />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
};

/** Open imported Azure DevOps tasks and when the newest one was imported. */
export const AdoCard: React.FC<{ tasks: Task[]; onOpenAdoImport: () => void }> = ({ tasks, onOpenAdoImport }) => {
  const { openWorkItems, openPullRequests, lastImportAt } = adoSummary(tasks);
  const { data } = useAdoSync();
  const items = data?.items ?? [];
  // From the last background check: what needs a look in the import dialog
  const pending: [string, number][] = [
    ['New items', items.filter((i) => !i.taskId && i.role !== 'reviewer').length],
    ['Reviews', items.filter((i) => i.role === 'reviewer').length],
    ['Closed', data?.closed.length ?? 0],
  ];

  return (
    <WidgetCard
      id="ado"
      icon={<GitPullRequest className="w-4 h-4" />}
      iconClass="bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400"
      title="Azure DevOps"
      subtitle={[
        data?.checkedAt ? `Checked ${formatRelativeTime(data.checkedAt)}` : null,
        lastImportAt === null ? 'Nothing imported yet' : `Last import ${formatRelativeTime(lastImportAt)}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      actions={
        <button
          type="button"
          onClick={onOpenAdoImport}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
        >
          <Download className="w-3 h-3" />
          <span>Import</span>
        </button>
      }
    >
      {data?.error && (
        <p className="text-xs text-amber-700 dark:text-amber-300 truncate" title={data.error}>
          {data.error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {pending.map(([label, count]) => (
          <button
            key={label}
            type="button"
            onClick={onOpenAdoImport}
            className={`px-3 py-2 rounded-xl text-left cursor-pointer border ${
              count > 0
                ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 hover:border-sky-400'
                : 'bg-zinc-50 dark:bg-zinc-800/50 border-transparent hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">{label}</span>
            <span className="block text-xl font-bold">{count}</span>
          </button>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {[
          ['Open work items', openWorkItems],
          ['Open pull requests', openPullRequests],
        ].map(([label, count]) => (
          <div key={label} className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
            <dt className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</dt>
            <dd className="text-2xl font-bold mt-0.5">{count}</dd>
          </div>
        ))}
      </dl>
    </WidgetCard>
  );
};
