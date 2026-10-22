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

export type DbProject = typeof projects.$inferSelect;
export type NewDbProject = typeof projects.$inferInsert;

export type DbTask = typeof tasks.$inferSelect;
export type NewDbTask = typeof tasks.$inferInsert;

export type DbSubtask = typeof subtasks.$inferSelect;
export type NewDbSubtask = typeof subtasks.$inferInsert;

export type DbQuickLink = typeof quickLinks.$inferSelect;
export type NewDbQuickLink = typeof quickLinks.$inferInsert;

export type DbKeyValue = typeof keyValueStore.$inferSelect;
