import React from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ArrowUpDown,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  Flag,
  Layers,
  List,
  Trash2,
  type LucideIcon,
  Settings2,
} from 'lucide-react';
import { TaskPriority } from '../../shared/types.ts';
import { GroupByOption, SortByOption, ViewState } from '../utils/taskView.ts';
import { Divider, Dot } from './ui.tsx';

/** Quiet dropdown: icon, the native select showing its value, and a chevron. */
const GhostSelect: React.FC<{
  icon: LucideIcon;
  ariaLabel: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ icon: Icon, ariaLabel, value, onChange, children }) => (
  <div className="relative inline-flex items-center gap-1.5 px-[9px] py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150">
    <Icon className="w-[13px] h-[13px] shrink-0" />
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="appearance-none bg-transparent pr-3.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60 rounded cursor-pointer"
    >
      {children}
    </select>
    <ChevronDown className="w-[11px] h-[11px] absolute right-[9px] pointer-events-none" />
  </div>
);

export const toolbarButtonClass =
  'inline-flex items-center gap-1.5 px-[9px] py-1 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150 cursor-pointer';

/** Title with its meta line, bulk archive actions, and the layout, group, sort and filter controls. */
export const TaskListToolbar: React.FC<{
  view: ViewState;
  updateView: (patch: Partial<ViewState>) => void;
  title: string;
  /** "19 tasks · 5 projects", "7 open" */
  meta: string;
  /** Set in project views: the colour dot before the title. */
  projectColor?: string;
  isCalendar: boolean;
  activeCount: number;
  onRestoreAll: () => void;
  onDeleteAll: () => void;
  /** Completed view: tasks the archive button would archive. */
  completedCount: number;
  onArchiveCompleted: () => void;
  savedViewControls: React.ReactNode;
  /** Set in project views. */
  onOpenProjectSettings?: () => void;
}> = ({
  view,
  updateView,
  title,
  meta,
  projectColor,
  isCalendar,
  activeCount,
  onRestoreAll,
  onDeleteAll,
  completedCount,
  onArchiveCompleted,
  savedViewControls,
  onOpenProjectSettings,
}) => {
  const { nav: activeNav, priority: priorityFilter, groupBy, sortBy } = view;
  const isArchiveView = activeNav.type === 'smart' && activeNav.id === 'archived';
  const isCompletedView = activeNav.type === 'smart' && activeNav.id === 'completed';

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex items-baseline gap-2.5 min-w-0">
        {projectColor && <Dot color={projectColor} size={12} className="self-center" />}
        <h2 className="text-[22px] font-semibold tracking-[-0.015em] truncate">{title}</h2>
        <span className="text-[13px] text-zinc-500 whitespace-nowrap">{meta}</span>
        {onOpenProjectSettings && (
          <button
            type="button"
            onClick={onOpenProjectSettings}
            aria-label="Project settings"
            title="Project settings"
            className="self-center p-1 rounded-md text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer"
          >
            <Settings2 className="w-[15px] h-[15px]" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        {isArchiveView && activeCount > 0 && (
          <>
            <button type="button" onClick={onRestoreAll} className={toolbarButtonClass}>
              <ArchiveRestore className="w-[13px] h-[13px]" />
              <span>Restore {activeCount}</span>
            </button>
            <button
              type="button"
              onClick={onDeleteAll}
              className={`${toolbarButtonClass} text-red-600! dark:text-red-400! hover:bg-red-500/10!`}
            >
              <Trash2 className="w-[13px] h-[13px]" />
              <span>Delete {activeCount} permanently</span>
            </button>
          </>
        )}

        {isCompletedView && completedCount > 0 && (
          <button type="button" onClick={onArchiveCompleted} className={toolbarButtonClass}>
            <Archive className="w-[13px] h-[13px]" />
            <span>Archive {completedCount}</span>
          </button>
        )}

        {/* List or calendar layout */}
        {!isArchiveView && (
          <div
            role="group"
            aria-label="Layout"
            className="inline-flex p-0.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          >
            {(
              [
                ['list', 'List', List],
                ['month', 'Month', CalendarDays],
                ['week', 'Week', CalendarRange],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => updateView({ layout: value })}
                aria-pressed={view.layout === value}
                className={`inline-flex items-center gap-[5px] px-2 py-[3px] rounded-md transition-colors duration-150 cursor-pointer ${
                  view.layout === value
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-[13px] h-[13px]" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {!isCalendar && (
          <>
            <GhostSelect
              icon={Layers}
              ariaLabel="Group tasks by"
              value={groupBy}
              onChange={(value) => updateView({ groupBy: value as GroupByOption })}
            >
              <option value="none">No grouping</option>
              <option value="dueDate">Due date</option>
              <option value="status">Status</option>
              <option value="priority">Priority</option>
              <option value="project">Project</option>
              <option value="adoLink">ADO link</option>
              <option value="age">Age</option>
            </GhostSelect>

            {sortBy === 'manual' && groupBy !== 'none' && (
              <span className="text-[11px] text-zinc-400">Set grouping to none to drag-reorder</span>
            )}

            <GhostSelect
              icon={ArrowUpDown}
              ariaLabel="Sort tasks by"
              value={sortBy}
              onChange={(value) => updateView({ sortBy: value as SortByOption })}
            >
              <option value="created">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="updated">Recently updated</option>
              <option value="title">Title (A-Z)</option>
              <option value="heldSince">Longest on hold</option>
              <option value="dueDate">Due date</option>
              <option value="priority">Priority</option>
              <option value="manual">Manual</option>
            </GhostSelect>
          </>
        )}

        <GhostSelect
          icon={Flag}
          ariaLabel="Filter by priority"
          value={priorityFilter}
          onChange={(value) => updateView({ priority: value === 'all' ? 'all' : (Number(value) as TaskPriority) })}
        >
          <option value="all">Any priority</option>
          <option value={4}>Urgent</option>
          <option value={3}>High</option>
          <option value={2}>Medium</option>
          <option value={1}>Low</option>
          <option value={0}>None</option>
        </GhostSelect>

        <Divider height={16} />
        {savedViewControls}
      </div>
    </div>
  );
};

/** Project view: progress bar in the project colour, overdue count, and a link to a waiting Claude session. */
export const ProjectProgressStrip: React.FC<{
  color: string;
  done: number;
  total: number;
  overdue: number;
  onOpenWaitingSession?: () => void;
}> = ({ color, done, total, overdue, onOpenWaitingSession }) => (
  <div className="flex flex-wrap items-center gap-[18px] text-xs text-zinc-500 dark:text-zinc-400">
    <span className="flex items-center gap-2.5">
      <span
        role="progressbar"
        aria-label="Project progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="w-40 h-[5px] rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden"
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${total ? (done / total) * 100 : 0}%`, backgroundColor: color }}
        />
      </span>
      <span>
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {done} of {total}
        </span>{' '}
        done
      </span>
    </span>
    {overdue > 0 && (
      <>
        <Divider />
        <span className="text-red-600 dark:text-red-400">{overdue} overdue</span>
      </>
    )}
    {onOpenWaitingSession && (
      <>
        <Divider />
        <button
          type="button"
          onClick={onOpenWaitingSession}
          className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
        >
          <span aria-hidden className="w-[7px] h-[7px] rounded-full bg-amber-400" />
          Claude is waiting on you
          <ArrowRight className="w-3 h-3" />
        </button>
      </>
    )}
  </div>
);
