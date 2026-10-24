import React, { useState } from 'react';
import {
  LayoutDashboard,
  Inbox,
  Calendar,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Archive,
  FolderPlus,
  Trash2,
  Tag,
  X,
  Check,
  Pencil,
  Settings2,
  Bookmark,
} from 'lucide-react';
import { Project, SavedView, Task } from '../../shared/types.ts';
import { PROJECT_COLORS, getTodayIso } from '../utils/taskUtils.ts';
import { ActiveNavigation, SmartViewId, resolveSavedView, viewTaskCount } from '../utils/taskView.ts';
import { ViewNameInput } from './SavedViewControls.tsx';

interface SidebarProps {
  tasks: Task[];
  projects: Project[];
  activeNav: ActiveNavigation;
  onSelectNav: (nav: ActiveNavigation) => void;
  /** All Active in a calendar layout, which the Calendar entry selects instead of All Active. */
  isCalendar: boolean;
  onOpenCalendar: () => void;
  onCreateProject: (name: string, color: string) => void;
  onOpenProjectSettings: (id: string) => void;
  onDeleteProject: (id: string) => void;
  savedViews: SavedView[];
  appliedViewId: string | null;
  onApplySavedView: (id: string) => void;
  onRenameSavedView: (id: string, name: string) => void;
  onDeleteSavedView: (id: string) => void;
  /** Claude sessions waiting on the user, badged on Dashboard Home. */
  claudeAttentionCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  tasks,
  projects,
  activeNav,
  onSelectNav,
  isCalendar,
  onOpenCalendar,
  onCreateProject,
  onOpenProjectSettings,
  onDeleteProject,
  savedViews,
  appliedViewId,
  onApplySavedView,
  onRenameSavedView,
  onDeleteSavedView,
  claudeAttentionCount,
}) => {
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);

  const today = getTodayIso();

  const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived');
  const todayCount = activeTasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  const upcomingCount = activeTasks.filter((t) => t.dueDate !== null && t.dueDate > today).length;
  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  // Gather unique tags across active tasks
  const tagCounts = new Map<string, number>();
  for (const t of activeTasks) {
    for (const tag of t.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const allTags = Array.from(tagCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const handleCreateProjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    onCreateProject(trimmed, newProjectColor);
    setNewProjectName('');
    setNewProjectColor(PROJECT_COLORS[(projects.length + 1) % PROJECT_COLORS.length]);
    setIsAddingProject(false);
  };

  const navItems: {
    id: SmartViewId;
    label: string;
    icon: React.FC<{ className?: string }>;
    count?: number;
    badgeColor?: string;
    title?: string;
    /** The Calendar entry: All Active in month layout. */
    calendar?: true;
  }[] = [
    {
      id: 'overview',
      label: 'Dashboard Home',
      icon: LayoutDashboard,
      ...(claudeAttentionCount > 0 && {
        count: claudeAttentionCount,
        badgeColor: 'text-amber-600 dark:text-amber-400 font-semibold',
        title: `${claudeAttentionCount} Claude session${claudeAttentionCount === 1 ? '' : 's'} need${claudeAttentionCount === 1 ? 's' : ''} attention`,
      }),
    },
    {
      id: 'inbox',
      label: 'All Active',
      icon: Inbox,
      count: activeTasks.length,
    },
    {
      id: 'today',
      label: 'Today & Overdue',
      icon: Calendar,
      count: todayCount,
      badgeColor:
        todayCount > 0 ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : undefined,
    },
    {
      id: 'upcoming',
      label: 'Upcoming',
      icon: CalendarClock,
      count: upcomingCount,
    },
    {
      id: 'inbox',
      label: 'Calendar',
      icon: CalendarDays,
      calendar: true,
    },
    {
      id: 'completed',
      label: 'Completed',
      icon: CheckCircle2,
      count: completedCount,
    },
    {
      id: 'archived',
      label: 'Archive',
      icon: Archive,
      count: archivedCount,
    },
  ];

  return (
    <aside className="w-64 flex-shrink-0 sticky top-14 max-h-[calc(100vh-3.5rem)] border-r border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-100/50 dark:bg-zinc-900/40 flex flex-col select-none">
      <div className="p-3 space-y-6 flex-1 overflow-y-auto overscroll-contain">
        {/* Smart Views */}
        <div>
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Views
          </div>
          <nav className="space-y-0.5" aria-label="Smart Views">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isSelected =
                activeNav.type === 'smart' &&
                activeNav.id === item.id &&
                (item.id !== 'inbox' || isCalendar === !!item.calendar);
              return (
                <button
                  key={item.calendar ? 'calendar' : item.id}
                  type="button"
                  onClick={() => (item.calendar ? onOpenCalendar() : onSelectNav({ type: 'smart', id: item.id }))}
                  title={item.title}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`text-xs ${
                        item.badgeColor ??
                        (isSelected
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-zinc-400 dark:text-zinc-500')
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Projects Section */}
        <div>
          <div className="flex items-center justify-between px-2.5 pb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Projects
            </span>
            <button
              type="button"
              onClick={() => setIsAddingProject((v) => !v)}
              aria-label="New project"
              className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-800 cursor-pointer"
              title="Create Project"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {isAddingProject && (
            <form
              onSubmit={handleCreateProjectSubmit}
              className="mb-2 p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2 shadow-xs"
            >
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name..."
                aria-label="Project name"
                autoFocus
                className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewProjectColor(color)}
                      aria-label={`Select color ${color}`}
                      className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                        newProjectColor === color
                          ? 'scale-125 ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-zinc-900'
                          : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsAddingProject(false)}
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                    aria-label="Cancel new project"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="submit"
                    className="p-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 cursor-pointer"
                    aria-label="Save new project"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="space-y-0.5">
            {projects.length === 0 && !isAddingProject ? (
              <p className="px-2.5 py-2 text-xs text-zinc-400 dark:text-zinc-500 italic">
                No projects yet
              </p>
            ) : (
              projects.map((project) => {
                const isSelected = activeNav.type === 'project' && activeNav.id === project.id;
                const projectTaskCount = activeTasks.filter(
                  (t) => t.projectId === project.id
                ).length;

                return (
                  <div
                    key={project.id}
                    data-menu-project={project.id}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                      isSelected
                        ? 'bg-indigo-600/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNav({ type: 'project', id: project.id })}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="truncate">{project.name}</span>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenProjectSettings(project.id)}
                        aria-label={`Settings for project ${project.name}`}
                        title="Project settings"
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer transition-opacity"
                      >
                        <Settings2 className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteProject(project.id)}
                        aria-label={`Delete project ${project.name}`}
                        className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 min-w-[1rem] text-right">
                        {projectTaskCount}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Saved Views Section */}
        <div>
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Saved Views
          </div>
          <div className="space-y-0.5">
            {savedViews.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-zinc-400 dark:text-zinc-500 italic">
                Use "Save view" above a task list
              </p>
            ) : (
              savedViews.map((saved) => {
                if (renamingViewId === saved.id) {
                  return (
                    <div key={saved.id} className="px-1.5 py-1">
                      <ViewNameInput
                        initial={saved.name}
                        label={`Rename view ${saved.name}`}
                        onSubmit={(name) => {
                          onRenameSavedView(saved.id, name);
                          setRenamingViewId(null);
                        }}
                        onCancel={() => setRenamingViewId(null)}
                      />
                    </div>
                  );
                }
                const isSelected = appliedViewId === saved.id;
                return (
                  <div
                    key={saved.id}
                    className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                      isSelected
                        ? 'bg-indigo-600/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 font-medium'
                        : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onApplySavedView(saved.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <Bookmark className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{saved.name}</span>
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRenamingViewId(saved.id)}
                        aria-label={`Rename view ${saved.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer transition-opacity"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedView(saved.id)}
                        aria-label={`Delete view ${saved.name}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 cursor-pointer transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 min-w-[1rem] text-right">
                        {viewTaskCount(
                          tasks,
                          resolveSavedView(saved.view, projects, tasks).view,
                          projects,
                          today
                        )}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Tags Section */}
        {allTags.length > 0 && (
          <div>
            <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5 px-2">
              {allTags.map(([tag, count]) => {
                const isSelected = activeNav.type === 'tag' && activeNav.id === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onSelectNav({ type: 'tag', id: tag })}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-indigo-400'
                    }`}
                  >
                    <Tag className="w-2.5 h-2.5" />
                    <span>{tag}</span>
                    <span className="opacity-70 text-[10px]">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
