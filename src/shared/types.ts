import { z } from 'zod';
import { RecurrenceSchema } from './recurrence.ts';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'on_hold', 'done', 'archived']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
const UnarchivedStatusSchema = z.enum(['todo', 'in_progress', 'on_hold', 'done']);

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
  /** Off hides the Azure DevOps panel and leaves the mapped ADO projects out of checks. */
  adoEnabled: z.boolean().default(true),
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
  adoEnabled: z.boolean().optional(),
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

/** An Azure DevOps item linked to a task, as last seen by a check. */
export const TaskAdoLinkSchema = z.object({
  /** `workitem/<id>`, `pr/<id>` or `mention/<work item id>`; linked to at most one task. */
  externalId: z.string().regex(/^(workitem|pr|mention)\/\d+$/),
  url: z.string().url().startsWith('https://'),
  title: z.string(),
  /** Work item type, or 'Pull Request'; empty when not seen by a check yet. */
  type: z.string(),
  state: z.string(),
  linkedAt: z.number(),
});
export type TaskAdoLink = z.infer<typeof TaskAdoLinkSchema>;

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
  /** Set while on hold: why, and when it went on hold. Leaving on hold clears both. */
  holdReason: z.string().nullable().optional().default(null),
  heldSince: z.number().nullable().optional().default(null),
  /** Newest status note, derived from the activity log. */
  latestNote: z.object({ text: z.string(), at: z.number() }).nullable().optional(),
  /** The completed task this occurrence was spawned from. */
  recurrenceParentId: z.string().nullable().optional().default(null),
  subtasks: z.array(SubtaskSchema).optional().default([]),
  /** Linked Azure DevOps items, oldest link first. */
  adoLinks: z.array(TaskAdoLinkSchema).optional().default([]),
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
  'status_note',
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

