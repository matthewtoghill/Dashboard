import { z } from 'zod';
import { RecurrenceSchema } from './recurrence.ts';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'archived']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
const UnarchivedStatusSchema = z.enum(['todo', 'in_progress', 'done']);

export const TaskPrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');
const HexColorSchema = z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'Expected a #rrggbb colour');

/** Prefixes bare hosts with https:// so only http(s) or relative links are ever stored. */
export function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) || url.startsWith('/') ? url : `https://${url}`;
}
const UrlSchema = z.string().trim().min(1, 'URL is required').transform(normalizeUrl);

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  color: HexColorSchema,
  sortOrder: z.number(),
  createdAt: z.number(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required'),
  color: HexColorSchema.optional().default('#6366f1'),
});
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z.object({
  name: z.string().trim().min(1, 'Project name cannot be empty').optional(),
  color: HexColorSchema.optional(),
  sortOrder: z.number().optional(),
});
export type UpdateProjectInput = z.input<typeof UpdateProjectInputSchema>;

export const SubtaskSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  title: z.string().min(1),
  isCompleted: z.boolean(),
  sortOrder: z.number(),
});
export type Subtask = z.infer<typeof SubtaskSchema>;

export const CreateSubtaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title is required'),
});
export type CreateSubtaskInput = z.input<typeof CreateSubtaskInputSchema>;

export const UpdateSubtaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title cannot be empty').optional(),
  isCompleted: z.boolean().optional(),
  sortOrder: z.number().optional(),
});
export type UpdateSubtaskInput = z.input<typeof UpdateSubtaskInputSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  projectId: z.string().nullable(),
  tags: z.array(z.string()),
  dueDate: IsoDateSchema.nullable(),
  sortOrder: z.number(),
  completedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Set while archived: the status a restore returns the task to. */
  statusBeforeArchive: UnarchivedStatusSchema.nullable().optional().default(null),
  recurrence: RecurrenceSchema.nullable().optional().default(null),
  /** The completed task this occurrence was spawned from. */
  recurrenceParentId: z.string().nullable().optional().default(null),
  /** Where an imported task came from: 'ado' with id `workitem/<id>` or `pr/<id>`. */
  externalSource: z.enum(['ado']).nullable().optional().default(null),
  externalId: z.string().min(1).nullable().optional().default(null),
  externalUrl: z.string().url().startsWith('https://').nullable().optional().default(null),
  subtasks: z.array(SubtaskSchema).optional().default([]),
});
export type Task = z.infer<typeof TaskSchema>;

/** Feature 6: task activity log. from/to hold old and new values as text (ids, ISO dates, numbers). */
export const TASK_EVENT_KINDS = [
  'created',
  'status',
  'due',
  'priority',
  'project',
  'title',
  'subtask_added',
  'subtask_completed',
  'subtask_reopened',
  'session_linked',
  'session_unlinked',
] as const;
export const TASK_EVENT_SOURCES = ['manual', 'ado', 'claude'] as const;

export const TaskEventSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  at: z.number(),
  kind: z.enum(TASK_EVENT_KINDS),
  from: z.string().nullable(),
  to: z.string().nullable(),
  source: z.enum(TASK_EVENT_SOURCES),
});
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type TaskEventKind = TaskEvent['kind'];
export type TaskEventSource = TaskEvent['source'];

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required'),
  description: z.string().optional().default(''),
  status: TaskStatusSchema.optional().default('todo'),
  priority: TaskPrioritySchema.optional().default(0),
  projectId: z.string().nullable().optional().default(null),
  tags: z.array(z.string()).optional().default([]),
  dueDate: IsoDateSchema.nullable().optional().default(null),
  recurrence: RecurrenceSchema.nullable().optional().default(null),
});
export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Task title cannot be empty').optional(),
  description: z.string().optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  projectId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  dueDate: IsoDateSchema.nullable().optional(),
  sortOrder: z.number().optional(),
  recurrence: RecurrenceSchema.nullable().optional(),
});
export type UpdateTaskInput = z.input<typeof UpdateTaskInputSchema>;

export const BulkTaskIdsSchema = z.object({
  ids: z.array(z.string()).min(1, 'At least one task id is required'),
});

// Stage 4: Dashboard Widgets & Data Portability Schemas
export const QuickLinkSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  url: UrlSchema,
  category: z.string().optional().default('General'),
  sortOrder: z.number(),
  createdAt: z.number(),
});
export type QuickLink = z.infer<typeof QuickLinkSchema>;

export const CreateQuickLinkInputSchema = z.object({
  title: z.string().trim().min(1, 'Link title is required'),
  url: UrlSchema,
  category: z.string().trim().optional().default('General'),
});
export type CreateQuickLinkInput = z.input<typeof CreateQuickLinkInputSchema>;

