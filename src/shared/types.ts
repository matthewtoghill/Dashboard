import { z } from 'zod';

export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'done', 'archived']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

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
  showHeaderSummary: z.boolean().default(true),
});
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;

export const DashboardStateSchema = z.object({
  scratchpad: z.string(),
  widgetConfig: WidgetConfigSchema,
  quickLinks: z.array(QuickLinkSchema),
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
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;
