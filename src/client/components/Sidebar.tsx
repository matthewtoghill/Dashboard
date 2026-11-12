import React, { useState } from 'react';
import {
  LayoutDashboard,
  Inbox,
  Calendar,
  CalendarClock,
  CalendarDays,
  CircleCheck,
  Archive,
  Plus,
  Trash2,
  Tag,
  X,
  Check,
  Pencil,
  Settings2,
  Bookmark,
  ChevronRight,
  StickyNote,
  Link2,
  Pause,
  Sun,
  ClipboardCheck,
  History,
} from 'lucide-react';
import { Project, SavedView, Task } from '../../shared/types.ts';
import { PROJECT_COLORS, getTodayIso, isPlanned, needsChase } from '../utils/taskUtils.ts';
import { ActiveNavigation, SmartViewId, resolveSavedView, viewTaskCount } from '../utils/taskView.ts';
import { ViewNameInput } from './SavedViewControls.tsx';
import { Dot, LABEL_CLASS } from './ui.tsx';

interface SidebarProps {
  /** Icon-only rail; hovering an icon shows its details. */
  rail: boolean;
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
  /** Move project `id` so it ends up at `targetIndex` among the other projects. */
  onMoveProject: (id: string, targetIndex: number) => void;
  savedViews: SavedView[];
  appliedViewId: string | null;
  onApplySavedView: (id: string) => void;
  onRenameSavedView: (id: string, name: string) => void;
  onDeleteSavedView: (id: string) => void;
  /** Claude sessions waiting on the user, badged on Home. */
  claudeAttentionCount: number;
  chaseHoldDays: number;
  /** Soft cap on today's plan (settings). */
  planSize: number;
  /** Tasks in the weekly review set, badged on Weekly Review. */
  reviewCount: number;
}

const SECTIONS_KEY = 'dashboard_sidebar_sections';
const ROW_CLASS = 'w-full flex items-center gap-2.5 px-2.5 rounded-lg transition-colors duration-150 cursor-pointer';
const ACTIVE_CLASS = 'bg-primary-500/15 text-primary-700 dark:text-primary-300 font-medium';
const IDLE_CLASS = 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/60 dark:hover:bg-zinc-900';
const HOVER_ICON_CLASS =
  'hidden group-hover:block group-focus-within:block p-0.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer';

type Sections = { savedViews: boolean; tags: boolean };

