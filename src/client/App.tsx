import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Plus,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  Sparkles,
  AlertCircle,
  Search,
  Layers,
  ArrowUpDown,
  Flag,
  Folder,
  Calendar,
  Tag,
  X,
  PanelLeft,
  Command,
  Trash2,
  Archive,
  ArchiveRestore,
  Repeat,
  Settings,
  CloudDownload,
  List,
  CalendarDays,
  CalendarRange,
} from 'lucide-react';
import {
  fetchTasks,
  createTask,
  updateTask,
  deleteTask,
  archiveTasks,
  restoreTasks,
  deleteTasks,
  reorderTasks,
  createSubtask,
  updateSubtask,
  deleteSubtask,
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
  TaskPriority,
  UpdateTaskInput,
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
import {
  ConfirmDialog,
  ConfirmRequest,
  ShortcutsDialog,
  Toast,
  ToastState,
} from './components/Feedback.tsx';
import { DeferredHandle, useDeferredDelete } from './utils/useDeferredDelete.ts';
import { describeRecurrence, nextOccurrence } from '../shared/recurrence.ts';
import {
  ActiveNavigation,
  DEFAULT_VIEW_STATE,
  GroupByOption,
  SortByOption,
  ViewState,
  buildTaskList,
  resolveSavedView,
  sameView,
  viewTitle,
  visibleTaskOrder,
} from './utils/taskView.ts';
import {
  PRIORITY_CONFIG,
  formatDayDate,
  getTodayIso,
  parseQuickAddSyntax,
  sortOrderForMove,
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

  // Keyboard navigation of the task list (roving focus) and inline rename
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const lastFocusIndex = useRef(0);
  /** `undo` is a plain callback, or a deferred-delete handle (whose commit pauses with the toast). */
  const showToast = (message: string, undo?: (() => void) | DeferredHandle) =>
    setToast(
      typeof undo === 'function' || undo === undefined
        ? { message, onUndo: undo }
        : { message, onUndo: undo.undo, onPause: undo.pause, onResume: undo.resume }
    );

  // Quick-add form state
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>(0);
  const [newProjectId, setNewProjectId] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [newTags, setNewTags] = useState<string[]>([]);

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

  // Global Keyboard Shortcuts (N/C for Quick-Add, / for Search, Ctrl+K for Command Palette, Escape to close Drawer)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Native <dialog>s handle their own keys (Esc cancels).
      if (confirmRequest || shortcutsOpen || settingsOpen || adoImportOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      // Ctrl/Cmd+Z undoes the action in the toast, unless the user is editing text
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z' &&
        !isInputFocused &&
        toast?.onUndo
      ) {
        e.preventDefault();
        toast.onUndo();
        setToast(null);
        return;
      }

      // Leave browser/OS shortcuts (Ctrl+C, Ctrl+N, ...) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (selectedTaskId && !isInputFocused) {
          setSelectedTaskId(null);
          return;
        }
      }

      if (isInputFocused || commandPaletteOpen) return;

      if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'c') {
        e.preventDefault();
        focusQuickAdd();
      } else if (e.key === '/') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [commandPaletteOpen, selectedTaskId, focusQuickAdd, confirmRequest, shortcutsOpen, settingsOpen, adoImportOpen, toast]);

  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const defaultProjectId = settingsData?.settings.defaultProjectId ?? '';
  const weekStartDay = settingsData?.settings.weekStartDay ?? 1;

  // Quick-add defaults follow the current view (else the settings default), and reset when leaving it
  useEffect(() => {
    setNewProjectId(activeNav.type === 'project' ? activeNav.id : defaultProjectId);
    setNewDueDate(activeNav.type === 'smart' && activeNav.id === 'today' ? getTodayIso() : '');
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
    showToast(err instanceof Error ? err.message : 'Delete failed');
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

  // Task Mutations
  const createTaskMutation = useMutation({
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateTaskInput }) =>
      updateTask(id, payload),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData<Task[]>(['tasks']);
      if (previous) {
        queryClient.setQueryData<Task[]>(
          ['tasks'],
          previous.map((t) => (t.id === id ? { ...t, ...payload } : t))
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['tasks'], context.previous);
      }
    },
    onSuccess: (result) => {
      if (result.keptOccurrenceId) {
        showToast('Its next occurrence was already edited, so it was kept');
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // Subtask Mutations
  const createSubtaskMutation = useMutation({
    mutationFn: ({ taskId, title }: { taskId: string; title: string }) =>
      createSubtask(taskId, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const updateSubtaskMutation = useMutation({
    mutationFn: ({
      subtaskId,
      isCompleted,
    }: {
      subtaskId: string;
      isCompleted: boolean;
    }) => updateSubtask(subtaskId, { isCompleted }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
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
    onError: (err) => showToast(err instanceof Error ? err.message : 'Updating session failed'),
    onSettled: () => invalidate('claudeSessions'),
  });
  const selectedSession = claudeSessions.find((s) => s.sessionId === selectedSessionId) ?? null;

  const claudeSessionActions: ClaudeSessionActions = {
    onOpen: (sessionId) => {
      setSelectedTaskId(null);
      setSelectedSessionId(sessionId);
    },
    onLink: (sessionId, taskId) => updateClaudeSessionMutation.mutate({ sessionId, input: { taskId } }),
    // Create a task from the session, link them, and open the task to fill in the details
    onCreateTask: async (session: ClaudeSession) => {
      try {
        const task = await createTaskMutation.mutateAsync(taskFromSession(session));
        await updateClaudeSessionMutation.mutateAsync({
          sessionId: session.sessionId,
          input: { taskId: task.id },
        });
        setSelectedSessionId(null);
        setSelectedTaskId(task.id);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Creating task failed');
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

  const handleAddQuickTag = () => {
    const cleaned = newTagInput.trim().replace(/^#/, '');
    if (cleaned && !newTags.includes(cleaned)) {
      setNewTags((prev) => [...prev, cleaned]);
    }
    setNewTagInput('');
  };

  /** What the quick-add bar would create: typed tokens applied on top of the pickers. */
  const parseNewTask = (rawTitle: string) => {
    const pendingTag = newTagInput.trim().replace(/^#/, '');
    const baseTags =
      pendingTag && !newTags.includes(pendingTag) ? [...newTags, pendingTag] : newTags;
    return parseQuickAddSyntax(rawTitle.trim(), projects, {
      priority: newPriority,
      projectId: newProjectId || null,
      dueDate: newDueDate || null,
      tags: baseTags,
    });
  };
  const newTaskPreview = newTitle.trim() ? parseNewTask(newTitle) : null;

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const parsed = parseNewTask(newTitle);

    createTaskMutation.mutate({
      title: parsed.title,
      priority: parsed.priority,
      projectId: parsed.projectId,
      dueDate: parsed.dueDate,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    });

    setNewTitle('');
    setNewTagInput('');
    setNewTags([]);
  };

  /** Creates a task from quick-add text; typed tokens win over the given project and due date. */
  const createTaskFromText = (text: string, projectId: string | null, dueDate: string | null) => {
    const parsed = parseQuickAddSyntax(text, projects, { priority: 0, projectId, dueDate, tags: [] });
    createTaskMutation.mutate({
      title: parsed.title,
      priority: parsed.priority,
      projectId: parsed.projectId,
      dueDate: parsed.dueDate,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    });
  };

  const handleConvertScratchpadLineToTask = (lineText: string) => createTaskFromText(lineText, null, null);

  const handleRescheduleTask = (task: Task, dueDate: string) => {
    const previous = task.dueDate;
    updateTaskMutation.mutate({ id: task.id, payload: { dueDate } });
    showToast(`Moved "${task.title}" to ${formatDayDate(dueDate)}`, () =>
      updateTaskMutation.mutate({ id: task.id, payload: { dueDate: previous } })
    );
  };

  /** Cycles status on checkbox click: To Do → In Progress → Completed → To Do. */
  const handleToggleTask = (task: Task) => {
    if (task.status === 'done') {
      updateTaskMutation.mutate({ id: task.id, payload: { status: 'todo' } });
      return;
    }
    if (task.status === 'todo') {
      updateTaskMutation.mutate({ id: task.id, payload: { status: 'in_progress' } });
      return;
    }
    const previous = task.status === 'in_progress' ? 'in_progress' : 'todo';
    updateTaskMutation.mutate({ id: task.id, payload: { status: 'done' } });
    const nextDue = task.recurrence
      ? ` · next due ${formatDayDate(nextOccurrence(task.recurrence, task.dueDate, getTodayIso()))}`
      : '';
    // Undo reopens the task; the server then also withdraws the untouched next occurrence
    showToast(`Completed "${task.title}"${nextDue}`, () =>
      updateTaskMutation.mutate({ id: task.id, payload: { status: previous } })
    );
  };

  /** Manual sort: give the moved task a sortOrder between its new neighbours. */
  const handleMoveTask = (list: Task[], taskId: string, targetIndex: number) => {
    const moved = list.find((t) => t.id === taskId);
    if (!moved) return;
    const others = list.filter((t) => t.id !== taskId);
    const order = sortOrderForMove(
      others.map((t) => t.sortOrder),
      targetIndex
    );
    if (order !== null) {
      updateTaskMutation.mutate({ id: taskId, payload: { sortOrder: order } });
      return;
    }
    // No gap between the neighbours (e.g. imported tasks sharing an order): respace this list
    // on the server in one transaction.
    const reordered = [...others.slice(0, targetIndex), moved, ...others.slice(targetIndex)];
    reorderTasks(reordered.map((t) => t.id)).then(
      () => invalidate('tasks'),
      (err) => showToast(err instanceof Error ? err.message : 'Reorder failed')
    );
  };

  const handleUpdateTask = (id: string, payload: UpdateTaskInput) => {
    updateTaskMutation.mutate({ id, payload });
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const UNDO_HINT = 'You can undo this for a few seconds afterwards.';

  const handleDeleteTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const subtaskNote = task.subtasks.length
      ? ` and its ${plural(task.subtasks.length, 'subtask')}`
      : '';
    setConfirmRequest({
      title: 'Delete task?',
      message: `"${task.title}"${subtaskNote} will be permanently deleted.\n${UNDO_HINT}`,
      confirmLabel: 'Delete task',
      onConfirm: () => {
        if (selectedTaskId === id) setSelectedTaskId(null);
        const undo = schedule([id], async () => {
          await deleteTask(id);
          await invalidate('tasks');
        });
        showToast(`Deleted "${task.title}"`, undo);
      },
    });
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    // Subtasks are low-stakes: undo only, no confirmation step.
    const undo = schedule([subtaskId], async () => {
      await deleteSubtask(subtaskId);
      await invalidate('tasks');
    });
    showToast('Subtask deleted', undo);
  };

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
      showToast(err instanceof Error ? err.message : 'Saving views failed');
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

  const runRestore = async (ids: string[]) => {
    await restoreTasks(ids);
    await invalidate('tasks');
  };

  const runArchive = async (ids: string[], message: string) => {
    try {
      await archiveTasks(ids);
      await invalidate('tasks');
      showToast(message, () => void runRestore(ids));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Archive failed');
    }
  };

  const handleArchiveTask = (task: Task) => {
    if (selectedTaskId === task.id) setSelectedTaskId(null);
    void runArchive([task.id], `Archived "${task.title}"`);
  };

  const handleRestoreTasks = (list: Task[]) => {
    runRestore(list.map((t) => t.id)).then(
      () =>
        showToast(
          list.length === 1 ? `Restored "${list[0].title}"` : `Restored ${plural(list.length, 'task')}`
        ),
      (err) => showToast(err instanceof Error ? err.message : 'Restore failed')
    );
  };

  /** Archives the given completed tasks after a confirmation that names the scope. */
  const requestArchiveCompleted = (completed: Task[], scope: string) => {
    if (completed.length === 0) {
      showToast('There are no completed tasks to archive');
      return;
    }
    const count = plural(completed.length, 'completed task');
    setConfirmRequest({
      title: 'Archive completed tasks?',
      message:
        `${count} ${scope} will be moved to the Archive.\n` +
        'They are hidden from other views but not deleted: you can restore them, ' +
        'or delete them permanently, from Archive.',
      confirmLabel: `Archive ${completed.length}`,
      onConfirm: () =>
        void runArchive(
          completed.map((t) => t.id),
          `Archived ${count}`
        ),
    });
  };

  const requestDeleteArchived = (archived: Task[], scope = 'shown in this view') => {
    const count = plural(archived.length, 'archived task');
    setConfirmRequest({
      title: 'Permanently delete archived tasks?',
      message:
        `${count} ${scope} (and their subtasks) will be permanently deleted.\n` +
        UNDO_HINT,
      confirmLabel: `Delete ${archived.length}`,
      onConfirm: () => {
        const ids = archived.map((t) => t.id);
        const undo = schedule(ids, async () => {
          await deleteTasks(ids);
          await invalidate('tasks');
        });
        showToast(`Deleted ${count}`, undo);
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

  const focusTask = (id: string) => {
    setFocusedTaskId(id);
    const row = document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(id)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  };

  // When the focused row leaves the list (deleted, archived, view changed), hand focus to the
  // row now at its position. Only take DOM focus if it was lost with the row.
  useEffect(() => {
    if (!focusedTaskId) return;
    const index = visibleOrder.indexOf(focusedTaskId);
    if (index !== -1) {
      lastFocusIndex.current = index;
      return;
    }
    const next = visibleOrder[Math.min(lastFocusIndex.current, visibleOrder.length - 1)];
    if (next && (!document.activeElement || document.activeElement === document.body)) {
      focusTask(next);
    } else {
      setFocusedTaskId(next ?? null);
    }
  }, [visibleOrder, focusedTaskId]);

  const tabStopId =
    focusedTaskId && visibleOrder.includes(focusedTaskId) ? focusedTaskId : visibleOrder[0];

  // List shortcuts. Actions apply to the row that has DOM focus. Re-subscribed every render so
  // the handler always sees current state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (confirmRequest || shortcutsOpen || commandPaletteOpen || selectedTaskId || selectedSessionId) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      // The reorder handle uses the arrow keys itself
      if (isOverviewPage || isCalendar || target.closest('[data-reorder-handle]')) return;

      const rowId = target.closest<HTMLElement>('[data-task-row]')?.dataset.taskRow;
      const index = rowId ? visibleOrder.indexOf(rowId) : -1;
      const last = visibleOrder.length - 1;

      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        const down = e.key === 'j' || e.key === 'ArrowDown';
        const nextIndex =
          index === -1 ? (down ? 0 : last) : Math.min(Math.max(index + (down ? 1 : -1), 0), last);
        if (visibleOrder[nextIndex]) {
          e.preventDefault();
          focusTask(visibleOrder[nextIndex]);
        }
        return;
      }

      const task = index === -1 ? undefined : tasks.find((t) => t.id === rowId);
      if (!task) return;
      const onRowItself = target.hasAttribute('data-task-row');
      const neighbour = visibleOrder[index + 1] ?? visibleOrder[index - 1];

      switch (e.key) {
        case ' ':
        case 'x':
          // Space on a focused button inside the row activates that button instead
          if ((e.key === ' ' && !onRowItself) || task.status === 'archived') return;
          e.preventDefault();
          if (task.status === 'in_progress' && neighbour) focusTask(neighbour);
          handleToggleTask(task);
          return;
        case 'Enter':
          if (!onRowItself) return;
          e.preventDefault();
          setSelectedTaskId(task.id);
          return;
        case 'e':
          e.preventDefault();
          setEditingTaskId(task.id);
          return;
        case 'a':
          e.preventDefault();
          if (neighbour) focusTask(neighbour);
          if (task.status === 'archived') handleRestoreTasks([task]);
          else handleArchiveTask(task);
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          handleDeleteTask(task.id);
          return;
        case 'Escape':
          target.blur();
          return;
        default:
          if (/^[0-4]$/.test(e.key)) {
            e.preventDefault();
            handleUpdateTask(task.id, { priority: Number(e.key) as TaskPriority });
          }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /** Props shared by every TaskRow for focus and inline editing. */
  const rowFocusProps = (task: Task) => ({
    isTabStop: task.id === tabStopId,
    onFocusRow: setFocusedTaskId,
    isEditing: editingTaskId === task.id,
    onEditingChange: (editing: boolean) => {
      setEditingTaskId(editing ? task.id : null);
      // After a rename, return focus to the row unless the user clicked somewhere else
      if (!editing) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) focusTask(task.id);
        });
      }
    },
  });

  const totalActiveCount = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'archived'
  ).length;
  const totalDoneCount = tasks.filter((t) => t.status === 'done').length;

  const isOverviewPage = activeNav.type === 'smart' && activeNav.id === 'overview';
  const backgroundInert = selectedTask !== null || selectedSession !== null || commandPaletteOpen;
  // Drag-to-reorder only makes sense in one flat, manually sorted list
  const canReorder = sortBy === 'manual' && groupBy === 'none';
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
        <main className="@container flex-1 overflow-y-auto">
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
                tasks={tasks}
                projects={projects}
                scratchpad={scratchpad}
                quickLinks={quickLinks}
                widgetConfig={widgetConfig}
                onSaveScratchpad={(content) => saveScratchpadMutation.mutate(content)}
                onConvertLineToTask={handleConvertScratchpadLineToTask}
                onCreateQuickLink={(title, url, category) =>
                  createQuickLinkMutation.mutate({ title, url, category })
                }
                onDeleteQuickLink={handleDeleteQuickLink}
                onUpdateWidgetConfig={(cfg) => saveWidgetConfigMutation.mutate(cfg)}
                onSelectSmartView={(v) => setActiveNav({ type: 'smart', id: v })}
                onSelectProject={(id) => setActiveNav({ type: 'project', id })}
              />
            </>
          ) : (
            <>
              {/* Collapsible Summary Widgets Bar above Task Views */}
              <DashboardWidgets
                mode="compact"
                tasks={tasks}
                projects={projects}
                scratchpad={scratchpad}
                quickLinks={quickLinks}
                widgetConfig={widgetConfig}
                onSaveScratchpad={(content) => saveScratchpadMutation.mutate(content)}
                onConvertLineToTask={handleConvertScratchpadLineToTask}
                onCreateQuickLink={(title, url, category) =>
                  createQuickLinkMutation.mutate({ title, url, category })
                }
                onDeleteQuickLink={handleDeleteQuickLink}
                onUpdateWidgetConfig={(cfg) => saveWidgetConfigMutation.mutate(cfg)}
                onSelectSmartView={(v) => setActiveNav({ type: 'smart', id: v })}
              />

              {/* View Title & List Toolbar */}
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
                  <h2 className="text-xl font-bold tracking-tight">{currentViewTitle}</h2>
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                    {isCompletedView
                      ? completedFilteredTasks.length
                      : activeFilteredTasks.length}
                  </span>
                </div>

                {/* Grouping, Sorting, Priority Filter Toolbar */}
                <div className="flex items-center flex-wrap gap-2">
                  {isCompletedView && completedFilteredTasks.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        requestArchiveCompleted(completedFilteredTasks, 'shown in this view')
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Archive {completedFilteredTasks.length} completed</span>
                    </button>
                  )}

                  {isArchiveView && activeFilteredTasks.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleRestoreTasks(activeFilteredTasks)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                        <span>Restore {activeFilteredTasks.length}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => requestDeleteArchived(activeFilteredTasks)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 hover:bg-red-100 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete {activeFilteredTasks.length} permanently</span>
                      </button>
                    </>
                  )}

                  <SavedViewControls
                    appliedView={appliedView}
                    isModified={appliedView !== null && !sameView(appliedView.view, view)}
                    defaultName={currentViewTitle}
                    onSaveNew={handleSaveNewView}
                    onUpdate={handleUpdateAppliedView}
                  />

                  {/* Filter by Priority */}
                  <div className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
                    <Flag className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-400 hidden sm:inline">Priority:</span>
                    <select
                      aria-label="Filter by priority"
                      value={priorityFilter}
                      onChange={(e) =>
                        updateView({
                          priority:
                            e.target.value === 'all'
                              ? 'all'
                              : (Number(e.target.value) as TaskPriority),
                        })
                      }
                      className="bg-transparent font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                    >
                      <option value="all">All</option>
                      <option value={4}>Urgent</option>
                      <option value={3}>High</option>
                      <option value={2}>Medium</option>
                      <option value={1}>Low</option>
                      <option value={0}>None</option>
                    </select>
                  </div>

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
                  <div className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
                    <Layers className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-400 hidden sm:inline">Group:</span>
                    <select
                      aria-label="Group tasks by"
                      value={groupBy}
                      onChange={(e) => updateView({ groupBy: e.target.value as GroupByOption })}
                      className="bg-transparent font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                    >
                      <option value="none">None</option>
                      <option value="priority">Priority</option>
                      <option value="project">Project</option>
                      <option value="dueDate">Due Date</option>
                      <option value="status">Status</option>
                    </select>
                  </div>

                  {sortBy === 'manual' && groupBy !== 'none' && (
                    <span className="text-[11px] text-zinc-400">
                      Set Group to None to drag-reorder
                    </span>
                  )}

                  {/* Sort By */}
                  <div className="inline-flex items-center gap-1.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg px-2.5 py-1 text-xs">
                    <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-zinc-400 hidden sm:inline">Sort:</span>
                    <select
                      aria-label="Sort tasks by"
                      value={sortBy}
                      onChange={(e) => updateView({ sortBy: e.target.value as SortByOption })}
                      className="bg-transparent font-medium text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                    >
                      <option value="created">Newest</option>
                      <option value="priority">Priority</option>
                      <option value="dueDate">Due Date</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
                  </>
                  )}
                </div>
              </div>

              {/* Quick Add Bar with Metadata Pickers & Syntax Support */}
              {!isCompletedView && !isArchiveView && (
                <form
                  onSubmit={handleCreateTask}
                  className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs focus-within:border-indigo-500 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/15 transition-all"
                >
                  <div className="flex items-center">
                    <div className="pl-3.5 pr-2 text-zinc-400">
                      <Plus className="w-5 h-5" />
                    </div>
                    <input
                      ref={quickAddRef}
                      type="text"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      placeholder="Add a task... e.g. Call Sam !high #work @fri ~weekly (Shortcut: N)"
                      aria-label="New task title"
                      className="w-full py-3 pr-4 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
                    />
                    {newTitle.trim() && (
                      <div className="pr-2.5">
                        <button
                          type="submit"
                          disabled={createTaskMutation.isPending}
                          className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          Add
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Live preview of what the typed syntax resolves to */}
                  {newTaskPreview && (
                    <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>Creates</span>
                      <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-xs">
                        {newTaskPreview.title}
                      </span>
                      {newTaskPreview.dueDate && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                          <Calendar className="w-3 h-3" />
                          Due {formatDayDate(newTaskPreview.dueDate)}
                        </span>
                      )}
                      {newTaskPreview.priority > 0 && (
                        <span
                          className={`px-1.5 py-0.5 rounded-md border ${PRIORITY_CONFIG[newTaskPreview.priority].badgeClass}`}
                        >
                          {PRIORITY_CONFIG[newTaskPreview.priority].label}
                        </span>
                      )}
                      {newTaskPreview.projectId && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: projects.find(
                                (p) => p.id === newTaskPreview.projectId
                              )?.color,
                            }}
                          />
                          {projects.find((p) => p.id === newTaskPreview.projectId)?.name}
                        </span>
                      )}
                      {newTaskPreview.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300"
                        >
                          #{tag}
                        </span>
                      ))}
                      {newTaskPreview.recurrence && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
                          <Repeat className="w-3 h-3" />
                          {describeRecurrence(newTaskPreview.recurrence)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick-add Metadata Bar */}
                  <div className="flex items-center flex-wrap gap-2 px-3.5 py-2 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-b-xl text-xs">
                    {/* Priority Picker */}
                    <div className="inline-flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1">
                      <Flag className="w-3 h-3 text-zinc-400" />
                      <select
                        aria-label="New task priority"
                        value={newPriority}
                        onChange={(e) =>
                          setNewPriority(Number(e.target.value) as TaskPriority)
                        }
                        className="bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                      >
                        <option value={0}>No Priority</option>
                        <option value={1}>Low</option>
                        <option value={2}>Medium</option>
                        <option value={3}>High</option>
                        <option value={4}>Urgent</option>
                      </select>
                    </div>

                    {/* Project Picker */}
                    <div className="inline-flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1">
                      <Folder className="w-3 h-3 text-zinc-400" />
                      <select
                        aria-label="New task project"
                        value={newProjectId}
                        onChange={(e) => setNewProjectId(e.target.value)}
                        className="bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                      >
                        <option value="">No Project</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Due Date Picker */}
                    <div className="inline-flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1">
                      <Calendar className="w-3 h-3 text-zinc-400" />
                      <input
                        type="date"
                        aria-label="New task due date"
                        value={newDueDate}
                        onChange={(e) => setNewDueDate(e.target.value)}
                        className="bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer"
                      />
                      {newDueDate && (
                        <button
                          type="button"
                          onClick={() => setNewDueDate('')}
                          aria-label="Clear new task due date"
                          className="text-zinc-400 hover:text-zinc-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Tag Input */}
                    <div className="inline-flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1">
                      <Tag className="w-3 h-3 text-zinc-400" />
                      <input
                        type="text"
                        value={newTagInput}
                        onChange={(e) => setNewTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            handleAddQuickTag();
                          }
                        }}
                        placeholder="Add tag..."
                        list="tag-suggestions"
                        aria-label="New task tag"
                        className="w-20 bg-transparent text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none"
                      />
                    </div>

                    {/* Added Tags Preview */}
                    {newTags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                      >
                        <span>#{t}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setNewTags((prev) => prev.filter((item) => item !== t))
                          }
                          className="hover:text-red-500 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </form>
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
        onCreateSubtask={(taskId, title) =>
          createSubtaskMutation.mutate({ taskId, title })
        }
        onToggleSubtask={(subtaskId, isCompleted) =>
          updateSubtaskMutation.mutate({ subtaskId, isCompleted })
        }
        onDeleteSubtask={handleDeleteSubtask}
        claudeSessions={claudeSessionsByTaskId.get(selectedTask?.id ?? '') ?? []}
        claudeSessionActions={claudeSessionActions}
      />

      {/* Slide-over Claude Session Panel */}
      <ClaudeSessionPanel
        session={selectedSession}
        tasks={tasks}
        onClose={() => setSelectedSessionId(null)}
        onOpenTask={(taskId) => {
          setSelectedSessionId(null);
          setSelectedTaskId(taskId);
        }}
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
