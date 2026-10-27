import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  SquareCheckBig,
  Sun,
  Moon,
  ChevronRight,
  AlertCircle,
  Search,
  X,
  Archive,
  Settings,
  CloudDownload,
  LayoutGrid,
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
  updateQuickLink,
  deleteQuickLink,
  importDashboardData,
  saveSavedViews,
  fetchSettings,
  fetchAdoItems,
  deleteNote,
  createNote,
  updateNote,
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
  CreateQuickLinkInput,
  UpdateProjectInput,
  Note,
  UpdateNoteInput,
} from '../shared/types.ts';
import { TaskRow, TaskListHeader } from './components/TaskRow.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TaskDetailDrawer } from './components/TaskDetailDrawer.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { HomeView } from './components/Home.tsx';
import { HomeDrawerProps, WidgetsPanel } from './components/DashboardWidgets.tsx';
import { SettingsPanel, ThemePreference } from './components/SettingsPanel.tsx';
import { AdoImportDialog } from './components/AdoImport.tsx';
import { AdoProjectPanel } from './components/AdoProjectPanel.tsx';
import { ProjectSettingsDialog } from './components/ProjectSettingsDialog.tsx';
import { PomodoroTimer } from './components/PomodoroTimer.tsx';
import { NOTE_TAG_LIST_ID, NotePanel, NotesView, copyNote, noteTags, upsertNote } from './components/Notes.tsx';
import {
  ClaudeIcon,
  ClaudeSessionActions,
  ClaudeSessionPanel,
  ClaudeSessionsSidePanel,
  taskFromSession,
} from './components/ClaudeSessions.tsx';
import { ReorderableTaskList } from './components/ReorderableTaskList.tsx';
import { CalendarView } from './components/CalendarView.tsx';
import { SavedViewControls } from './components/SavedViewControls.tsx';
import { QuickAddBar } from './components/QuickAddBar.tsx';
import { ProjectProgressStrip, TaskListToolbar } from './components/TaskListToolbar.tsx';
import { ContextMenuHost, MenuContent } from './components/ContextMenu.tsx';
import { KBD_CLASS, LABEL_CLASS } from './components/ui.tsx';
import { noteMenuItems, projectMenuItems, taskMenuItems } from './utils/contextMenuItems.ts';
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
const SIDEBAR_KEY = 'dashboard_sidebar_open';
const SIDE_PANEL_KEY = 'dashboard_side_panel';
type SidePanel = 'widgets' | 'claude' | null;

/** Group label colours by section key (due-date and status groups). */
const GROUP_LABEL_COLORS: Record<string, string> = {
  'due-overdue': 'text-red-600 dark:text-red-400',
  'due-today': 'text-emerald-600 dark:text-emerald-300',
  'due-tomorrow': 'text-indigo-600 dark:text-indigo-300',
  'due-none': 'text-zinc-500',
  'status-in_progress': 'text-(--in-progress)',
  'status-on_hold': 'text-slate-500 dark:text-slate-400',
};

