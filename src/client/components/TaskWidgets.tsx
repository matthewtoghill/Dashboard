import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, Star, X } from 'lucide-react';
import { ClaudeSession, Project, Task, UpdateTaskInput } from '../../shared/types.ts';
import {
  PLAN_CARRY_LIMIT,
  adoSummary,
  carriedDays,
  getDueDateInfo,
  isMainThing,
  planSuggestions,
  planTasks,
  agendaGroups,
  formatDayDate,
  formatRelativeTime,
  formatShortDate,
  getTodayIso,
  getTomorrowIso,
  staleTasks,
} from '../utils/taskUtils.ts';
import { AdoBadge, ClaudeSessionBadge, PlanBadge, TaskStatusCheckbox } from './TaskRow.tsx';
import { DatePopover } from './DatePicker.tsx';
import { useAdoSync } from './AdoImport.tsx';
import { fetchSettings } from '../api.ts';
import { Dot, LABEL_CLASS, SectionHeader } from './ui.tsx';

/** What Home's task sections need to show and act on tasks. */
export interface TaskWidgetActions {
  projects: Project[];
  claudeSessionsByTaskId: Map<string, ClaudeSession[]>;
  onToggleTask: (task: Task) => void;
  onUpdateTask: (id: string, payload: UpdateTaskInput) => void;
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

const ICON_BUTTON_CLASS =
  'shrink-0 p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer';
const PROMPT_BUTTON_CLASS = 'text-amber-800 dark:text-amber-200 font-medium hover:underline cursor-pointer';

/** Shown under a task carried over for PLAN_CARRY_LIMIT working days: split it, reschedule it, or drop it. */
const CarryOverPrompt: React.FC<{ task: Task; days: number; actions: TaskWidgetActions }> = ({ task, days, actions }) => {
  const [dateOpen, setDateOpen] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 ml-9 mb-1 px-2 py-1 rounded-md bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
      <span>Carried over {days} working days.</span>
      <button type="button" className={PROMPT_BUTTON_CLASS} onClick={() => actions.onOpenTask(task.id)}>
        Split into subtasks
      </button>
      <DatePopover
        value={task.dueDate}
        onChange={(dueDate) => actions.onUpdateTask(task.id, { dueDate, plannedFor: null })}
        open={dateOpen}
        onOpenChange={setDateOpen}
        trigger={
          <button type="button" className={PROMPT_BUTTON_CLASS} onClick={() => setDateOpen((v) => !v)}>
            Reschedule
          </button>
        }
      />
      <button type="button" className={PROMPT_BUTTON_CLASS} onClick={() => actions.onUpdateTask(task.id, { plannedFor: null })}>
        Drop from plan
      </button>
    </li>
  );
};

