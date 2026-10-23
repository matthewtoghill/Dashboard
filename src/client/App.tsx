import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Search,
  X,
  PanelLeft,
  Command,
  Archive,
  Settings,
  CloudDownload,
} from 'lucide-react';
import {
  fetchTasks,
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  fetchDashboardState,
  fetchClaudeSessions,
  updateClaudeSession,
  saveScratchpad,
  saveWidgetConfig,
  createQuickLink,
  deleteQuickLink,
  importDashboardData,
  saveSavedViews,
  fetchSettings,
} from './api.ts';
import {
  Task,
  WidgetConfig,
  WidgetConfigSchema,
  DashboardState,
  SavedView,
  MAX_SAVED_VIEWS,
  ClaudeSession,
  UpdateClaudeSessionInput,
} from '../shared/types.ts';
import { TaskRow, TaskListHeader } from './components/TaskRow.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TaskDetailDrawer } from './components/TaskDetailDrawer.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { DashboardWidgets } from './components/DashboardWidgets.tsx';
import { SettingsPanel, ThemePreference } from './components/SettingsPanel.tsx';
import { AdoImportDialog } from './components/AdoImport.tsx';
import {
  ClaudeSessionActions,
  ClaudeSessionPanel,
  ClaudeSessionsCard,
  taskFromSession,
} from './components/ClaudeSessions.tsx';
import { ReorderableTaskList } from './components/ReorderableTaskList.tsx';
import { CalendarView } from './components/CalendarView.tsx';
import { SavedViewControls } from './components/SavedViewControls.tsx';
import { QuickAddBar } from './components/QuickAddBar.tsx';
import { TaskListToolbar } from './components/TaskListToolbar.tsx';
import {
  ConfirmDialog,
  ConfirmRequest,
  ShortcutsDialog,
  Toast,
  ToastState,
} from './components/Feedback.tsx';
import { DeferredHandle, UNDO_HINT, useDeferredDelete } from './utils/useDeferredDelete.ts';
import { useTaskMutations } from './utils/useTaskMutations.ts';
import { useGlobalShortcuts } from './utils/useGlobalShortcuts.ts';
import { useTaskListKeyboard } from './utils/useTaskListKeyboard.ts';
import {
  ActiveNavigation,
  DEFAULT_VIEW_STATE,
  ViewState,
  buildTaskList,
  resolveSavedView,
  sameView,
  viewTitle,
  visibleTaskOrder,
} from './utils/taskView.ts';
import {
  getTodayIso,
  plural,
  errorMessage,
} from './utils/taskUtils.ts';

const DEFAULT_WIDGET_CONFIG = WidgetConfigSchema.parse({});