/** A one-line status note; pasted line breaks collapse to spaces. */
export const CreateTaskNoteInputSchema = z.object({
  text: z
    .string()
    .transform((t) => t.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Note is required').max(280, 'Note is limited to 280 characters')),
});
export type CreateTaskNoteInput = z.input<typeof CreateTaskNoteInputSchema>;

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
  holdReason: z.string().trim().nullable().optional(),
  /** Backdates when an on hold task went on hold. Ignored unless the task is on hold. */
  heldSince: z.number().int().optional(),
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
  showClaudeFolders: z.boolean().default(true),
  showClaudeProjects: z.boolean().default(true),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

// Stage 5: Saved views. The list view's state, as held by the client (see client/utils/taskView.ts).
/** 'notes' is the Notes page, not a task list. */
export const SmartViewIdSchema = z.enum(['overview', 'inbox', 'today', 'upcoming', 'on_hold', 'completed', 'archived', 'notes']);
export const ActiveNavigationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('smart'), id: SmartViewIdSchema }),
  z.object({ type: z.literal('project'), id: z.string().min(1) }),
  z.object({ type: z.literal('tag'), id: z.string().min(1) }),
]);
export const ViewStateSchema = z.object({
  nav: ActiveNavigationSchema,
  search: z.string().max(200),
  priority: z.union([TaskPrioritySchema, z.literal('all')]),
  groupBy: z.enum(['none', 'priority', 'project', 'dueDate', 'status', 'adoLink', 'age']),
  sortBy: z.enum(['created', 'oldest', 'updated', 'title', 'heldSince', 'priority', 'dueDate', 'manual']),
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
  transcript_path: z.string().optional(),
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
/** Tailwind palettes offered as the primary colour; each needs a data-primary block in index.css. */
export const PRIMARY_COLORS = ['indigo', 'blue', 'sky', 'teal', 'emerald', 'violet', 'purple', 'pink', 'rose', 'orange'] as const;

export const COMPLETION_ANIMATIONS = ['none', 'confetti', 'fireworks', 'stars', 'snow', 'emoji', 'cannons'] as const;
export type CompletionAnimation = (typeof COMPLETION_ANIMATIONS)[number];

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
  /** On hold tasks held this many days or more get a "Chase?" badge. */
  chaseHoldDays: z.number().int().min(1).max(365).default(7),
  /** How a task's latest status note shows in lists: a second line, or an icon with the note on hover. */
  statusNoteStyle: z.enum(['line', 'icon']).default('line'),
  /** Accent for in-progress tasks, as #rrggbb. */
  inProgressColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour')
    .default('#fbbf24'),
  /** Primary accent palette used for highlights, borders and buttons. */
  primaryColor: z.enum(PRIMARY_COLORS).default('indigo'),
  /** UI density: scales Tailwind's spacing unit, leaving text size alone. */
  density: z.enum(['compact', 'comfortable', 'spacious']).default('comfortable'),
  /** Celebration played when a task is completed; 'none' turns it off. */
  completionAnimation: z.enum(COMPLETION_ANIMATIONS).default('none'),
  /** Start the animation at the last click or focused element instead of the screen centre. */
  completionAnimationFollowsPointer: z.boolean().default(true),
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

/** The newest comment that @mentions me on a work item. */
export const AdoMentionSchema = z.object({
  /** Display name of the comment's author; empty when no comment mentions me (e.g. the description does). */
  by: z.string(),
  /** ISO date of the comment. */
  at: z.string(),
  /** The comment as plain text, shortened. Shown only; never copied into tasks. */
  snippet: z.string(),
  /** Comments posted after it. */
  repliesAfter: z.number(),
});
export type AdoMention = z.infer<typeof AdoMentionSchema>;

export const AdoItemSchema = z.object({
  /** `workitem/<id>`, `pr/<id>` or `mention/<work item id>`; unique per organization. */
  externalId: z.string().regex(/^(workitem|pr|mention)\/\d+$/),
  title: z.string().trim().min(1).max(500),
  url: z.string().url().startsWith('https://'),
  adoProject: z.string(),
  /** Work item type, or 'Pull Request'. */
  type: z.string(),
  state: z.string(),
  /** For pull requests: authored by me, or waiting for my review. 'mention': someone @mentioned me. */
  role: z.enum(['author', 'reviewer', 'mention']).nullable().default(null),
  /** For pull requests: the repository name. */
  repo: z.string().nullable().default(null),
  /** For mentions: the comment, when one was found. */
  mention: AdoMentionSchema.nullable().default(null),
});
export type AdoItem = z.infer<typeof AdoItemSchema>;

export const AdoImportInputSchema = z.object({
  items: z.array(AdoItemSchema).min(1, 'Select at least one item').max(500),
  /** Link the items to this task instead of creating a task per item. */
  taskId: z.string().min(1).optional(),
});

/** GET /api/ado/items. */
export interface AdoFetchResult {
  /** Open items assigned to me and recent mentions; taskId is set when already imported. */
  items: (AdoItem & { taskId: string | null })[];
  /** Unfinished linked tasks whose items are all closed, merged or abandoned; state lists theirs. */
  closed: { taskId: string; title: string; state: string }[];
  /** Per-project failures that did not stop the rest of the fetch. */
  warnings: string[];
}

/** POST /api/ado/dismissed: dismiss items, or with dismissed false restore them. */
export const AdoDismissInputSchema = z.object({
  externalIds: z.array(AdoItemSchema.shape.externalId).min(1).max(500),
  dismissed: z.boolean(),
});

export const AdoDismissedSchema = z.object({
  externalId: AdoItemSchema.shape.externalId,
  dismissedAt: z.number(),
});

/** GET /api/ado/items: the last background or manual check, with task links as they are now. */
export interface AdoSyncResult extends AdoFetchResult {
  /** Items from the check that were dismissed; left out of `items`. */
  dismissed: (AdoItem & { taskId: string | null })[];
  /** When the result was fetched; null before the first successful check. */
  checkedAt: number | null;
  /** Why the most recent check failed, if it did. */
  error: string | null;
  lastErrorAt: number | null;
}

// Notes: a markdown notebook, separate from tasks
const NoteTagsSchema = z
  .array(z.string().trim().min(1).max(50))
  .max(30)
  .transform((tags) => [...new Set(tags)]);

export const NoteSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200),
  body: z.string().max(200_000),
  /** Card accent as #rrggbb; null for none. */
  color: HexColorSchema.nullable(),
  tags: NoteTagsSchema,
  pinned: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Note = z.infer<typeof NoteSchema>;

export const UpdateNoteInputSchema = z
  .object({
    title: z.string().trim().max(200),
    body: z.string().max(200_000),
    color: HexColorSchema.nullable(),
    tags: NoteTagsSchema,
    pinned: z.boolean(),
  })
  .partial();
export type UpdateNoteInput = z.input<typeof UpdateNoteInputSchema>;
export const CreateNoteInputSchema = UpdateNoteInputSchema;
export type CreateNoteInput = UpdateNoteInput;

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
  /** Before version 7 a task held at most one ADO link, in externalId/externalUrl. */
  tasks: z
    .array(
      TaskSchema.extend({
        externalId: z.string().nullable().optional(),
        externalUrl: z.string().nullable().optional(),
      })
    )
    .optional()
    .default([]),
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
  /** Since version 8. */
  notes: z.array(NoteSchema).optional().default([]),
  /** Since version 9. */
  adoDismissed: z.array(AdoDismissedSchema).optional().default([]),
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;