/** Today's plan: the main thing first, carry-over marks and the 3-day check, then suggestions while there is room. */
export const PlanSection: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const today = getTodayIso();
  const plan = planTasks(tasks, today);
  const openCount = plan.filter((t) => t.status !== 'done').length;
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const planSize = settingsData?.settings.planSize ?? 6;
  const suggestions = planSuggestions(tasks, Math.min(planSize - openCount, 5), today);

  return (
    <section aria-labelledby="home-plan" className="min-w-0">
      <SectionHeader
        id="home-plan"
        title="Today's Plan"
        meta={
          <span className={openCount > planSize ? 'text-amber-600 dark:text-amber-400 font-semibold' : undefined}>
            {openCount} of {planSize}
          </span>
        }
      />
      {plan.length === 0 && <EmptyNote>Nothing planned yet. Pick what you'll work on today.</EmptyNote>}
      <ul className="pt-1.5">
        {plan.map((task) => {
          const main = isMainThing(task, today);
          const days = carriedDays(task, today);
          const done = task.status === 'done';
          return (
            <React.Fragment key={task.id}>
              <HomeTaskRow
                task={task}
                actions={actions}
                trailing={
                  <>
                    {!done && days > 0 && <PlanBadge task={task} today={today} ignoreMain />}
                    {!done && (
                      <button
                        type="button"
                        onClick={() => actions.onUpdateTask(task.id, { mainThingOn: main ? null : today })}
                        aria-label={main ? `Clear "${task.title}" as the main thing` : `Make "${task.title}" the main thing`}
                        title={main ? 'Clear main thing' : 'Make main thing'}
                        className={`${ICON_BUTTON_CLASS} ${main ? 'text-amber-500!' : ''}`}
                      >
                        <Star className={`w-3.5 h-3.5 ${main ? 'fill-current' : ''}`} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => actions.onUpdateTask(task.id, { plannedFor: null })}
                      aria-label={`Remove "${task.title}" from today's plan`}
                      title="Remove from plan"
                      className={ICON_BUTTON_CLASS}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                }
              />
              {!done && days >= PLAN_CARRY_LIMIT && <CarryOverPrompt task={task} days={days} actions={actions} />}
            </React.Fragment>
          );
        })}
      </ul>
      {suggestions.length > 0 && (
        <>
          <h4 className={`px-2 pt-3 pb-1 ${LABEL_CLASS} text-zinc-600 dark:text-zinc-400`}>Suggestions</h4>
          <ul>
            {suggestions.map((task) => (
              <HomeTaskRow
                key={task.id}
                task={task}
                actions={actions}
                trailing={
                  <button
                    type="button"
                    onClick={() => actions.onUpdateTask(task.id, { plannedFor: today })}
                    aria-label={`Plan "${task.title}" for today`}
                    title="Add to today's plan"
                    className={ICON_BUTTON_CLASS}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                }
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

/**
 * Today's Plan view: the main thing in a card above the list (it stays in the list too). With none
 * chosen, offers the open planned tasks to pick from.
 */
export const MainThingCard: React.FC<{ tasks: Task[]; actions: TaskWidgetActions }> = ({ tasks, actions }) => {
  const today = getTodayIso();
  const plan = planTasks(tasks, today);
  const main = plan.find((t) => isMainThing(t, today));
  const candidates = plan.filter((t) => t.status !== 'done');
  if (!main && candidates.length === 0) return null;

  const cardClass = 'rounded-xl border border-amber-500/40 bg-amber-500/[.08] dark:bg-amber-500/[.06] px-4 py-3';
  const heading = (
    <span className={`flex items-center gap-1.5 ${LABEL_CLASS} text-amber-700 dark:text-amber-300`}>
      <Star className="w-3 h-3 fill-current" />
      Main thing
    </span>
  );

  if (!main) {
    return (
      <section aria-label="Main thing" className={cardClass}>
        {heading}
        <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">Pick the one task that would make today a good day.</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {candidates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => actions.onUpdateTask(t.id, { mainThingOn: today })}
              className="max-w-64 truncate px-2.5 py-1 rounded-md border border-amber-500/40 text-xs text-zinc-800 dark:text-zinc-200 hover:bg-amber-500/15 cursor-pointer"
            >
              {t.title}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const project = actions.projects.find((p) => p.id === main.projectId);
  const done = main.status === 'done';
  const days = carriedDays(main, today);
  const details = [
    project?.name,
    main.dueDate && getDueDateInfo(main.dueDate).label,
    days > 0 && `Carried over ${days}d`,
  ].filter(Boolean);
  return (
    <section aria-label="Main thing" data-menu-task={main.id} className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        {heading}
        <button
          type="button"
          onClick={() => actions.onUpdateTask(main.id, { mainThingOn: null })}
          className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
        >
          Clear
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <TaskStatusCheckbox task={main} onToggle={actions.onToggleTask} />
        <button
          type="button"
          onClick={() => actions.onOpenTask(main.id)}
          className={`min-w-0 truncate text-left text-base font-semibold cursor-pointer hover:text-primary-600 dark:hover:text-primary-400 ${
            done ? 'line-through text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'
          }`}
        >
          {main.title}
        </button>
      </div>
      {details.length > 0 && (
        <p className="mt-1 ml-8 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {project && <Dot color={project.color} />}
          {details.join(' · ')}
        </p>
      )}
    </section>
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