function loadSections(): Sections {
  try {
    return { savedViews: false, tags: false, ...JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') };
  } catch {
    return { savedViews: false, tags: false };
  }
}

/** Collapsible secondary row: chevron, label and count. */
const SectionToggle: React.FC<{ label: string; count: number; open: boolean; onToggle: () => void }> = ({
  label,
  count,
  open,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className={`${ROW_CLASS} py-1.5 hover:bg-zinc-200/60 dark:hover:bg-zinc-900`}
  >
    <ChevronRight className={`w-[13px] h-[13px] shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
    <span className="flex-1 text-left">{label}</span>
    <span className="text-xs text-zinc-500">{count}</span>
  </button>
);

const ProjectDropLine: React.FC<{ position: 'top' | 'bottom' }> = ({ position }) => (
  <div
    aria-hidden
    className={`absolute inset-x-0 h-0.5 rounded-full bg-primary-500 pointer-events-none ${
      position === 'top' ? '-top-px' : '-bottom-px'
    }`}
  />
);

const RAIL_BUTTON_CLASS =
  'relative w-9 h-[30px] flex items-center justify-center rounded-lg transition-colors duration-150 cursor-pointer';
const PANEL_CLASS =
  'rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl text-[13px] text-zinc-700 dark:text-zinc-200';

/**
 * Rail item: shows `panel` beside the icon on hover or focus. Fixed position escapes the
 * rail's scroll clipping; the panel is a DOM child with a padding bridge, so the pointer
 * can move into it (flyout menus) without closing it.
 */
const RailHover: React.FC<{ panel: React.ReactNode; menu?: boolean; children: React.ReactNode }> = ({
  panel,
  menu,
  children,
}) => {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = (e: React.SyntheticEvent<HTMLDivElement>) => setAnchor(e.currentTarget.getBoundingClientRect());
  return (
    <div
      onMouseEnter={open}
      onMouseLeave={() => setAnchor(null)}
      onFocus={open}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAnchor(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setAnchor(null);
      }}
    >
      {children}
      {anchor && (
        <div
          className={`fixed z-40 pl-3 ${menu ? '' : '-translate-y-1/2 pointer-events-none'}`}
          style={{ left: anchor.right, top: menu ? anchor.top - 4 : anchor.top + anchor.height / 2 }}
        >
          {menu ? (
            <div
              className={`${PANEL_CLASS} w-60 p-1 overflow-y-auto`}
              style={{ maxHeight: window.innerHeight - anchor.top - 8 }}
            >
              {panel}
            </div>
          ) : (
            <div role="tooltip" className={`${PANEL_CLASS} min-w-36 max-w-64 px-3 py-2`}>
              {panel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Tooltip body: label with count, optional detail line beneath. */
const RailTip: React.FC<{ label: string; count?: number; detail?: string }> = ({ label, count, detail }) => (
  <>
    <div className="flex items-center gap-4">
      <span className="flex-1 font-medium text-zinc-900 dark:text-zinc-100 whitespace-nowrap">{label}</span>
      {count !== undefined && <span className="text-xs text-zinc-500">{count}</span>}
    </div>
    {detail && <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>}
  </>
);

export const Sidebar: React.FC<SidebarProps> = ({
  rail,
  tasks,
  projects,
  activeNav,
  onSelectNav,
  isCalendar,
  onOpenCalendar,
  onCreateProject,
  onOpenProjectSettings,
  onDeleteProject,
  onMoveProject,
  savedViews,
  appliedViewId,
  onApplySavedView,
  onRenameSavedView,
  onDeleteSavedView,
  claudeAttentionCount,
  chaseHoldDays,
  planSize,
  reviewCount,
}) => {
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  // Insertion point (0..projects.length), shown as a line
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const resetDrag = () => {
    setDragProjectId(null);
    setDropIndex(null);
  };
  const commitProjectDrop = () => {
    const from = projects.findIndex((p) => p.id === dragProjectId);
    if (from !== -1 && dropIndex !== null) {
      const target = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (target !== from) onMoveProject(dragProjectId!, target);
    }
    resetDrag();
  };
  const [sections, setSections] = useState(loadSections);
  const toggleSection = (key: keyof Sections) =>
    setSections((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
      return next;
    });

  const today = getTodayIso();

  const activeTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'archived');
  const todayCount = activeTasks.filter((t) => t.dueDate !== null && t.dueDate <= today).length;
  const upcomingCount = activeTasks.filter((t) => t.dueDate !== null && t.dueDate > today).length;
  const completedCount = tasks.filter((t) => t.status === 'done').length;
  const onHoldCount = tasks.filter((t) => t.status === 'on_hold').length;
  const chaseCount = tasks.filter((t) => needsChase(t, chaseHoldDays)).length;
  const planCount = activeTasks.filter((t) => isPlanned(t, today)).length;
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
    countClass?: string;
    title?: string;
    /** The Calendar entry: All Active in month layout. */
    calendar?: true;
    /** Needs the user; dotted on the rail icon. */
    alert?: boolean;
  }[] = [
    {
      id: 'overview',
      label: 'Home',
      icon: LayoutDashboard,
      ...(claudeAttentionCount > 0 && {
        count: claudeAttentionCount,
        alert: true,
        countClass:
          'px-1.5 py-px rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300',
        title: `${claudeAttentionCount} Claude session${claudeAttentionCount === 1 ? '' : 's'} need${claudeAttentionCount === 1 ? 's' : ''} attention`,
      }),
    },
    {
      id: 'plan',
      label: "Today's Plan",
      icon: Sun,
      count: planCount,
      countClass: planCount > planSize ? 'text-xs font-semibold text-amber-600 dark:text-amber-400' : undefined,
      title: `${planCount} of ${planSize} planned`,
    },
    { id: 'inbox', label: 'All Active', icon: Inbox, count: activeTasks.length },
    {
      id: 'today',
      label: 'Today & Overdue',
      icon: Calendar,
      count: todayCount,
      countClass: todayCount > 0 ? 'text-xs font-semibold text-emerald-600 dark:text-emerald-400' : undefined,
    },
    { id: 'upcoming', label: 'Upcoming', icon: CalendarClock, count: upcomingCount },
    {
      id: 'on_hold',
      label: 'On Hold',
      icon: Pause,
      ...(chaseCount > 0
        ? {
            count: chaseCount,
            alert: true,
            countClass:
              'px-1.5 py-px rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-700 dark:text-amber-300',
            title: `${chaseCount} of ${onHoldCount} on hold need${chaseCount === 1 ? 's' : ''} chasing`,
          }
        : { count: onHoldCount }),
    },
    { id: 'review', label: 'Weekly Review', icon: ClipboardCheck, count: reviewCount },
    { id: 'inbox', label: 'Calendar', icon: CalendarDays, calendar: true },
    { id: 'completed', label: 'Completed', icon: CircleCheck, count: completedCount },
    { id: 'notes', label: 'Notes', icon: StickyNote },
    { id: 'links', label: 'Links', icon: Link2 },
    { id: 'activity', label: 'Activity Log', icon: History },
  ];

  const isArchiveSelected = activeNav.type === 'smart' && activeNav.id === 'archived';
  const isNavSelected = (item: (typeof navItems)[number]) =>
    activeNav.type === 'smart' &&
    activeNav.id === item.id &&
    (item.id !== 'inbox' || isCalendar === !!item.calendar);
  const selectNavItem = (item: (typeof navItems)[number]) =>
    item.calendar ? onOpenCalendar() : onSelectNav({ type: 'smart', id: item.id });
  const projectTaskCount = (id: string) => activeTasks.filter((t) => t.projectId === id).length;
  const savedViewCount = (saved: SavedView) =>
    viewTaskCount(tasks, resolveSavedView(saved.view, projects, tasks).view, projects, today);

  const tagChips = (
    <div className="flex flex-wrap gap-1.5">
      {allTags.length === 0 && <p className="text-xs text-zinc-500">No tags on active tasks</p>}
      {allTags.map(([tag, count]) => {
        const isSelected = activeNav.type === 'tag' && activeNav.id === tag;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onSelectNav({ type: 'tag', id: tag })}
            aria-current={isSelected ? 'page' : undefined}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors duration-150 cursor-pointer ${
              isSelected
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-primary-400'
            }`}
          >
            <Tag className="w-2.5 h-2.5" />
            <span>{tag}</span>
            <span className="opacity-70 text-[10px]">{count}</span>
          </button>
        );
      })}
    </div>
  );

  if (rail) {
    const railClass = (selected: boolean) => `${RAIL_BUTTON_CLASS} ${selected ? ACTIVE_CLASS : IDLE_CLASS}`;
    const iconClass = (selected: boolean) => `w-4 h-4 ${selected ? '' : 'text-zinc-500 dark:text-zinc-400'}`;
    const isTagSelected = activeNav.type === 'tag';
    const isSavedViewSelected = savedViews.some((v) => v.id === appliedViewId);
    return (
      <aside className="w-[52px] shrink-0 border-r border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950 flex flex-col select-none text-[13px]">
        <div className="px-2 py-3.5 flex flex-col items-center gap-[22px] flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
          <nav className="flex flex-col gap-px" aria-label="Smart Views">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isSelected = isNavSelected(item);
              return (
                <RailHover
                  key={item.calendar ? 'calendar' : item.id}
                  panel={<RailTip label={item.label} count={item.count} detail={item.title} />}
                >
                  <button
                    type="button"
                    onClick={() => selectNavItem(item)}
                    aria-label={item.label}
                    aria-current={isSelected ? 'page' : undefined}
                    className={railClass(isSelected)}
                  >
                    <Icon className={iconClass(isSelected)} />
                    {item.alert && (
                      <span aria-hidden className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
                    )}
                  </button>
                </RailHover>
              );
            })}
          </nav>

          {projects.length > 0 && (
            <div className="flex flex-col gap-px" role="group" aria-label="Projects">
              {projects.map((project) => {
                const isSelected = activeNav.type === 'project' && activeNav.id === project.id;
                return (
                  <RailHover
                    key={project.id}
                    panel={<RailTip label={project.name} count={projectTaskCount(project.id)} detail="Project" />}
                  >
                    <button
                      type="button"
                      data-menu-project={project.id}
                      onClick={() => onSelectNav({ type: 'project', id: project.id })}
                      aria-label={`Project ${project.name}`}
                      aria-current={isSelected ? 'page' : undefined}
                      className={railClass(isSelected)}
                    >
                      <Dot color={project.color} size={10} />
                    </button>
                  </RailHover>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-px">
            <RailHover
              menu
              panel={
                <>
                  <div className={`px-2 pt-1 pb-1.5 ${LABEL_CLASS} text-zinc-500`}>Saved views</div>
                  {savedViews.length === 0 ? (
                    <p className="px-2 pb-1.5 text-xs text-zinc-500">Use "Save view" above a task list</p>
                  ) : (
                    savedViews.map((saved) => {
                      const isSelected = appliedViewId === saved.id;
                      return (
                        <button
                          key={saved.id}
                          type="button"
                          onClick={() => onApplySavedView(saved.id)}
                          aria-current={isSelected ? 'true' : undefined}
                          className={`${ROW_CLASS} py-1.5 ${isSelected ? ACTIVE_CLASS : IDLE_CLASS}`}
                        >
                          <Bookmark className="w-3.5 h-3.5 shrink-0" />
                          <span className="flex-1 truncate text-left">{saved.name}</span>
                          <span className="text-xs text-zinc-500">{savedViewCount(saved)}</span>
                        </button>
                      );
                    })
                  )}
                </>
              }
            >
              <button
                type="button"
                aria-label={`Saved views (${savedViews.length})`}
                aria-haspopup="true"
                className={railClass(isSavedViewSelected)}
              >
                <Bookmark className={iconClass(isSavedViewSelected)} />
              </button>
            </RailHover>

            <RailHover
              menu
              panel={
                <div className="px-1.5 pb-1.5">
                  <div className={`px-0.5 pt-1 pb-1.5 ${LABEL_CLASS} text-zinc-500`}>Tags</div>
                  {tagChips}
                </div>
              }
            >
              <button
                type="button"
                aria-label={`Tags (${allTags.length})`}
                aria-haspopup="true"
                className={railClass(isTagSelected)}
              >
                <Tag className={iconClass(isTagSelected)} />
              </button>
            </RailHover>

            <RailHover panel={<RailTip label="Archive" count={archivedCount} />}>
              <button
                type="button"
                onClick={() => onSelectNav({ type: 'smart', id: 'archived' })}
                aria-label="Archive"
                aria-current={isArchiveSelected ? 'page' : undefined}
                className={railClass(isArchiveSelected)}
              >
                <Archive className={iconClass(isArchiveSelected)} />
              </button>
            </RailHover>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-[232px] shrink-0 border-r border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950 flex flex-col select-none text-[13px] max-[900px]:fixed max-[900px]:top-[52px] max-[900px]:bottom-0 max-[900px]:left-0 max-[900px]:z-30 max-[900px]:shadow-xl">
      <div className="px-2.5 py-3.5 flex flex-col gap-[22px] flex-1 overflow-y-auto overscroll-contain">
        {/* Smart Views */}
        <nav className="flex flex-col gap-px" aria-label="Smart Views">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isSelected = isNavSelected(item);
            return (
              <button
                key={item.calendar ? 'calendar' : item.id}
                type="button"
                onClick={() => selectNavItem(item)}
                title={item.title}
                aria-current={isSelected ? 'page' : undefined}
                className={`${ROW_CLASS} py-[7px] ${isSelected ? ACTIVE_CLASS : IDLE_CLASS}`}
              >
                <Icon className={`w-[15px] h-[15px] shrink-0 ${isSelected ? '' : 'text-zinc-500 dark:text-zinc-400'}`} />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {item.count !== undefined && (
                  <span className={item.countClass ?? 'text-xs text-zinc-500'}>{item.count}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Projects Section */}
        <div>
          <div className={`flex items-center justify-between px-2.5 pb-1.5 ${LABEL_CLASS} text-zinc-500`}>
            <span>Projects</span>
            <button
              type="button"
              onClick={() => setIsAddingProject((v) => !v)}
              aria-label="New project"
              title="New project"
              className="p-0.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
            >
              <Plus className="w-[13px] h-[13px]" />
            </button>
          </div>

          {isAddingProject && (
            <form
              onSubmit={handleCreateProjectSubmit}
              className="mb-2 p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2"
            >
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Project name..."
                aria-label="Project name"
                autoFocus
                className="w-full text-xs px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary-500"
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
                          ? 'scale-125 ring-2 ring-offset-1 ring-primary-500 dark:ring-offset-zinc-900'
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
                    className="p-1 text-primary-600 dark:text-primary-400 hover:text-primary-500 cursor-pointer"
                    aria-label="Save new project"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </form>
          )}

          <div
            className="flex flex-col gap-px"
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
            }}
          >
            {projects.length === 0 && !isAddingProject ? (
              <p className="px-2.5 py-1.5 text-xs text-zinc-500">No projects yet</p>
            ) : (
              projects.map((project, index) => {
                const isSelected = activeNav.type === 'project' && activeNav.id === project.id;
                return (
                  <div
                    key={project.id}
                    data-menu-project={project.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', project.id);
                      setDragProjectId(project.id);
                    }}
                    onDragEnd={resetDrag}
                    onDragOver={(e) => {
                      if (dragProjectId === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const rect = e.currentTarget.getBoundingClientRect();
                      setDropIndex(e.clientY > rect.top + rect.height / 2 ? index + 1 : index);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      commitProjectDrop();
                    }}
                    className={`group relative ${ROW_CLASS} py-1.5 ${isSelected ? ACTIVE_CLASS : IDLE_CLASS} ${
                      dragProjectId === project.id ? 'opacity-40' : ''
                    }`}
                  >
                    {dropIndex === index && <ProjectDropLine position="top" />}
                    {dropIndex === projects.length && index === projects.length - 1 && (
                      <ProjectDropLine position="bottom" />
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectNav({ type: 'project', id: project.id })}
                      onKeyDown={(e) => {
                        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                        e.preventDefault();
                        const next = e.key === 'ArrowUp' ? index - 1 : index + 1;
                        if (next >= 0 && next < projects.length) onMoveProject(project.id, next);
                      }}
                      title="Drag row to reorder (Alt+Up/Down)"
                      aria-current={isSelected ? 'page' : undefined}
                      className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <Dot color={project.color} size={8} />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenProjectSettings(project.id)}
                      aria-label={`Settings for project ${project.name}`}
                      title="Project settings"
                      className={HOVER_ICON_CLASS}
                    >
                      <Settings2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(project.id)}
                      aria-label={`Delete project ${project.name}`}
                      title="Delete project"
                      className={`${HOVER_ICON_CLASS} hover:text-red-500!`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <span className={`text-xs ${isSelected ? '' : 'text-zinc-500'}`}>{projectTaskCount(project.id)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Secondary: saved views and tags collapse; Archive */}
        <div className="flex flex-col gap-px text-zinc-500 dark:text-zinc-400">
          <SectionToggle
            label="Saved views"
            count={savedViews.length}
            open={sections.savedViews}
            onToggle={() => toggleSection('savedViews')}
          />
          {sections.savedViews && (
            <div className="flex flex-col gap-px pl-3 pb-1">
              {savedViews.length === 0 ? (
                <p className="px-2.5 py-1.5 text-xs text-zinc-500">Use "Save view" above a task list</p>
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
                    <div key={saved.id} className={`group ${ROW_CLASS} py-1.5 ${isSelected ? ACTIVE_CLASS : IDLE_CLASS}`}>
                      <button
                        type="button"
                        onClick={() => onApplySavedView(saved.id)}
                        aria-current={isSelected ? 'true' : undefined}
                        className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <Bookmark className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{saved.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenamingViewId(saved.id)}
                        aria-label={`Rename view ${saved.name}`}
                        className={HOVER_ICON_CLASS}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSavedView(saved.id)}
                        aria-label={`Delete view ${saved.name}`}
                        className={`${HOVER_ICON_CLASS} hover:text-red-500!`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="text-xs text-zinc-500">
                        {savedViewCount(saved)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          <SectionToggle label="Tags" count={allTags.length} open={sections.tags} onToggle={() => toggleSection('tags')} />
          {sections.tags && (
            <div className="px-2.5 pt-1 pb-2">{tagChips}</div>
          )}

          <button
            type="button"
            onClick={() => onSelectNav({ type: 'smart', id: 'archived' })}
            aria-current={isArchiveSelected ? 'page' : undefined}
            className={`${ROW_CLASS} py-1.5 ${isArchiveSelected ? ACTIVE_CLASS : 'hover:bg-zinc-200/60 dark:hover:bg-zinc-900'}`}
          >
            <Archive className="w-[13px] h-[13px] shrink-0" />
            <span className="flex-1 text-left">Archive</span>
            <span className="text-xs text-zinc-500">{archivedCount}</span>
          </button>
        </div>
      </div>
    </aside>
  );
};
