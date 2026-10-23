import React from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  CalendarDays,
  CalendarRange,
  Flag,
  Layers,
  List,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Project, TaskPriority } from '../../shared/types.ts';
import { GroupByOption, SortByOption, ViewState } from '../utils/taskView.ts';

/** Icon, label and native select in a pill, as used by the list toolbar. */
const ToolbarSelect: React.FC<{
  icon: LucideIcon;
  label: string;
  ariaLabel: string;
  value: string | number;
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ icon: Icon, label, ariaLabel, value, onChange, children }) => (
  <div className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
    <Icon className="w-3.5 h-3.5 text-zinc-400" />
    <span className="text-zinc-400 hidden sm:inline">{label}:</span>
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
    >
      {children}
    </select>
  </div>
);

/** View title and count, bulk archive/restore actions, and the filter, layout, group and sort controls. */
export const TaskListToolbar: React.FC<{
  view: ViewState;
  updateView: (patch: Partial<ViewState>) => void;
  title: string;
  projects: Project[];
  isCalendar: boolean;
  activeCount: number;
  completedCount: number;
  onArchiveCompleted: () => void;
  onRestoreAll: () => void;
  onDeleteAll: () => void;
  savedViewControls: React.ReactNode;
}> = ({
  view,
  updateView,
  title,
  projects,
  isCalendar,
  activeCount,
  completedCount,
  onArchiveCompleted,
  onRestoreAll,
  onDeleteAll,
  savedViewControls,
}) => {
  const { nav: activeNav, priority: priorityFilter, groupBy, sortBy } = view;
  const isCompletedView = activeNav.type === 'smart' && activeNav.id === 'completed';
  const isArchiveView = activeNav.type === 'smart' && activeNav.id === 'archived';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-zinc-200/70 dark:border-zinc-800/70">
      <div className="flex items-center gap-2.5">
        {activeNav.type === 'project' && (
          <span
            className="w-3 h-3 rounded-full"
            style={{
              backgroundColor:
                projects.find((p) => p.id === activeNav.id)?.color ?? '#6366f1',
            }}
          />
        )}
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
          {isCompletedView ? completedCount : activeCount}
        </span>
      </div>

      {/* Grouping, Sorting, Priority Filter Toolbar */}
      <div className="flex items-center flex-wrap gap-2">
        {isCompletedView && completedCount > 0 && (
          <button
            type="button"
            onClick={onArchiveCompleted}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Archive {completedCount} completed</span>
          </button>
        )}

        {isArchiveView && activeCount > 0 && (
          <>
            <button
              type="button"
              onClick={onRestoreAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              <span>Restore {activeCount}</span>
            </button>
            <button
              type="button"
              onClick={onDeleteAll}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 hover:bg-red-100 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete {activeCount} permanently</span>
            </button>
          </>
        )}

        {savedViewControls}

        {/* Filter by Priority */}
        <ToolbarSelect
          icon={Flag}
          label="Priority"
          ariaLabel="Filter by priority"
          value={priorityFilter}
          onChange={(value) =>
            updateView({ priority: value === 'all' ? 'all' : (Number(value) as TaskPriority) })
          }
        >
          <option value="all">All</option>
          <option value={4}>Urgent</option>
          <option value={3}>High</option>
          <option value={2}>Medium</option>
          <option value={1}>Low</option>
          <option value={0}>None</option>
        </ToolbarSelect>

        {/* List or calendar layout */}
        {!isArchiveView && (
          <div
            role="group"
            aria-label="Layout"
            className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-0.5 text-xs"
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
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium cursor-pointer ${
                  view.layout === value
                    ? 'bg-indigo-600/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        )}

        {!isCalendar && (
        <>
        {/* Group By */}
        <ToolbarSelect
          icon={Layers}
          label="Group"
          ariaLabel="Group tasks by"
          value={groupBy}
          onChange={(value) => updateView({ groupBy: value as GroupByOption })}
        >
          <option value="none">None</option>
          <option value="priority">Priority</option>
          <option value="project">Project</option>
          <option value="dueDate">Due Date</option>
          <option value="status">Status</option>
        </ToolbarSelect>

        {sortBy === 'manual' && groupBy !== 'none' && (
          <span className="text-[11px] text-zinc-400">
            Set Group to None to drag-reorder
          </span>
        )}

        {/* Sort By */}
        <ToolbarSelect
          icon={ArrowUpDown}
          label="Sort"
          ariaLabel="Sort tasks by"
          value={sortBy}
          onChange={(value) => updateView({ sortBy: value as SortByOption })}
        >
          <option value="created">Newest</option>
          <option value="priority">Priority</option>
          <option value="dueDate">Due Date</option>
          <option value="manual">Manual</option>
        </ToolbarSelect>
        </>
        )}
      </div>
    </div>
  );
};
