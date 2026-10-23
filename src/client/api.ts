import {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  Project,
  CreateProjectInput,
  UpdateProjectInput,
  Subtask,
  CreateSubtaskInput,
  UpdateSubtaskInput,
  DashboardState,
  QuickLink,
  CreateQuickLinkInput,
  WidgetConfig,
  BackupPayload,
  SavedView,
  ClaudeSession,
  UpdateClaudeSessionInput,
  SettingsResponse,
  UpdateSettingsInput,
  AdoFetchResult,
  AdoItem,
  AdoProjectLink,
  TaskEvent,
} from '../shared/types.ts';

export async function fetchTasks(): Promise<Task[]> {
  const res = await fetch('/api/tasks');
  if (!res.ok) {
    throw new Error(`Failed to load tasks: ${res.statusText}`);
  }
  const data = (await res.json()) as { tasks: Task[] };
  return data.tasks;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create task: ${res.statusText}`);
  }
  const data = (await res.json()) as { task: Task };
  return data.task;
}

export interface UpdateTaskResult {
  task: Task;
  /** Recurring task completed: the next occurrence created. */
  spawnedTaskId?: string;
  /** Recurring task reopened: its untouched next occurrence was removed... */
  removedOccurrenceId?: string;
  /** ...or kept, because it had already been edited. */
  keptOccurrenceId?: string;
}

export async function updateTask(id: string, input: UpdateTaskInput): Promise<UpdateTaskResult> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update task: ${res.statusText}`);
  }
  return (await res.json()) as UpdateTaskResult;
}

export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'DELETE',
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to delete task: ${res.statusText}`);
  }
}

async function postTaskIds<T>(path: string, ids: string[], label: string): Promise<T> {
  const res = await fetch(`/api/tasks/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to ${label}: ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const archiveTasks = (ids: string[]) =>
  postTaskIds<{ archivedCount: number }>('bulk-archive', ids, 'archive tasks');

export const restoreTasks = (ids: string[]) =>
  postTaskIds<{ restoredCount: number }>('bulk-restore', ids, 'restore tasks');

export const reorderTasks = (ids: string[]) =>
  postTaskIds<{ reorderedCount: number }>('reorder', ids, 'reorder tasks');

export const deleteTasks = (ids: string[]) =>
  postTaskIds<{ deletedCount: number }>('bulk-delete', ids, 'delete tasks');

export async function createSubtask(
  taskId: string,
  input: CreateSubtaskInput
): Promise<Subtask> {
  const res = await fetch(`/api/tasks/${taskId}/subtasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create subtask: ${res.statusText}`);
  }
  const data = (await res.json()) as { subtask: Subtask };
  return data.subtask;
}

export async function updateSubtask(
  id: string,
  input: UpdateSubtaskInput
): Promise<Subtask> {
  const res = await fetch(`/api/subtasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update subtask: ${res.statusText}`);
  }
  const data = (await res.json()) as { subtask: Subtask };
  return data.subtask;
}

export async function deleteSubtask(id: string): Promise<void> {
  const res = await fetch(`/api/subtasks/${id}`, {
    method: 'DELETE',
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to delete subtask: ${res.statusText}`);
  }
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) {
    throw new Error(`Failed to load projects: ${res.statusText}`);
  }
  const data = (await res.json()) as { projects: Project[] };
  return data.projects;
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create project: ${res.statusText}`);
  }
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update project: ${res.statusText}`);
  }
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'DELETE',
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to delete project: ${res.statusText}`);
  }
}

// Stage 4 API methods
export async function fetchDashboardState(): Promise<DashboardState> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) {
    throw new Error(`Failed to load dashboard state: ${res.statusText}`);
  }
  return (await res.json()) as DashboardState;
}

export async function saveScratchpad(content: string): Promise<{ scratchpad: string }> {
  const res = await fetch('/api/dashboard/scratchpad', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to save scratchpad: ${res.statusText}`);
  }
  return (await res.json()) as { scratchpad: string };
}

export async function saveSavedViews(savedViews: SavedView[]): Promise<SavedView[]> {
  const res = await fetch('/api/dashboard/saved-views', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ savedViews }),
  });
  if (!res.ok) {
    throw new Error(`Failed to save views: ${res.statusText}`);
  }
  return ((await res.json()) as { savedViews: SavedView[] }).savedViews;
}

export async function saveWidgetConfig(
  config: Partial<WidgetConfig>
): Promise<{ widgetConfig: WidgetConfig }> {
  const res = await fetch('/api/dashboard/widgets', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Failed to save widget config: ${res.statusText}`);
  }
  return (await res.json()) as { widgetConfig: WidgetConfig };
}

export async function createQuickLink(input: CreateQuickLinkInput): Promise<QuickLink> {
  const res = await fetch('/api/quick-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to create quick link: ${res.statusText}`);
  }
  const data = (await res.json()) as { quickLink: QuickLink };
  return data.quickLink;
}

export async function updateQuickLink(id: string, input: CreateQuickLinkInput): Promise<QuickLink> {
  const res = await fetch(`/api/quick-links/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update quick link: ${res.statusText}`);
  }
  const data = (await res.json()) as { quickLink: QuickLink };
  return data.quickLink;
}