export const App: React.FC = () => {
  const queryClient = useQueryClient();

  // Sidebar & Navigation state
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // List view: navigation, search, priority filter, grouping and sorting
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW_STATE);
  const { nav: activeNav, search: searchQuery, priority: priorityFilter, groupBy, sortBy } = view;
  const updateView = (patch: Partial<ViewState>) => setView((v) => ({ ...v, ...patch }));
  // The saved view last applied. Filter changes keep it (and mark it modified); navigating elsewhere drops it.
  const [appliedViewId, setAppliedViewId] = useState<string | null>(null);
  // Smart views open as a list; projects and tags keep the current layout
  const setActiveNav = useCallback((nav: ActiveNavigation, layout?: ViewState['layout']) => {
    setAppliedViewId(null);
    setView((v) => ({ ...v, nav, layout: layout ?? (nav.type === 'smart' ? 'list' : v.layout) }));
  }, []);
  const openCalendar = () => setActiveNav({ type: 'smart', id: 'inbox' }, 'month');

  // Selected Task for Detail Drawer & Command Palette state
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /** `undo` is a plain callback, or a deferred-delete handle (whose commit pauses with the toast). */
  const showToast = (message: string, undo?: (() => void) | DeferredHandle) =>
    setToast(
      typeof undo === 'function' || undo === undefined
        ? { message, onUndo: undo }
        : { message, onUndo: undo.undo, onPause: undo.pause, onResume: undo.resume }
    );

  // Quick-add project picker; calendar quick-add uses it too
  const [newProjectId, setNewProjectId] = useState<string>('');

  const [showCompleted, setShowCompleted] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adoImportOpen, setAdoImportOpen] = useState(false);
  // Theme is per-browser: 'light' or 'dark' in localStorage, absent means follow the system
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem('dashboard_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const darkMode = theme === 'system' ? systemDark : theme === 'dark';
  const toggleTheme = () => setTheme(darkMode ? 'light' : 'dark');

  const quickAddRef = useRef<HTMLInputElement>(null);
  const focusQuickAdd = useCallback(() => {
    if (
      activeNav.type === 'smart' &&
      (activeNav.id === 'overview' || activeNav.id === 'completed' || activeNav.id === 'archived')
    ) {
      setActiveNav({ type: 'smart', id: 'inbox' });
    }
    setTimeout(() => quickAddRef.current?.focus(), 20);
  }, [activeNav, setActiveNav]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    if (theme === 'system') localStorage.removeItem('dashboard_theme');
    else localStorage.setItem('dashboard_theme', theme);
  }, [darkMode, theme]);

  const undoToast = toast?.onUndo;
  useGlobalShortcuts({
    dialogOpen: confirmRequest !== null || shortcutsOpen || settingsOpen || adoImportOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    taskDrawerOpen: selectedTaskId !== null,
    closeTaskDrawer: () => setSelectedTaskId(null),
    undoToast:
      undoToast &&
      (() => {
        undoToast();
        setToast(null);
      }),
    focusQuickAdd,
    focusSearch: () => searchInputRef.current?.focus(),
  });

  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const defaultProjectId = settingsData?.settings.defaultProjectId ?? '';
  const weekStartDay = settingsData?.settings.weekStartDay ?? 1;

  // The quick-add project follows the current view (else the settings default), and resets when leaving it
  useEffect(() => {
    setNewProjectId(activeNav.type === 'project' ? activeNav.id : defaultProjectId);
  }, [activeNav, defaultProjectId]);

  // Queries
  const {
    data: rawTasks = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['tasks'],
    queryFn: fetchTasks,
  });

  const { data: rawProjects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const { data: dashboardState } = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboardState,
  });

  // Hooks push session events to the server; poll so state changes show up promptly
  const { data: claudeSessions = [] } = useQuery({
    queryKey: ['claudeSessions'],
    queryFn: fetchClaudeSessions,
    refetchInterval: 5000,
  });
  const claudeAttentionCount = claudeSessions.filter((s) => s.state === 'needs_attention' && !s.dismissedAt).length;
  const claudeSessionsByTaskId = useMemo(() => {
    const map = new Map<string, ClaudeSession[]>();
    for (const session of claudeSessions) {
      if (!session.taskId) continue;
      const list = map.get(session.taskId) ?? [];
      list.push(session);
      map.set(session.taskId, list);
    }
    return map;
  }, [claudeSessions]);

  const invalidate = (...keys: string[]) =>
    Promise.all(keys.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));

  const { pendingIds, schedule } = useDeferredDelete((err) => {
    showToast(errorMessage(err, 'Delete failed'));
    invalidate('tasks', 'projects', 'dashboard');
  });

  // Items awaiting a deferred delete are hidden everywhere until the undo window passes.
  const tasks = useMemo(
    () =>
      pendingIds.size === 0
        ? rawTasks
        : rawTasks
            .filter((t) => !pendingIds.has(t.id))
            .map((t) =>
              t.subtasks.some((sub) => pendingIds.has(sub.id))
                ? { ...t, subtasks: t.subtasks.filter((sub) => !pendingIds.has(sub.id)) }
                : t
            ),
    [rawTasks, pendingIds]
  );
  const allTags = useMemo(
    () => [...new Set(tasks.flatMap((t) => t.tags))].sort(),
    [tasks]
  );
  const projects = useMemo(
    () => rawProjects.filter((p) => !pendingIds.has(p.id)),
    [rawProjects, pendingIds]
  );

  const scratchpad = dashboardState?.scratchpad ?? '';
  const quickLinks = (dashboardState?.quickLinks ?? []).filter((l) => !pendingIds.has(l.id));
  const widgetConfig: WidgetConfig = dashboardState?.widgetConfig ?? DEFAULT_WIDGET_CONFIG;
  const savedViews = (dashboardState?.savedViews ?? []).filter((v) => !pendingIds.has(v.id));
  const appliedView = savedViews.find((v) => v.id === appliedViewId) ?? null;

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const {
    createTaskMutation,
    createTaskFromText,
    handleCreateSubtask,
    handleUpdateSubtask,
    handleDeleteSubtask,
    handleUpdateTask,
    handleRescheduleTask,
    handleToggleTask,
    handleMoveTask,
    handleDeleteTask,
    handleArchiveTask,
    handleRestoreTasks,
    requestArchiveCompleted,
    requestDeleteArchived,
  } = useTaskMutations({
    tasks,
    projects,
    showToast,
    confirm: setConfirmRequest,
    schedule,
    onTaskRemoved: (id) => setSelectedTaskId((selected) => (selected === id ? null : selected)),
  });

  // Project Mutations
  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({
      id,
      name,
      color,
    }: {
      id: string;
      name: string;
      color: string;
    }) => updateProject(id, { name, color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  // Dashboard / Widget Mutations
  // Write-through cache instead of invalidating, so a refetch racing an in-flight save
  // can't push stale text back into the editor.
  // ponytail: a quick-link/widget refetch during an in-flight save can still return the
  // previous text; add a version counter if that ever shows up.
  const saveScratchpadMutation = useMutation({
    mutationFn: saveScratchpad,
    onMutate: (content) => {
      queryClient.setQueryData<typeof dashboardState>(['dashboard'], (old) =>
        old ? { ...old, scratchpad: content } : old
      );
    },
  });

  const saveWidgetConfigMutation = useMutation({
    mutationFn: saveWidgetConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const createQuickLinkMutation = useMutation({
    mutationFn: createQuickLink,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const importBackupMutation = useMutation({
    mutationFn: importDashboardData,
    // The server takes a safety backup first, so the backup list changes too
    onSettled: () => invalidate('tasks', 'projects', 'dashboard', 'backups', 'claudeSessions'),
  });

  const updateClaudeSessionMutation = useMutation({
    mutationFn: ({ sessionId, input }: { sessionId: string; input: UpdateClaudeSessionInput }) =>
      updateClaudeSession(sessionId, input),
    onError: (err) => showToast(errorMessage(err, 'Updating session failed')),
    onSettled: () => invalidate('claudeSessions'),
  });
  const selectedSession = claudeSessions.find((s) => s.sessionId === selectedSessionId) ?? null;

  const claudeSessionActions: ClaudeSessionActions = {
    onOpen: (sessionId) => {
      setSelectedTaskId(null);
      setSelectedSessionId(sessionId);
    },
    onOpenTask: (taskId) => {
      setSelectedSessionId(null);
      setSelectedTaskId(taskId);
    },
    onLink: (sessionId, taskId) => updateClaudeSessionMutation.mutate({ sessionId, input: { taskId } }),
    // Create a task from the session with the chosen title, and link them
    onCreateTask: async (session: ClaudeSession, title: string) => {
      try {
        const task = await createTaskMutation.mutateAsync({ ...taskFromSession(session), title });
        await updateClaudeSessionMutation.mutateAsync({
          sessionId: session.sessionId,
          input: { taskId: task.id },
        });
      } catch (err) {
        showToast(errorMessage(err, 'Creating task failed'));
      }
    },
    onToggleCleared: (session: ClaudeSession) => {
      const dismissed = !session.dismissedAt;
      const setDismissed = (value: boolean) =>
        updateClaudeSessionMutation.mutate({ sessionId: session.sessionId, input: { dismissed: value } });
      setDismissed(dismissed);
      if (dismissed) {
        showToast(`Cleared "${session.title || 'Untitled session'}"`, () => setDismissed(false));
      }
    },
  };

  const handleConvertScratchpadLineToTask = (lineText: string) => createTaskFromText(lineText, null, null);


  const handleDeleteProject = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    const taskCount = tasks.filter((t) => t.projectId === id).length;
    setConfirmRequest({
      title: 'Delete project?',
      message:
        `Project "${project.name}" will be deleted.` +
        (taskCount
          ? ` Its ${plural(taskCount, 'task')} will be kept and moved to "No Project".`
          : '') +
        `\n${UNDO_HINT}`,
      confirmLabel: 'Delete project',
      onConfirm: () => {
        if (activeNav.type === 'project' && activeNav.id === id) {
          setActiveNav({ type: 'smart', id: 'inbox' });
        }
        const undo = schedule([id], async () => {
          await deleteProject(id);
          await invalidate('projects', 'tasks');
        });
        showToast(`Deleted project "${project.name}"`, undo);
      },
    });
  };

  const handleDeleteQuickLink = (id: string) => {
    const link = quickLinks.find((l) => l.id === id);
    if (!link) return;
    setConfirmRequest({
      title: 'Remove quick link?',
      message: `"${link.title}" (${link.url}) will be removed from Quick Links.\n${UNDO_HINT}`,
      confirmLabel: 'Remove link',
      onConfirm: () => {
        const undo = schedule([id], async () => {
          await deleteQuickLink(id);
          await invalidate('dashboard');
        });
        showToast(`Removed "${link.title}"`, undo);
      },
    });
  };

  // Saved views: every change rewrites the full list, starting from the cached list (which still
  // holds views awaiting a deferred delete, so their undo keeps working).
  const writeSavedViews = async (update: (list: SavedView[]) => SavedView[]) => {
    const current = queryClient.getQueryData<DashboardState>(['dashboard']);
    if (!current) return;
    const next = update(current.savedViews);
    queryClient.setQueryData<DashboardState>(['dashboard'], (old) =>
      old ? { ...old, savedViews: next } : old
    );
    await saveSavedViews(next);
  };
  const changeSavedViews = (update: (list: SavedView[]) => SavedView[]) =>
    writeSavedViews(update).catch((err) => {
      showToast(errorMessage(err, 'Saving views failed'));
      void invalidate('dashboard');
    });

  const handleSaveNewView = (name: string) => {
    if ((dashboardState?.savedViews.length ?? 0) >= MAX_SAVED_VIEWS) {
      showToast(`You can save up to ${MAX_SAVED_VIEWS} views; delete one first`);
      return;
    }
    const saved: SavedView = { id: crypto.randomUUID(), name, view, createdAt: Date.now() };
    void changeSavedViews((list) => [...list, saved]);
    setAppliedViewId(saved.id);
    showToast(`Saved view "${name}"`);
  };

  const handleUpdateAppliedView = () => {
    if (!appliedView) return;
    void changeSavedViews((list) => list.map((v) => (v.id === appliedView.id ? { ...v, view } : v)));
    showToast(`Updated view "${appliedView.name}"`);
  };

  const handleApplySavedView = (id: string) => {
    const saved = savedViews.find((v) => v.id === id);
    if (!saved) return;
    const { view: next, notice } = resolveSavedView(saved.view, projects, tasks);
    setView(next);
    setAppliedViewId(id);
    if (notice) showToast(`"${saved.name}": ${notice}`);
  };

  const handleRenameSavedView = (id: string, name: string) =>
    void changeSavedViews((list) => list.map((v) => (v.id === id ? { ...v, name } : v)));

  const handleDeleteSavedView = (id: string) => {
    const saved = savedViews.find((v) => v.id === id);
    if (!saved) return;
    setConfirmRequest({
      title: 'Delete saved view?',
      message: `Saved view "${saved.name}" will be deleted. Its tasks are not affected.\n${UNDO_HINT}`,
      confirmLabel: 'Delete view',
      onConfirm: () => {
        if (appliedViewId === id) setAppliedViewId(null);
        const undo = schedule([id], () => writeSavedViews((list) => list.filter((v) => v.id !== id)));
        showToast(`Deleted view "${saved.name}"`, undo);
      },
    });
  };

  const today = getTodayIso();
  const isCompletedView = activeNav.type === 'smart' && activeNav.id === 'completed';
  const isArchiveView = activeNav.type === 'smart' && activeNav.id === 'archived';

  const taskList = useMemo(
    () => buildTaskList(tasks, view, projects, today),
    [tasks, view, projects, today]
  );
  const {
    filtered: filteredTasks,
    active: activeFilteredTasks,
    completed: completedFilteredTasks,
    sections: groupedSections,
    completedSection,
  } = taskList;

  // Archive has no calendar; a saved view can't select it there, but guard anyway
  const isCalendar = view.layout !== 'list' && !isArchiveView;
  const currentViewTitle =
    isCalendar && activeNav.type === 'smart' && activeNav.id === 'inbox'
      ? 'Calendar'
      : viewTitle(activeNav, projects);

  const visibleOrder = useMemo(
    () => visibleTaskOrder(taskList, showCompleted),
    [taskList, showCompleted]
  );

  const isOverviewPage = activeNav.type === 'smart' && activeNav.id === 'overview';
  const { rowFocusProps } = useTaskListKeyboard({
    tasks,
    visibleOrder,
    enabled: !(confirmRequest || shortcutsOpen || commandPaletteOpen || selectedTaskId || selectedSessionId),
    listShown: !isOverviewPage && !isCalendar,
    onShowShortcuts: () => setShortcutsOpen(true),
    onOpen: setSelectedTaskId,
    onToggle: handleToggleTask,
    onArchive: handleArchiveTask,
    onRestore: handleRestoreTasks,
    onDelete: handleDeleteTask,
    onUpdate: handleUpdateTask,
  });

  const totalActiveCount = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'archived'
  ).length;
  const totalDoneCount = tasks.filter((t) => t.status === 'done').length;

  const backgroundInert = selectedTask !== null || selectedSession !== null || commandPaletteOpen;
  // Drag-to-reorder only makes sense in one flat, manually sorted list
  const canReorder = sortBy === 'manual' && groupBy === 'none';
  // Shared by the full (Overview) and compact (above the task list) widget layouts
  const widgetProps: Omit<React.ComponentProps<typeof DashboardWidgets>, 'mode'> = {
    tasks,
    projects,
    scratchpad,
    quickLinks,
    widgetConfig,
    onSaveScratchpad: (content) => saveScratchpadMutation.mutate(content),
    onConvertLineToTask: handleConvertScratchpadLineToTask,
    onCreateQuickLink: (title, url, category) => createQuickLinkMutation.mutate({ title, url, category }),
    onDeleteQuickLink: handleDeleteQuickLink,
    onUpdateWidgetConfig: (cfg) => saveWidgetConfigMutation.mutate(cfg),
    onSelectSmartView: (v) => setActiveNav({ type: 'smart', id: v }),
  };
  const viewScope =
    activeNav.type === 'smart' && (activeNav.id === 'inbox' || activeNav.id === 'completed')
      ? 'across all projects'
      : `in "${currentViewTitle}"`;

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors">
      {/* Top Header */}
      <header
        inert={backgroundInert}
        className="sticky top-0 z-20 backdrop-blur-md bg-zinc-50/85 dark:bg-zinc-950/85 border-b border-zinc-200/80 dark:border-zinc-800/80">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle sidebar"
              className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              title="Toggle Sidebar"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
              <CheckSquare className="w-4 h-4 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight leading-none">
                Dashboard
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Personal Task Manager
              </p>
            </div>
          </div>

          {/* Search Input in Header */}
          <div className="flex-1 max-w-md mx-2">
            <div className="relative flex items-center">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) =>
                  updateView({
                    search: e.target.value,
                    // Typing a search on the Overview page jumps to the task list
                    ...(isOverviewPage && e.target.value.trim()
                      ? { nav: { type: 'smart', id: 'inbox' } as const }
                      : {}),
                  })
                }
                placeholder="Search tasks, tags, or projects... (Press /)"
                aria-label="Search tasks"
                className="w-full pl-9 pr-8 py-1.5 rounded-lg text-xs sm:text-sm bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-zinc-900 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => updateView({ search: '' })}
                  aria-label="Clear search"
                  className="absolute right-2.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Open command palette"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 hover:border-indigo-400 transition-colors cursor-pointer"
              title="Command Palette (Ctrl+K)"
            >
              <Command className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ctrl+K</span>
            </button>

            <div className="hidden md:flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-200/60 dark:border-zinc-800">
              <span>{totalActiveCount} active</span>
              <span>•</span>
              <span>{totalDoneCount} done</span>
            </div>

            <button
              type="button"
              onClick={() => setAdoImportOpen(true)}
              aria-label="Fetch from Azure DevOps"
              className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              title="Fetch from Azure DevOps"
            >
              <CloudDownload className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle color theme"
              className="p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Body with Sidebar + Main View */}
      <div inert={backgroundInert} className="flex-1 flex min-h-0">
        {sidebarOpen && (
          <Sidebar
            tasks={tasks}
            projects={projects}
            activeNav={activeNav}
            onSelectNav={setActiveNav}
            isCalendar={isCalendar}
            onOpenCalendar={openCalendar}
            onCreateProject={(name, color) =>
              createProjectMutation.mutate({ name, color })
            }
            onUpdateProject={(id, name, color) =>
              updateProjectMutation.mutate({ id, name, color })
            }
            onDeleteProject={handleDeleteProject}
            savedViews={savedViews}
            appliedViewId={appliedViewId}
            onApplySavedView={handleApplySavedView}
            onRenameSavedView={handleRenameSavedView}
            onDeleteSavedView={handleDeleteSavedView}
            claudeAttentionCount={claudeAttentionCount}
          />
        )}

        {/* Main Content */}
        <main className="@container relative flex-1 overflow-y-auto">
          <div className="max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 space-y-6">
          {isOverviewPage ? (
            <>
              <ClaudeSessionsCard
                sessions={claudeSessions}
                tasks={tasks}
                {...claudeSessionActions}
              />
              <DashboardWidgets
                mode="full"
                {...widgetProps}
                onSelectProject={(id) => setActiveNav({ type: 'project', id })}
                taskWidgetActions={{
                  projects,
                  claudeSessionsByTaskId,
                  onToggleTask: handleToggleTask,
                  onOpenTask: claudeSessionActions.onOpenTask,
                  onOpenSession: claudeSessionActions.onOpen,
                }}
                staleTaskDays={settingsData?.settings.staleTaskDays}
                onOpenAdoImport={() => setAdoImportOpen(true)}
              />
            </>
          ) : (
            <>
              {/* Collapsible Summary Widgets Bar above Task Views */}
              <DashboardWidgets
                mode="compact"
                {...widgetProps}
              />

              <TaskListToolbar
                view={view}
                updateView={updateView}
                title={currentViewTitle}
                projects={projects}
                isCalendar={isCalendar}
                activeCount={activeFilteredTasks.length}
                completedCount={completedFilteredTasks.length}
                onArchiveCompleted={() =>
                  requestArchiveCompleted(completedFilteredTasks, 'shown in this view')
                }
                onRestoreAll={() => handleRestoreTasks(activeFilteredTasks)}
                onDeleteAll={() => requestDeleteArchived(activeFilteredTasks)}
                savedViewControls={
                  <SavedViewControls
                    appliedView={appliedView}
                    isModified={appliedView !== null && !sameView(appliedView.view, view)}
                    defaultName={currentViewTitle}
                    onSaveNew={handleSaveNewView}
                    onUpdate={handleUpdateAppliedView}
                  />
                }
              />

              {!isCompletedView && !isArchiveView && (
                <QuickAddBar
                  projects={projects}
                  activeNav={activeNav}
                  projectId={newProjectId}
                  onProjectIdChange={setNewProjectId}
                  onCreate={(input) => createTaskMutation.mutate(input)}
                  isCreating={createTaskMutation.isPending}
                  inputRef={quickAddRef}
                />
              )}

              {/* Error state */}
              {isError && (
                <div className="flex items-center gap-2 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-red-700 dark:text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{(error as Error)?.message || 'Failed to load tasks'}</span>
                </div>
              )}

              {/* Grouped / Active Tasks Sections */}
              {isCalendar ? (
                <CalendarView
                  tasks={filteredTasks}
                  projects={projects}
                  layout={view.layout === 'week' ? 'week' : 'month'}
                  weekStart={weekStartDay}
                  today={today}
                  showCompleted={showCompleted}
                  onToggleShowCompleted={() => setShowCompleted((s) => !s)}
                  onOpenTask={setSelectedTaskId}
                  onReschedule={handleRescheduleTask}
                  onQuickAdd={(text, dueDate) => createTaskFromText(text, newProjectId || null, dueDate)}
                />
              ) : isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-12 rounded-lg bg-zinc-200/50 dark:bg-zinc-900/50 animate-pulse"
                    />
                  ))}
                </div>
              ) : groupedSections.every((g) => g.tasks.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800/80 bg-white/40 dark:bg-zinc-900/20">
                  <div className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-3">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    No tasks match this view
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {searchQuery || priorityFilter !== 'all'
                      ? 'Try clearing your search or priority filter.'
                      : 'Add a task above to get started.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedSections.map((group) => (
                    <section key={group.key} className="space-y-2">
                      <TaskListHeader>
                        <h3>
                          {group.label} ({group.tasks.length})
                        </h3>
                      </TaskListHeader>
                      <ReorderableTaskList
                        tasks={group.tasks}
                        enabled={canReorder}
                        onMove={(taskId, targetIndex) =>
                          handleMoveTask(group.tasks, taskId, targetIndex)
                        }
                        renderRow={(task, dragHandle) => (
                          <TaskRow
                            task={task}
                            projects={projects}
                            claudeSessions={claudeSessionsByTaskId.get(task.id)}
                            onOpenSession={claudeSessionActions.onOpen}
                            isSelected={selectedTaskId === task.id}
                            onSelect={(t) => setSelectedTaskId(t.id)}
                            onToggle={handleToggleTask}
                            onUpdate={handleUpdateTask}
                            onDelete={handleDeleteTask}
                            onArchive={handleArchiveTask}
                            onRestore={(t) => handleRestoreTasks([t])}
                            dragHandle={dragHandle}
                            {...rowFocusProps(task)}
                          />
                        )}
                      />
                    </section>
                  ))}
                </div>
              )}

              {/* Completed Tasks Section */}
              {completedSection && !isCalendar && (
                  <section className="space-y-2 pt-3 border-t border-zinc-200/60 dark:border-zinc-800/60">
                    <div className="flex items-center justify-between px-1">
                      <button
                        type="button"
                        onClick={() => setShowCompleted((s) => !s)}
                        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors cursor-pointer"
                      >
                        {showCompleted ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                        <span>Completed ({completedFilteredTasks.length})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => requestArchiveCompleted(completedFilteredTasks, viewScope)}
                        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        <Archive className="w-3 h-3" />
                        <span>Archive {completedFilteredTasks.length} completed</span>
                      </button>
                    </div>

                    {showCompleted && (
                      <div className="space-y-1.5">
                        {completedFilteredTasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            projects={projects}
                            claudeSessions={claudeSessionsByTaskId.get(task.id)}
                            onOpenSession={claudeSessionActions.onOpen}
                            isSelected={selectedTaskId === task.id}
                            onSelect={(t) => setSelectedTaskId(t.id)}
                            onToggle={handleToggleTask}
                            onUpdate={handleUpdateTask}
                            onDelete={handleDeleteTask}
                            onArchive={handleArchiveTask}
                            onRestore={(t) => handleRestoreTasks([t])}
                            {...rowFocusProps(task)}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )}
            </>
          )}
          </div>
        </main>
      </div>

      <datalist id="tag-suggestions">
        {allTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>

      {/* Slide-over Task Detail Drawer */}
      <TaskDetailDrawer
        task={selectedTask}
        projects={projects}
        onClose={() => setSelectedTaskId(null)}
        onUpdateTask={handleUpdateTask}
        onDeleteTask={handleDeleteTask}
        onCreateSubtask={handleCreateSubtask}
        onUpdateSubtask={handleUpdateSubtask}
        onDeleteSubtask={handleDeleteSubtask}
        claudeSessions={claudeSessionsByTaskId.get(selectedTask?.id ?? '') ?? []}
        claudeSessionActions={claudeSessionActions}
      />

      {/* Slide-over Claude Session Panel */}
      <ClaudeSessionPanel
        session={selectedSession}
        tasks={tasks}
        onClose={() => setSelectedSessionId(null)}
        onOpenTask={claudeSessionActions.onOpenTask}
        onLink={claudeSessionActions.onLink}
        onCreateTask={claudeSessionActions.onCreateTask}
        onToggleCleared={claudeSessionActions.onToggleCleared}
      />

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        projects={projects}
        onSelectNav={setActiveNav}
        onOpenCalendar={openCalendar}
        savedViews={savedViews}
        onApplySavedView={handleApplySavedView}
        onFocusQuickAdd={focusQuickAdd}
        onToggleTheme={toggleTheme}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdoImport={() => setAdoImportOpen(true)}
        onArchiveCompleted={() =>
          requestArchiveCompleted(
            tasks.filter((t) => t.status === 'done'),
            'across all projects'
          )
        }
        onShowShortcuts={() => setShortcutsOpen(true)}
        openTask={selectedTask}
        onToggleArchiveTask={(task) =>
          task.status === 'archived' ? handleRestoreTasks([task]) : handleArchiveTask(task)
        }
        darkMode={darkMode}
      />

      <SettingsPanel
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onChangeTheme={setTheme}
        tasks={tasks}
        projects={projects}
        widgetConfig={widgetConfig}
        onUpdateWidgetConfig={(cfg) => saveWidgetConfigMutation.mutate(cfg)}
        onImportBackup={(payload) => importBackupMutation.mutateAsync(payload)}
        onDeleteArchived={() =>
          requestDeleteArchived(
            tasks.filter((t) => t.status === 'archived'),
            'across all projects'
          )
        }
      />

      <AdoImportDialog
        open={adoImportOpen}
        onClose={() => setAdoImportOpen(false)}
        projects={projects}
        onImported={(count) =>
          showToast(count === 1 ? 'Imported 1 task from Azure DevOps' : `Imported ${count} tasks from Azure DevOps`)
        }
      />

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
};