export const WidgetConfigSchema = z.object({
  showStats: z.boolean().default(true),
  showScratchpad: z.boolean().default(true),
  showQuickLinks: z.boolean().default(true),
  showTrends: z.boolean().default(true),
  showHeaderSummary: z.boolean().default(true),
  showAgenda: z.boolean().default(true),
  showInProgress: z.boolean().default(true),
  showStale: z.boolean().default(true),
  showAdo: z.boolean().default(true),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// Stage 5: Saved views. The list view's state, as held by the client (see client/utils/taskView.ts).
export const SmartViewIdSchema = z.enum(['overview', 'inbox', 'today', 'upcoming', 'completed', 'archived']);
export const ActiveNavigationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('smart'), id: SmartViewIdSchema }),
  z.object({ type: z.literal('project'), id: z.string().min(1) }),
  z.object({ type: z.literal('tag'), id: z.string().min(1) }),
]);
export const ViewStateSchema = z.object({
  nav: ActiveNavigationSchema,
  search: z.string().max(200),
  priority: z.union([TaskPrioritySchema, z.literal('all')]),
  groupBy: z.enum(['none', 'priority', 'project', 'dueDate', 'status']),
  sortBy: z.enum(['created', 'priority', 'dueDate', 'manual']),
  /** Since roadmap 5. Saved views from before it show as a list. */
  layout: z.enum(['list', 'month', 'week']).optional().default('list'),
});