export async function deleteQuickLink(id: string): Promise<void> {
  const res = await fetch(`/api/quick-links/${id}`, {
    method: 'DELETE',
    keepalive: true,
  });
  if (!res.ok) {
    throw new Error(`Failed to delete quick link: ${res.statusText}`);
  }
}

export interface BackupInfo {
  file: string;
  createdAt: number;
  size: number;
}

export type BackupStatus =
  | { enabled: true; dir: string; keep: number; backups: BackupInfo[] }
  | { enabled: false; backups: [] };

export async function fetchBackups(): Promise<BackupStatus> {
  const res = await fetch('/api/backups');
  if (!res.ok) {
    throw new Error(`Failed to load backups: ${res.statusText}`);
  }
  return (await res.json()) as BackupStatus;
}

export async function createBackup(): Promise<BackupInfo> {
  const res = await fetch('/api/backups', { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Backup failed: ${res.statusText}`);
  }
  return ((await res.json()) as { backup: BackupInfo }).backup;
}

export async function exportDashboardData(): Promise<BackupPayload> {
  const res = await fetch('/api/export');
  if (!res.ok) {
    throw new Error(`Failed to export data: ${res.statusText}`);
  }
  return (await res.json()) as BackupPayload;
}

export interface ImportResult {
  importedTasks: number;
  importedProjects: number;
  importedQuickLinks: number;
  importedSavedViews: number;
  importedClaudeSessions: number;
}

export async function importDashboardData(payload: BackupPayload): Promise<ImportResult> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string; details?: unknown }
      | null;
    const details = typeof body?.details === 'string' ? ` (${body.details})` : '';
    throw new Error(`${body?.error ?? `Failed to import data: ${res.statusText}`}${details}`);
  }
  return (await res.json()) as ImportResult;
}

export async function fetchClaudeSessions(): Promise<ClaudeSession[]> {
  const res = await fetch('/api/claude/sessions');
  if (!res.ok) {
    throw new Error(`Failed to load Claude sessions: ${res.statusText}`);
  }
  return ((await res.json()) as { sessions: ClaudeSession[] }).sessions;
}

export async function updateClaudeSession(
  sessionId: string,
  input: UpdateClaudeSessionInput
): Promise<ClaudeSession> {
  const res = await fetch(`/api/claude/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(`Failed to update session: ${res.statusText}`);
  }
  return ((await res.json()) as { session: ClaudeSession }).session;
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings');
  if (!res.ok) {
    throw new Error(`Failed to load settings: ${res.statusText}`);
  }
  return (await res.json()) as SettingsResponse;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save settings: ${res.statusText}`);
  }
  return (await res.json()) as SettingsResponse;
}

/** Throws the server's error message when there is one. */
async function failWith(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `${fallback}: ${res.statusText}`);
}

export async function fetchAdoItems(): Promise<AdoFetchResult> {
  const res = await fetch('/api/ado/items');
  if (!res.ok) return failWith(res, 'Failed to fetch from Azure DevOps');
  return (await res.json()) as AdoFetchResult;
}

export async function importAdoItems(items: AdoItem[]): Promise<{ importedCount: number }> {
  const res = await fetch('/api/ado/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) return failWith(res, 'Failed to import items');
  return (await res.json()) as { importedCount: number };
}

export async function fetchAdoProjectLinks(): Promise<AdoProjectLink[]> {
  const res = await fetch('/api/ado/projects');
  if (!res.ok) return failWith(res, 'Failed to load Azure DevOps projects');
  return ((await res.json()) as { links: AdoProjectLink[] }).links;
}

export async function saveAdoProjectLinks(links: AdoProjectLink[]): Promise<AdoProjectLink[]> {
  const res = await fetch('/api/ado/projects', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  if (!res.ok) return failWith(res, 'Failed to save Azure DevOps projects');
  return ((await res.json()) as { links: AdoProjectLink[] }).links;
}

export interface AdoWorkItemTypes {
  types: string[];
  /** When the oldest list was fetched from Azure DevOps; null if none could be. */
  fetchedAt: number | null;
}

/** Served from the server's cache; `refresh` asks Azure DevOps again. */
export async function fetchAdoWorkItemTypes(project?: string, refresh = false): Promise<AdoWorkItemTypes> {
  const params = new URLSearchParams();
  if (project !== undefined) params.set('project', project);
  if (refresh) params.set('refresh', '1');
  const res = await fetch(`/api/ado/work-item-types?${params}`);
  if (!res.ok) return failWith(res, 'Failed to load work item types');
  return (await res.json()) as AdoWorkItemTypes;
}

export async function fetchTaskEvents(taskId: string): Promise<TaskEvent[]> {
  const res = await fetch(`/api/tasks/${taskId}/events`);
  if (!res.ok) {
    throw new Error(`Failed to load task history: ${res.statusText}`);
  }
  const data = (await res.json()) as { events: TaskEvent[] };
  return data.events;
}
