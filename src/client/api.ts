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
  ImportResult,
  RestoreDiff,
  RestoreRequest,
  RestoreResult,
  SavedView,
  ClaudeSession,
  ClaudeFolderLink,
  UpdateClaudeSessionInput,
  SettingsResponse,
  UpdateSettingsInput,
  AdoItem,
  AdoProjectLink,
  AdoSyncResult,
  TaskEvent,
  Note,
  CreateNoteInput,
  UpdateNoteInput,
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
  const body = JSON.stringify({ content });
  const res = await fetch('/api/dashboard/scratchpad', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    // Lets a save on page hide finish; browsers refuse keepalive bodies over 64 KiB
    keepalive: new TextEncoder().encode(body).length < 60_000,
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

/** The server's error message, with its details when they are text. */
async function restoreError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string; details?: unknown } | null;
  const details = typeof body?.details === 'string' ? ` (${body.details})` : '';
  return new Error(`${body?.error ?? `${fallback}: ${res.statusText}`}${details}`);
}

export async function fetchRestoreDiff(file: string): Promise<RestoreDiff> {
  const res = await fetch(`/api/backups/${encodeURIComponent(file)}/diff`);
  if (!res.ok) throw await restoreError(res, 'Failed to read the backup');
  return (await res.json()) as RestoreDiff;
}

/** With `dryRun`, returns what the restore would do without changing anything. */
export async function restoreFromBackup(file: string, request: RestoreRequest): Promise<RestoreResult> {
  const res = await fetch(`/api/backups/${encodeURIComponent(file)}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw await restoreError(res, 'Restore failed');
  return (await res.json()) as RestoreResult;
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

export type { ImportResult };

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

export async function fetchHealth(): Promise<null> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Server unavailable: ${res.statusText}`);
  return null;
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

export async function fetchClaudeFolders(): Promise<ClaudeFolderLink[]> {
  const res = await fetch('/api/claude/folders');
  if (!res.ok) return failWith(res, 'Failed to load Claude folders');
  return ((await res.json()) as { links: ClaudeFolderLink[] }).links;
}

/** Maps a folder (and its subfolders) to a project, replacing its earlier mapping. */
export async function saveClaudeFolder(link: ClaudeFolderLink): Promise<ClaudeFolderLink[]> {
  const res = await fetch('/api/claude/folders', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(link),
  });
  if (!res.ok) return failWith(res, 'Failed to map folder');
  return ((await res.json()) as { links: ClaudeFolderLink[] }).links;
}

export async function deleteClaudeFolder(path: string): Promise<ClaudeFolderLink[]> {
  const res = await fetch(`/api/claude/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  if (!res.ok) return failWith(res, 'Failed to remove folder');
  return ((await res.json()) as { links: ClaudeFolderLink[] }).links;
}

/** The last background check's result; `refresh` checks Azure DevOps now. */
export async function fetchAdoItems(refresh = false): Promise<AdoSyncResult> {
  const res = await fetch(refresh ? '/api/ado/items?refresh=1' : '/api/ado/items');
  if (!res.ok) return failWith(res, 'Failed to fetch from Azure DevOps');
  return (await res.json()) as AdoSyncResult;
}

/** Creates a task per item, or with `taskId` links the items to that task. */
export async function importAdoItems(items: AdoItem[], taskId?: string): Promise<{ importedCount: number }> {
  const res = await fetch('/api/ado/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, taskId }),
  });
  if (!res.ok) return failWith(res, taskId ? 'Failed to link items' : 'Failed to import items');
  return (await res.json()) as { importedCount: number };
}

export async function unlinkAdoItem(externalId: string): Promise<void> {
  const res = await fetch(`/api/ado/links/${externalId}`, { method: 'DELETE' });
  if (!res.ok) return failWith(res, 'Failed to unlink item');
}

/** Hides items from the New list, or with `dismissed` false restores them. */
export async function setAdoDismissed(externalIds: string[], dismissed: boolean): Promise<void> {
  const res = await fetch('/api/ado/dismissed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ externalIds, dismissed }),
  });
  if (!res.ok) return failWith(res, dismissed ? 'Failed to dismiss items' : 'Failed to restore items');
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
  /** Every state of those types. */
  states: string[];
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

/** Marks a task kept by the weekly review (now), or restores an earlier value (undo). */
export async function reviewTask(taskId: string, reviewedAt?: number | null): Promise<Task> {
  const res = await fetch(`/api/tasks/${taskId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reviewedAt === undefined ? {} : { reviewedAt }),
  });
  if (!res.ok) return failWith(res, 'Failed to save review');
  return ((await res.json()) as { task: Task }).task;
}

export async function addTaskNote(taskId: string, text: string): Promise<Task> {
  const res = await fetch(`/api/tasks/${taskId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return failWith(res, 'Failed to add note');
  return ((await res.json()) as { task: Task }).task;
}

export async function fetchTaskEvents(taskId: string): Promise<TaskEvent[]> {
  const res = await fetch(`/api/tasks/${taskId}/events`);
  if (!res.ok) {
    throw new Error(`Failed to load task history: ${res.statusText}`);
  }
  const data = (await res.json()) as { events: TaskEvent[] };
  return data.events;
}

export async function fetchRecentEvents(limit: number): Promise<TaskEvent[]> {
  const res = await fetch(`/api/events?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load activity: ${res.statusText}`);
  return ((await res.json()) as { events: TaskEvent[] }).events;
}

export async function fetchNotes(): Promise<Note[]> {
  const res = await fetch('/api/notes');
  if (!res.ok) throw new Error(`Failed to load notes: ${res.statusText}`);
  return ((await res.json()) as { notes: Note[] }).notes;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const res = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create note: ${res.statusText}`);
  return ((await res.json()) as { note: Note }).note;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  const res = await fetch(`/api/notes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to save note: ${res.statusText}`);
  return ((await res.json()) as { note: Note }).note;
}

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE', keepalive: true });
  if (!res.ok) throw new Error(`Failed to delete note: ${res.statusText}`);
}