/** "› Later 6": a collapsible list toggle in the task list footer. */
const FooterToggle: React.FC<{ label: string; count: number; open: boolean; onToggle: () => void }> = ({
  label,
  count,
  open,
  onToggle,
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer"
  >
    <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
    <span>{label}</span>
    <span className="text-zinc-400 dark:text-zinc-600">{count}</span>
  </button>
);

export const App: React.FC = () => {
  const queryClient = useQueryClient();

  // Sidebar & Navigation state
  // Below 900px the sidebar is an overlay, so it starts closed there
  const [sidebarOpen, setSidebarOpen] = useState(
    () => window.innerWidth >= 900 && localStorage.getItem(SIDEBAR_KEY) !== '0'
  );
  // Below 900px the sidebar overlays the page, so picking a view closes it
  const closeOverlaySidebar = () => {
    if (window.innerWidth < 900) setSidebarOpen(false);
  };
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      localStorage.setItem(SIDEBAR_KEY, open ? '0' : '1');
      return !open;
    });
  }, []);
  // Right-hand docked panel: Widgets or Claude sessions, one at a time
  const [sidePanel, setSidePanel] = useState<SidePanel>(() => localStorage.getItem(SIDE_PANEL_KEY) as SidePanel);
  const toggleSidePanel = (panel: Exclude<SidePanel, null>) => {
    const next = sidePanel === panel ? null : panel;
    if (next) localStorage.setItem(SIDE_PANEL_KEY, next);
    else localStorage.removeItem(SIDE_PANEL_KEY);
    setSidePanel(next);
  };
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
  // The note open in the side panel on the Notes page; id null while a new note is still empty.
  // key changes only when another note is opened, so creating a note keeps the editor mounted.
  const [notePanel, setNotePanel] = useState<{ key: number; id: string | null } | null>(null);
  const openNote = (id: string | null) => setNotePanel((p) => ({ key: (p?.key ?? 0) + 1, id }));
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
  // The "Later" due-date bucket (over 7 days out) starts collapsed
  const [showLater, setShowLater] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adoImportOpen, setAdoImportOpen] = useState(false);
  const [projectSettingsId, setProjectSettingsId] = useState<string | null>(null);
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
      (activeNav.id === 'overview' ||
        activeNav.id === 'completed' ||
        activeNav.id === 'archived' ||
        activeNav.id === 'notes')
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
    dialogOpen:
      confirmRequest !== null || shortcutsOpen || settingsOpen || adoImportOpen || projectSettingsId !== null,
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
    toggleSidebar,
  });

  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const defaultProjectId = settingsData?.settings.defaultProjectId ?? '';
  const weekStartDay = settingsData?.settings.weekStartDay ?? 1;
  const inProgressColor = settingsData?.settings.inProgressColor;
  const chaseHoldDays = settingsData?.settings.chaseHoldDays ?? 7;
  useEffect(() => {
    if (inProgressColor) document.documentElement.style.setProperty('--in-progress', inProgressColor);
  }, [inProgressColor]);
  const density = settingsData?.settings.density;
  useEffect(() => {
    if (density) document.documentElement.dataset.density = density;
  }, [density]);

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
    handleSetStatus,
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
    mutationFn: ({ id, ...input }: { id: string } & UpdateProjectInput) => updateProject(id, input),
    onSuccess: async (_project, input) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      // Switching Azure DevOps changes which projects a check covers
      if (input.adoEnabled !== undefined) {
        queryClient.setQueryData(['adoItems'], await fetchAdoItems(true).catch(() => undefined));
      }
    },
    onError: (err) => showToast(errorMessage(err, 'Updating project failed')),
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

  const updateQuickLinkMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateQuickLinkInput }) => updateQuickLink(id, input),
    onError: (err) => showToast(errorMessage(err, 'Updating link failed')),
    onSettled: () => invalidate('dashboard'),
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

  const laterSection = groupedSections.find((s) => s.key === 'due-later') ?? null;
  const shownSections = showLater ? groupedSections : groupedSections.filter((s) => s !== laterSection);
  const visibleOrder = visibleTaskOrder({ ...taskList, sections: shownSections }, showCompleted);

  const isOverviewPage = activeNav.type === 'smart' && activeNav.id === 'overview';
  const isNotesPage = activeNav.type === 'smart' && activeNav.id === 'notes';
  // The note panel belongs to the Notes page
  useEffect(() => {
    if (!isNotesPage) setNotePanel(null);
  }, [isNotesPage]);
  const handleNewNote = () => {
    setActiveNav({ type: 'smart', id: 'notes' });
    openNote(null);
  };
  const handleDeleteNote = (note: Note) => {
    setNotePanel(null);
    const undo = schedule([note.id], async () => {
      await deleteNote(note.id);
      await invalidate('notes');
    });
    showToast(`Deleted "${note.title || 'Untitled note'}"`, undo);
  };
  const saveNote = (id: string, patch: UpdateNoteInput) =>
    updateNote(id, patch).then(
      (note) => upsertNote(queryClient, note),
      (err) => showToast(errorMessage(err, 'Saving note failed'))
    );
  const handleDuplicateNote = (note: Note) =>
    createNote({
      title: note.title ? `${note.title} (copy)`.slice(0, 200) : '',
      body: note.body,
      color: note.color,
      tags: note.tags,
    }).then(
      (copy) => {
        upsertNote(queryClient, copy);
        openNote(copy.id);
      },
      (err) => showToast(errorMessage(err, 'Duplicating note failed'))
    );
  const currentProject =
    activeNav.type === 'project' ? projects.find((p) => p.id === activeNav.id) : undefined;
  const showAdoImported = (count: number, linked: boolean) =>
    showToast(
      linked
        ? `Linked ${count === 1 ? '1 Azure DevOps item' : `${count} Azure DevOps items`} to the task`
        : count === 1
          ? 'Imported 1 task from Azure DevOps'
          : `Imported ${count} tasks from Azure DevOps`
    );
  const { rowFocusProps, startEditing } = useTaskListKeyboard({
    tasks,
    visibleOrder,
    enabled: !(confirmRequest || shortcutsOpen || commandPaletteOpen || selectedTaskId || selectedSessionId),
    listShown: !isOverviewPage && !isNotesPage && !isCalendar,
    onShowShortcuts: () => setShortcutsOpen(true),
    onOpen: setSelectedTaskId,
    onToggle: handleToggleTask,
    onArchive: handleArchiveTask,
    onRestore: handleRestoreTasks,
    onDelete: handleDeleteTask,
    onUpdate: handleUpdateTask,
  });

  // Right-click menus: list rows rename inline; calendar and widget entries open the drawer instead
  const resolveContextMenu = (target: HTMLElement): MenuContent | null => {
    const noteId = target.closest<HTMLElement>('[data-menu-note]')?.dataset.menuNote;
    const notes = queryClient.getQueryData<Note[]>(['notes']) ?? [];
    const note = notes.find((n) => n.id === noteId);
    if (note) {
      return {
        label: note.title || 'Untitled note',
        items: noteMenuItems(note, {
          allTags: noteTags(notes),
          tagListId: NOTE_TAG_LIST_ID,
          onOpen: openNote,
          onUpdate: saveNote,
          onCopy: (n, rich) =>
            copyNote(n, rich).then(
              () => showToast(rich ? 'Copied as rich text' : 'Copied markdown'),
              () => showToast('Copying failed')
            ),
          onDuplicate: handleDuplicateNote,
          onDelete: handleDeleteNote,
        }),
      };
    }
    const projectId = target.closest<HTMLElement>('[data-menu-project]')?.dataset.menuProject;
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      return {
        label: project.name,
        items: projectMenuItems(
          project,
          (id, name, color) => updateProjectMutation.mutate({ id, name, color }),
          handleDeleteProject,
          setProjectSettingsId
        ),
      };
    }
    const entry = target.closest<HTMLElement>('[data-task-row], [data-menu-task]');
    const task = tasks.find((t) => t.id === (entry?.dataset.taskRow ?? entry?.dataset.menuTask));
    if (!entry || !task) return null;
    const isListRow = entry.dataset.taskRow !== undefined;
    return {
      label: task.title,
      items: taskMenuItems(task, entry.dataset.menuGhost !== undefined, {
        projects,
        onOpen: setSelectedTaskId,
        onRename: isListRow ? startEditing : setSelectedTaskId,
        onSetStatus: handleSetStatus,
        onUpdate: handleUpdateTask,
        onReschedule: handleRescheduleTask,
        onCopyTitle: (t) =>
          navigator.clipboard.writeText(t.title).then(
            () => showToast(`Copied "${t.title}"`),
            () => showToast('Copying failed')
          ),
        onArchive: handleArchiveTask,
        onRestore: (t) => handleRestoreTasks([t]),
        onDelete: handleDeleteTask,
      }),
    };
  };

  const backgroundInert = selectedTask !== null || selectedSession !== null || commandPaletteOpen;
  // Shared by Home's bottom drawer and the Widgets panel
  const widgetProps: HomeDrawerProps = {
    tasks,
    widgetConfig,
    taskWidgetActions: {
      projects,
      claudeSessionsByTaskId,
      onToggleTask: handleToggleTask,
      onOpenTask: claudeSessionActions.onOpenTask,
      onOpenSession: claudeSessionActions.onOpen,
    },
    projects,
    scratchpad,
    quickLinks,
    staleTaskDays: settingsData?.settings.staleTaskDays ?? 14,
    onSaveScratchpad: (content) => saveScratchpadMutation.mutate(content),
    onConvertLineToTask: handleConvertScratchpadLineToTask,
    onCreateQuickLink: (title, url, category) => createQuickLinkMutation.mutate({ title, url, category }),
    onUpdateQuickLink: (id, title, url, category) =>
      updateQuickLinkMutation.mutate({ id, input: { title, url, category } }),
    onDeleteQuickLink: handleDeleteQuickLink,
    onSelectProject: (id) => setActiveNav({ type: 'project', id }),
    onOpenAdoImport: () => setAdoImportOpen(true),
  };
  // Drag-to-reorder only makes sense in one flat, manually sorted list
  const canReorder = sortBy === 'manual' && groupBy === 'none';
  // Shared by the full (Overview) and compact (above the task list) widget layouts
  const projectStats = useMemo(() => {
    if (!currentProject) return null;
    const own = tasks.filter((t) => t.projectId === currentProject.id && t.status !== 'archived');
    const ownIds = new Set(own.map((t) => t.id));
    const waiting = claudeSessions.find(
      (s) => s.state === 'needs_attention' && !s.dismissedAt && s.taskId !== null && ownIds.has(s.taskId)
    );
    return {
      done: own.filter((t) => t.status === 'done').length,
      total: own.length,
      overdue: own.filter((t) => t.status !== 'done' && t.dueDate !== null && t.dueDate < today).length,
      waitingSessionId: waiting?.sessionId ?? null,
    };
  }, [currentProject, tasks, claudeSessions, today]);
  const listMeta = isCompletedView
    ? plural(completedFilteredTasks.length, 'completed task')
    : isArchiveView
    ? plural(activeFilteredTasks.length, 'archived task')
    : currentProject
    ? `${activeFilteredTasks.length} open`
    : `${plural(activeFilteredTasks.length, 'task')} · ${plural(
        new Set(activeFilteredTasks.map((t) => t.projectId).filter(Boolean)).size,
        'project'
      )}`;
  const viewScope =
    activeNav.type === 'smart' && (activeNav.id === 'inbox' || activeNav.id === 'completed')
      ? 'across all projects'
      : `in "${currentViewTitle}"`;

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 transition-colors">
      {/* Top Header */}
      <header
        inert={backgroundInert}
        className="h-[52px] shrink-0 px-5 flex items-center gap-4 border-b border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50 dark:bg-zinc-950"
      >
        {/* Brand block lines up with the sidebar edge; the logo toggles the sidebar */}
        <div className="w-[212px] shrink-0 flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen}
            title={`${sidebarOpen ? 'Collapse' : 'Expand'} sidebar ([)`}
            className="w-7 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition-colors duration-150 cursor-pointer"
          >
            <SquareCheckBig className="w-[15px] h-[15px]" />
          </button>
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-100">Dashboard</h1>
        </div>

        {/* Search; Ctrl+K opens the command palette */}
        <div className="flex-1 max-w-[560px] h-8 px-2.5 flex items-center gap-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus-within:border-indigo-500/60 text-[13px] text-zinc-500 transition-colors duration-150">
          <Search className="w-3.5 h-3.5 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) =>
              updateView({
                search: e.target.value,
                // Typing a search on Home jumps to the task list; on Notes it filters notes
                ...(isOverviewPage && e.target.value.trim()
                  ? { nav: { type: 'smart', id: 'inbox' } as const }
                  : {}),
              })
            }
            placeholder={isNotesPage ? 'Search notes…' : 'Search tasks or run a command…'}
            aria-label={isNotesPage ? 'Search notes' : 'Search tasks'}
            className="flex-1 min-w-0 bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => updateView({ search: '' })}
              aria-label="Clear search"
              className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <>
              <kbd className={KBD_CLASS}>/</kbd>
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Open command palette"
                title="Command palette (Ctrl+K)"
                className="cursor-pointer"
              >
                <kbd className={KBD_CLASS}>Ctrl K</kbd>
              </button>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <PomodoroTimer />
          {(
            [
              ['widgets', 'Widgets', <LayoutGrid className="w-4 h-4" />],
              ['claude', 'Claude sessions', <ClaudeIcon className="w-4 h-4" />],
            ] as const
          ).map(([panel, label, icon]) => (
            <button
              key={panel}
              type="button"
              onClick={() => toggleSidePanel(panel)}
              aria-label={
                panel === 'claude' && claudeAttentionCount > 0 ? `${label}, ${claudeAttentionCount} need attention` : label
              }
              aria-pressed={sidePanel === panel}
              title={`${sidePanel === panel ? 'Hide' : 'Show'} ${label}`}
              className={`relative p-2 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer ${
                sidePanel === panel ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {icon}
              {panel === 'claude' && claudeAttentionCount > 0 && (
                <span
                  aria-hidden
                  className="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-amber-400 text-zinc-900 text-[9px] font-bold leading-3.5 text-center"
                >
                  {claudeAttentionCount}
                </span>
              )}
            </button>
          ))}
          {(
            [
              ['Fetch from Azure DevOps', CloudDownload, () => setAdoImportOpen(true)],
              ['Settings', Settings, () => setSettingsOpen(true)],
              [darkMode ? 'Switch to light mode' : 'Switch to dark mode', darkMode ? Sun : Moon, toggleTheme],
            ] as const
          ).map(([label, Icon, onClick]) => (
            <button
              key={label}
              type="button"
              onClick={onClick}
              aria-label={label}
              title={label}
              className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200/60 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer"
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>
      </header>

      {/* Body with Sidebar + Main View */}
      <div inert={backgroundInert} className="flex-1 flex min-h-0">
        {sidebarOpen && (
          <Sidebar
            tasks={tasks}
            projects={projects}
            activeNav={activeNav}
            onSelectNav={(nav) => {
              setActiveNav(nav);
              closeOverlaySidebar();
            }}
            isCalendar={isCalendar}
            onOpenCalendar={() => {
              openCalendar();
              closeOverlaySidebar();
            }}
            onCreateProject={(name, color) =>
              createProjectMutation.mutate({ name, color })
            }
            onOpenProjectSettings={setProjectSettingsId}
            onDeleteProject={handleDeleteProject}
            savedViews={savedViews}
            appliedViewId={appliedViewId}
            onApplySavedView={handleApplySavedView}
            onRenameSavedView={handleRenameSavedView}
            onDeleteSavedView={handleDeleteSavedView}
            claudeAttentionCount={claudeAttentionCount}
            chaseHoldDays={chaseHoldDays}
          />
        )}

        {/* Main Content */}
        <main className="relative flex-1 min-w-0 overflow-y-auto">
          <div
            className={`px-10 max-[900px]:px-5 flex flex-col ${
              isOverviewPage ? 'py-7 gap-[22px] min-h-full' : 'py-6 gap-3.5'
            }`}
          >
          {isNotesPage ? (
            <NotesView
              search={searchQuery}
              hiddenIds={pendingIds}
              selectedId={notePanel?.id ?? null}
              onOpen={openNote}
              onNew={() => openNote(null)}
              showToast={showToast}
            />
          ) : isOverviewPage ? (
            <HomeView
              tasks={tasks}
              claudeSessions={claudeSessions}
              claudeSessionActions={claudeSessionActions}
              taskWidgetActions={widgetProps.taskWidgetActions}
              widgetConfig={widgetConfig}
              onOpenOverdue={() => setActiveNav({ type: 'smart', id: 'today' })}
              drawer={widgetProps}
            />
          ) : (
            <>
              <TaskListToolbar
                view={view}
                updateView={updateView}
                title={currentViewTitle}
                meta={listMeta}
                projectColor={currentProject?.color}
                isCalendar={isCalendar}
                activeCount={activeFilteredTasks.length}
                onRestoreAll={() => handleRestoreTasks(activeFilteredTasks)}
                onDeleteAll={() => requestDeleteArchived(activeFilteredTasks)}
                completedCount={completedFilteredTasks.length}
                onArchiveCompleted={() => requestArchiveCompleted(completedFilteredTasks, 'shown in this view')}
                onOpenProjectSettings={currentProject && (() => setProjectSettingsId(currentProject.id))}
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

              {currentProject && projectStats && (
                <>
                  <ProjectProgressStrip
                    color={currentProject.color}
                    {...projectStats}
                    onOpenWaitingSession={
                      projectStats.waitingSessionId
                        ? () => claudeSessionActions.onOpen(projectStats.waitingSessionId!)
                        : undefined
                    }
                  />
                  <AdoProjectPanel
                    key={currentProject.id}
                    project={currentProject}
                    tasks={tasks}
                    onImported={showAdoImported}
                  />
                </>
              )}

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
                <div className="flex flex-col gap-1.5 pt-1.5">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="h-9 rounded-md bg-zinc-200/60 dark:bg-zinc-900 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div>
                  <TaskListHeader showProject={!currentProject} />
                  {groupedSections.every((g) => g.tasks.length === 0) ? (
                    <p className="py-10 text-center text-[13px] text-zinc-500 border-t border-zinc-200/70 dark:border-zinc-800/50 mt-1.5">
                      {searchQuery || priorityFilter !== 'all'
                        ? 'No tasks match these filters.'
                        : isCompletedView
                        ? 'No completed tasks.'
                        : isArchiveView
                        ? 'The archive is empty.'
                        : 'No active tasks. Add one above.'}
                    </p>
                  ) : (
                    shownSections.map((group) => (
                      <section key={group.key} aria-label={groupBy === 'none' ? undefined : group.label}>
                        {groupBy !== 'none' && (
                          <div className="flex items-center">
                            <h3 className={`px-2 pt-3 pb-1.5 ${LABEL_CLASS} ${GROUP_LABEL_COLORS[group.key] ?? 'text-zinc-600 dark:text-zinc-400'}`}>
                              {group.label}{' '}
                              <span className="ml-1 font-normal text-zinc-400 dark:text-zinc-600">{group.tasks.length}</span>
                            </h3>
                            {/* Completed view has this in the toolbar */}
                            {group.key === 'status-done' && !isCompletedView && (
                              <button
                                type="button"
                                onClick={() => requestArchiveCompleted(group.tasks, viewScope)}
                                className="ml-auto mt-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer"
                              >
                                <Archive className="w-3 h-3" />
                                <span>Archive completed</span>
                              </button>
                            )}
                          </div>
                        )}
                        <ReorderableTaskList
                          tasks={group.tasks}
                          enabled={canReorder}
                          onMove={(taskId, targetIndex) => handleMoveTask(group.tasks, taskId, targetIndex)}
                          renderRow={(task, dragHandle) => (
                            <TaskRow
                              chaseHoldDays={chaseHoldDays}
                              task={task}
                              projects={projects}
                              showProject={!currentProject}
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
                    ))
                  )}

                  {/* Footer: Later and Completed toggles, and Archive completed */}
                  {(laterSection || completedSection) && (
                    <div className="flex items-center gap-2 p-2 border-t border-zinc-200/70 dark:border-zinc-800/50 text-xs text-zinc-500">
                      {laterSection && (
                        <FooterToggle
                          label="Later"
                          count={laterSection.tasks.length}
                          open={showLater}
                          onToggle={() => setShowLater((s) => !s)}
                        />
                      )}
                      {completedSection && (
                        <FooterToggle
                          label="Completed"
                          count={completedFilteredTasks.length}
                          open={showCompleted}
                          onToggle={() => setShowCompleted((s) => !s)}
                        />
                      )}
                      {completedSection && (
                        <button
                          type="button"
                          onClick={() => requestArchiveCompleted(completedFilteredTasks, viewScope)}
                          className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors duration-150 cursor-pointer"
                        >
                          <Archive className="w-3 h-3" />
                          <span>Archive completed</span>
                        </button>
                      )}
                    </div>
                  )}

                  {completedSection && showCompleted && (
                    <div>
                      {completedFilteredTasks.map((task) => (
                        <TaskRow
                          chaseHoldDays={chaseHoldDays}
                          key={task.id}
                          task={task}
                          projects={projects}
                          showProject={!currentProject}
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
                </div>
              )}
            </>
          )}
          </div>
        </main>

        {notePanel ? (
          <NotePanel
            key={notePanel.key}
            noteId={notePanel.id}
            onCreated={(id) => setNotePanel((p) => p && { ...p, id })}
            onDelete={handleDeleteNote}
            onClose={() => setNotePanel(null)}
            showToast={showToast}
          />
        ) : sidePanel === 'widgets' ? (
          <WidgetsPanel {...widgetProps} onClose={() => toggleSidePanel('widgets')} />
        ) : sidePanel === 'claude' ? (
          <ClaudeSessionsSidePanel
            sessions={claudeSessions}
            tasks={tasks}
            onClose={() => toggleSidePanel('claude')}
            {...claudeSessionActions}
          />
        ) : null}
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
        onSetStatus={handleSetStatus}
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
        onToggleSidebar={toggleSidebar}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdoImport={() => setAdoImportOpen(true)}
        onNewNote={handleNewNote}
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
        tasks={tasks}
        onImported={showAdoImported}
      />

      <ProjectSettingsDialog
        project={projects.find((p) => p.id === projectSettingsId) ?? null}
        onClose={() => setProjectSettingsId(null)}
        onUpdate={(id, input) => updateProjectMutation.mutate({ id, ...input })}
      />

      <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
      <ContextMenuHost resolve={resolveContextMenu} />
    </div>
  );
};
