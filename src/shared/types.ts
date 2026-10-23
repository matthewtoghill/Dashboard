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
  subtasks: z.array(SubtaskSchema).optional().default([]),
});
export type Task = z.infer<typeof TaskSchema>;

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

export const LinkClaudeSessionInputSchema = z.object({
  taskId: z.string().min(1).nullable(),
});

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
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;
