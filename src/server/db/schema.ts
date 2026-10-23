import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  status: text('status', { enum: ['todo', 'in_progress', 'done', 'archived'] })
    .notNull()
    .default('todo'),
  priority: integer('priority').notNull().default(0),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  tags: text('tags').notNull().default('[]'), // JSON string array
  dueDate: text('due_date'),
  sortOrder: real('sort_order').notNull().default(0),
  completedAt: integer('completed_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  statusBeforeArchive: text('status_before_archive', { enum: ['todo', 'in_progress', 'done'] }),
  recurrence: text('recurrence'), // JSON Recurrence, see shared/recurrence.ts
  recurrenceParentId: text('recurrence_parent_id'),
  externalSource: text('external_source', { enum: ['ado'] }),
  externalId: text('external_id'),
  externalUrl: text('external_url'),
});

export const subtasks = sqliteTable('subtasks', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  isCompleted: integer('is_completed').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const quickLinks = sqliteTable('quick_links', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull().default('General'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const keyValueStore = sqliteTable('key_value_store', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const claudeSessions = sqliteTable('claude_sessions', {
  sessionId: text('session_id').primaryKey(),
  cwd: text('cwd').notNull(),
  title: text('title').notNull().default(''),
  state: text('state', { enum: ['running', 'idle', 'needs_attention', 'ended'] }).notNull(),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  startedAt: integer('started_at').notNull(),
  lastEventAt: integer('last_event_at').notNull(),
  entrypoint: text('entrypoint').notNull().default(''),
  hostSessionId: text('host_session_id'),
  lastPrompt: text('last_prompt').notNull().default(''),
  lastTool: text('last_tool').notNull().default(''),
  attentionMessage: text('attention_message').notNull().default(''),
  dismissedAt: integer('dismissed_at'),
});

export const adoProjectLinks = sqliteTable('ado_project_links', {
  adoProject: text('ado_project').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  workItemTypes: text('work_item_types'), // JSON string array; null = settings default
});

export type DbProject = typeof projects.$inferSelect;
export type NewDbProject = typeof projects.$inferInsert;

export type DbTask = typeof tasks.$inferSelect;
export type NewDbTask = typeof tasks.$inferInsert;

export type DbSubtask = typeof subtasks.$inferSelect;
export type NewDbSubtask = typeof subtasks.$inferInsert;

export type DbQuickLink = typeof quickLinks.$inferSelect;
export type NewDbQuickLink = typeof quickLinks.$inferInsert;

export type DbKeyValue = typeof keyValueStore.$inferSelect;

export type DbClaudeSession = typeof claudeSessions.$inferSelect;

export type DbAdoProjectLink = typeof adoProjectLinks.$inferSelect;
