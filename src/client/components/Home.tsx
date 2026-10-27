import React from 'react';
import { CircleCheck, Flame, TriangleAlert } from 'lucide-react';
import { ClaudeSession, Task, WidgetConfig } from '../../shared/types.ts';
import { computeDashboardStats } from '../utils/taskUtils.ts';
import { ClaudeAttentionBanner, ClaudeSessionActions, ClaudeSessionsRail } from './ClaudeSessions.tsx';
import { HomeDrawer } from './DashboardWidgets.tsx';
import { InProgressRail, TaskWidgetActions, UpNextSection } from './TaskWidgets.tsx';
import { Divider } from './ui.tsx';

/** "Friday, 24 October" */
function formatLongDate(date: Date): string {
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = date.toLocaleDateString('en-GB', { month: 'long' });
  return `${weekday}, ${date.getDate()} ${month}`;
}

function greeting(date: Date): string {
  const hour = date.getHours();
  return hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';
}

/** Progress ring, done today, streak and overdue, inline beside the greeting. */
const HomeStatsStrip: React.FC<{ tasks: Task[]; onOpenOverdue: () => void }> = ({ tasks, onOpenOverdue }) => {
  const stats = computeDashboardStats(tasks);
  return (
    <div className="flex flex-wrap items-center gap-5 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="w-4 h-4 rounded-full [--ring-track:var(--color-zinc-200)] dark:[--ring-track:var(--color-zinc-800)]"
          style={{
            background: `conic-gradient(var(--color-primary-500) ${stats.completionRate}%, var(--ring-track) 0)`,
          }}
        />
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{stats.completionRate}%</span> done
        <span className="text-zinc-400 dark:text-zinc-500">
          {stats.totalCompleted}/{stats.totalActive + stats.totalCompleted}
        </span>
      </span>
      <Divider />
      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CircleCheck className="w-[13px] h-[13px]" />
        <span className="font-semibold">{stats.completedToday}</span> today
      </span>
      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Flame className="w-[13px] h-[13px]" />
        <span className="font-semibold">{stats.streakDays}d</span> streak
      </span>
      {stats.overdueCount > 0 && (
        <button
          type="button"
          onClick={onOpenOverdue}
          className="flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline cursor-pointer"
        >
          <TriangleAlert className="w-[13px] h-[13px]" />
          <span className="font-semibold">{stats.overdueCount}</span> overdue
        </button>
      )}
    </div>
  );
};

/** Home: greeting and stats, the Claude banner, Up next beside the rail, and the bottom drawer. */
export const HomeView: React.FC<{
  tasks: Task[];
  claudeSessions: ClaudeSession[];
  claudeSessionActions: ClaudeSessionActions;
  taskWidgetActions: TaskWidgetActions;
  widgetConfig: WidgetConfig;
  onOpenOverdue: () => void;
  drawer: Omit<React.ComponentProps<typeof HomeDrawer>, 'tasks' | 'widgetConfig' | 'taskWidgetActions'>;
}> = ({ tasks, claudeSessions, claudeSessionActions, taskWidgetActions, widgetConfig, onOpenOverdue, drawer }) => {
  const now = new Date();
  const showRailTasks = widgetConfig.showInProgress;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-xs font-medium text-zinc-500">{formatLongDate(now)}</p>
          <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.015em]">{greeting(now)}</h2>
        </div>
        {widgetConfig.showStats && <HomeStatsStrip tasks={tasks} onOpenOverdue={onOpenOverdue} />}
      </div>

      <ClaudeAttentionBanner sessions={claudeSessions} tasks={tasks} />

      <div
        className={`flex-1 grid gap-10 items-start ${
          widgetConfig.showAgenda
            ? 'grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] max-[1100px]:grid-cols-1'
            : 'grid-cols-1'
        }`}
      >
        {widgetConfig.showAgenda && <UpNextSection tasks={tasks} actions={taskWidgetActions} />}
        <div className="flex flex-col gap-[26px] min-w-0">
          {showRailTasks && <InProgressRail tasks={tasks} actions={taskWidgetActions} />}
          <ClaudeSessionsRail sessions={claudeSessions} tasks={tasks} {...claudeSessionActions} />
        </div>
      </div>

      <HomeDrawer {...drawer} tasks={tasks} widgetConfig={widgetConfig} taskWidgetActions={taskWidgetActions} />
    </>
  );
};