export const MAX_SAVED_VIEWS = 50;
export const SavedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, 'View name is required').max(60),
  view: ViewStateSchema,
  createdAt: z.number(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;
export const SavedViewListSchema = z
  .array(SavedViewSchema)
  .max(MAX_SAVED_VIEWS, `At most ${MAX_SAVED_VIEWS} saved views`)
  .refine((list) => new Set(list.map((v) => v.id)).size === list.length, 'Saved view ids must be unique');

// Roadmap 1: Claude Code sessions, reported by hooks posting to /api/claude/events
export const ClaudeSessionStateSchema = z.enum(['running', 'idle', 'needs_attention', 'ended']);
export type ClaudeSessionState = z.infer<typeof ClaudeSessionStateSchema>;

export const ClaudeSessionSchema = z.object({
  sessionId: z.string().min(1),
  cwd: z.string(),
  title: z.string(),
  state: ClaudeSessionStateSchema,
  taskId: z.string().nullable(),
  startedAt: z.number(),
  lastEventAt: z.number(),
  /** Client that started the session, from CLAUDE_CODE_ENTRYPOINT: claude-desktop, cli, ... */
  entrypoint: z.string().optional().default(''),
  /** The desktop app's own id for the session (local_...), used for claude:// deep links. */
  hostSessionId: z.string().nullable().optional().default(null),
  lastPrompt: z.string().optional().default(''),
  lastTool: z.string().optional().default(''),
  /** Message of the last notification that needed the user. */
  attentionMessage: z.string().optional().default(''),
  /** Set when cleared from the Overview; cleared again when the session becomes active. */
  dismissedAt: z.number().nullable().optional().default(null),
});
export type ClaudeSession = z.infer<typeof ClaudeSessionSchema>;

/** The fields we use from a Claude Code hook's stdin JSON; the rest is ignored. */
export const ClaudeHookEventSchema = z.object({
  session_id: z.string().min(1),
  hook_event_name: z.string(),
  cwd: z.string().optional().default(''),
  prompt: z.string().optional(),
  tool_name: z.string().optional(),
  notification_type: z.string().optional(),
  message: z.string().optional(),
});
export type ClaudeHookEvent = z.input<typeof ClaudeHookEventSchema>;

export const UpdateClaudeSessionInputSchema = z.object({
  taskId: z.string().min(1).nullable().optional(),
  dismissed: z.boolean().optional(),
});
export type UpdateClaudeSessionInput = z.input<typeof UpdateClaudeSessionInputSchema>;

// Roadmap 4: settings, stored as JSON under the `settings` key of key_value_store.
// Theme stays per-browser in localStorage; widget visibility stays under `widget_config`.
export const SettingsSchema = z.object({
  /** Quick-add project outside project views; ignored if the project no longer exists. */
  defaultProjectId: z.string().min(1).nullable().default(null),
  /** Overridden by the BACKUP_KEEP environment variable. */
  backupKeep: z.number().int().min(1).max(1000).default(14),
  /** Absolute path; empty means `backups/` next to the database. Overridden by BACKUP_DIR. */
  backupDir: z.string().trim().max(1000).default(''),
  /** Unlinked Claude sessions are deleted this many days after their last event. */
  claudeSessionTtlDays: z.number().int().min(1).max(365).default(7),
  /** Organization URL; empty means the `az devops configure` default. */
  adoOrganization: z
    .string()
    .trim()
    .regex(/^(https:\/\/[^\s"%]+)?$/, 'Expected an https:// organization URL')
    .default(''),
  /** Work item types fetched for projects without their own list. */
  adoWorkItemTypes: z
    .array(z.string().trim().min(1).max(100))
    .max(50)
    .default(['Product Backlog Item', 'Task', 'Bug', 'User Story']),
  /** Work items in these states are left out, and count as closed for imported tasks. */
  adoIgnoredStates: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  /** Only fetch work items and pull requests for ADO projects mapped to a Dashboard project. */
  adoLinkedProjectsOnly: z.boolean().default(false),
  /** Minutes between background checks; 0 turns the check off. */
  adoSyncMinutes: z.number().int().min(0).max(1440).default(30),
  /** First day of the calendar week: 0 = Sunday, 1 = Monday. */
  weekStartDay: z.union([z.literal(0), z.literal(1)]).default(1),
  /** The Overview's stale widget lists to-do tasks untouched for this many days. */
  staleTaskDays: z.number().int().min(1).max(365).default(14),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const UpdateSettingsInputSchema = SettingsSchema.partial().strict();
export type UpdateSettingsInput = z.input<typeof UpdateSettingsInputSchema>;

/** GET/PUT /api/settings. `envOverrides` holds the raw environment value that wins, if any. */
export interface SettingsResponse {
  settings: Settings;
  envOverrides: { backupKeep: string | null; backupDir: string | null };
}

// Roadmap 3: Azure DevOps import, through the az CLI (see server/ado.ts)
/** Passed to az on the command line, so quotes, % and control characters are refused. */
export const AdoProjectNameSchema = z
  .string()
  .trim()
  .min(1, 'Project name is required')
  .max(64)
  .regex(/^[^"%\u0000-\u001f]+$/, 'Project name contains an invalid character');

export const AdoProjectLinkSchema = z.object({
  adoProject: AdoProjectNameSchema,
  projectId: z.string().min(1).nullable().default(null),
  /** Null uses the adoWorkItemTypes setting. */
  workItemTypes: z.array(z.string().trim().min(1).max(100)).max(50).nullable().default(null),
  /** Null uses the adoIgnoredStates setting. */
  ignoredStates: z.array(z.string().trim().min(1).max(100)).max(50).nullable().default(null),
});
export type AdoProjectLink = z.infer<typeof AdoProjectLinkSchema>;
export const AdoProjectLinkListSchema = z
  .array(AdoProjectLinkSchema)
  .max(200)
  .refine(
    (list) => new Set(list.map((l) => l.adoProject.toLowerCase())).size === list.length,
    'Each Azure DevOps project can only be listed once'
  );

export const AdoItemSchema = z.object({
  /** `workitem/<id>` or `pr/<id>`; unique per organization. */
  externalId: z.string().regex(/^(workitem|pr)\/\d+$/),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().startsWith('https://'),
  adoProject: z.string(),
  /** Work item type, or 'Pull Request'. */
  type: z.string(),
  state: z.string(),
  /** For pull requests: authored by me, or waiting for my review. */
  role: z.enum(['author', 'reviewer']).nullable().default(null),
});
export type AdoItem = z.infer<typeof AdoItemSchema>;

export const AdoImportInputSchema = z.object({
  items: z.array(AdoItemSchema).min(1, 'Select at least one item').max(500),
});

/** GET /api/ado/items. */
export interface AdoFetchResult {
  /** Open items assigned to me; taskId is set when already imported. */
  items: (AdoItem & { taskId: string | null })[];
  /** Unfinished imported tasks whose source item is now closed, merged or abandoned. */
  closed: { taskId: string; title: string; externalId: string; url: string | null; state: string }[];
  /** Per-project failures that did not stop the rest of the fetch. */
  warnings: string[];
}

/** GET /api/ado/items: the last background or manual check, with task links as they are now. */
export interface AdoSyncResult extends AdoFetchResult {
  /** When the result was fetched; null before the first successful check. */
  checkedAt: number | null;
  /** Why the most recent check failed, if it did. */
  error: string | null;
  lastErrorAt: number | null;
}

export const DashboardStateSchema = z.object({
  scratchpad: z.string(),
  widgetConfig: WidgetConfigSchema,
  quickLinks: z.array(QuickLinkSchema),
  savedViews: z.array(SavedViewSchema),
});
export type DashboardState = z.infer<typeof DashboardStateSchema>;

export const UpdateScratchpadInputSchema = z.object({
  content: z.string(),
});

export const BackupPayloadSchema = z.object({
  version: z.number().optional().default(1),
  exportedAt: z.number().optional(),
  projects: z.array(ProjectSchema).optional().default([]),
  tasks: z.array(TaskSchema).optional().default([]),
  scratchpad: z.string().optional(),
  quickLinks: z.array(QuickLinkSchema).optional().default([]),
  /** Since version 2. */
  savedViews: SavedViewListSchema.optional().default([]),
  /** Since version 3. */
  claudeSessions: z.array(ClaudeSessionSchema).optional().default([]),
  /** Since version 4. */
  settings: SettingsSchema.optional(),
  /** Since version 5. */
  adoProjectLinks: z.array(AdoProjectLinkSchema).optional().default([]),
  /** Since version 6. */
  taskEvents: z.array(TaskEventSchema).optional().default([]),
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;
