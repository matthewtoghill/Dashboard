import { FastifyInstance } from 'fastify';
import { eq, desc, asc, and, ne, inArray, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { tasks, subtasks, DbTask, DbSubtask } from '../db/schema.ts';
import {
  CreateTaskInputSchema,
  UpdateTaskInputSchema,
  CreateSubtaskInputSchema,
  UpdateSubtaskInputSchema,
  BulkTaskIdsSchema,
  Task,
  Subtask,
  TaskPriority,
  TaskStatus,
} from '../../shared/types.ts';

function serializeSubtask(row: DbSubtask): Subtask {
  return {
    id: row.id,
    taskId: row.taskId,
    title: row.title,
    isCompleted: Boolean(row.isCompleted),
    sortOrder: row.sortOrder,
  };
}

export function serializeTask(row: DbTask, taskSubtasks: Subtask[] = []): Task {
  let parsedTags: string[] = [];
  try {
    const raw = JSON.parse(row.tags);
    if (Array.isArray(raw)) {
      parsedTags = raw.map(String);
    }
  } catch {
    parsedTags = [];
  }

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: (row.priority ?? 0) as TaskPriority,
    projectId: row.projectId ?? null,
    tags: parsedTags,
    dueDate: row.dueDate ?? null,
    sortOrder: row.sortOrder,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    statusBeforeArchive: row.statusBeforeArchive ?? null,
    subtasks: taskSubtasks,
  };
}

/** All tasks with their subtasks embedded, in stored order. */
export function listTasks(db: AppDatabase): Task[] {
  const rows = db
    .select()
    .from(tasks)
    .orderBy(asc(tasks.sortOrder), desc(tasks.createdAt))
    .all();

  const subtasksByTask = new Map<string, Subtask[]>();
  for (const sub of db.select().from(subtasks).orderBy(asc(subtasks.sortOrder)).all()) {
    const list = subtasksByTask.get(sub.taskId) ?? [];
    list.push(serializeSubtask(sub));
    subtasksByTask.set(sub.taskId, list);
  }

  return rows.map((row) => serializeTask(row, subtasksByTask.get(row.id) ?? []));
}

export async function registerTaskRoutes(app: FastifyInstance, db: AppDatabase) {
  const getTaskWithSubtasks = (taskId: string): Task | null => {
    const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!row) return null;
    const subRows = db
      .select()
      .from(subtasks)
      .where(eq(subtasks.taskId, taskId))
      .orderBy(asc(subtasks.sortOrder))
      .all();
    return serializeTask(row, subRows.map(serializeSubtask));
  };

  // GET /api/tasks
  app.get('/api/tasks', async () => ({ tasks: listTasks(db) }));

  // POST /api/tasks
  app.post('/api/tasks', async (request, reply) => {
    const parseResult = CreateTaskInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid task payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    const now = Date.now();
    const id = crypto.randomUUID();
    const isDone = input.status === 'done';

    const newTask = {
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      projectId: input.projectId,
      tags: JSON.stringify(input.tags),
      dueDate: input.dueDate,
      sortOrder: -now, // Place newest tasks at the top by default
      completedAt: isDone ? now : null,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(tasks).values(newTask).run();

    return reply.status(201).send({ task: getTaskWithSubtasks(id)! });
  });

  // PATCH /api/tasks/:id
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

    if (!existing) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    const parseResult = UpdateTaskInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid update payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    const now = Date.now();

    // Archiving keeps completedAt so restored tasks return to their previous state
    // and archived completions still count towards stats.
    let completedAt = existing.completedAt;
    if (input.status === 'done') {
      completedAt = existing.completedAt ?? now;
    } else if (input.status === 'todo' || input.status === 'in_progress') {
      completedAt = null;
    }

    let statusBeforeArchive = existing.statusBeforeArchive;
    if (input.status === 'archived' && existing.status !== 'archived') {
      statusBeforeArchive = existing.status;
    } else if (input.status !== undefined && input.status !== 'archived') {
      statusBeforeArchive = null;
    }

    db.update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.tags !== undefined ? { tags: JSON.stringify(input.tags) } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        completedAt,
        statusBeforeArchive,
        updatedAt: now,
      })
      .where(eq(tasks.id, id))
      .run();

    return { task: getTaskWithSubtasks(id)! };
  });

  // DELETE /api/tasks/:id
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();

    if (!existing) {
      return reply.status(404).send({ error: 'Task not found' });
    }

    db.delete(tasks).where(eq(tasks.id, id)).run();
    return reply.status(204).send();
  });

  const parseIds = (body: unknown) => BulkTaskIdsSchema.safeParse(body);

  // POST /api/tasks/bulk-archive
  app.post('/api/tasks/bulk-archive', async (request, reply) => {
    const parsed = parseIds(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ids', details: parsed.error.flatten() });
    }
    const result = db
      .update(tasks)
      .set({
        status: 'archived',
        // SQLite evaluates every SET expression against the old row, so this is the prior status
        statusBeforeArchive: sql`${tasks.status}`,
        updatedAt: Date.now(),
      })
      .where(and(inArray(tasks.id, parsed.data.ids), ne(tasks.status, 'archived')))
      .run();
    return { archivedCount: result.changes };
  });

  // POST /api/tasks/bulk-restore — back to the status held before archiving. Tasks archived
  // before that was recorded go to done if they were completed, else todo.
  app.post('/api/tasks/bulk-restore', async (request, reply) => {
    const parsed = parseIds(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ids', details: parsed.error.flatten() });
    }
    const result = db
      .update(tasks)
      .set({
        status: sql`COALESCE(${tasks.statusBeforeArchive}, CASE WHEN ${tasks.completedAt} IS NULL THEN 'todo' ELSE 'done' END)`,
        statusBeforeArchive: null,
        updatedAt: Date.now(),
      })
      .where(and(inArray(tasks.id, parsed.data.ids), eq(tasks.status, 'archived')))
      .run();
    return { restoredCount: result.changes };
  });

  // POST /api/tasks/reorder — rewrites sort_order so `ids` sit in the given order, evenly spaced
  // across the range they already occupy (tasks hidden by the client's filter keep their place).
  // Used when a manual move finds no gap between neighbours. Not an edit, so updatedAt is kept.
  app.post('/api/tasks/reorder', async (request, reply) => {
    const parsed = parseIds(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ids', details: parsed.error.flatten() });
    }
    const ids = parsed.data.ids;
    const rows = db
      .select({ sortOrder: tasks.sortOrder })
      .from(tasks)
      .where(inArray(tasks.id, ids))
      .all();
    if (new Set(ids).size !== ids.length || rows.length !== ids.length) {
      return reply.status(400).send({ error: 'Ids must be unique, existing tasks' });
    }

    const orders = rows.map((r) => r.sortOrder);
    const min = Math.min(...orders);
    const max = Math.max(...orders);
    const step = max > min ? (max - min) / (ids.length - 1) : 1;
    db.transaction((tx) => {
      ids.forEach((id, i) => {
        tx.update(tasks).set({ sortOrder: min + i * step }).where(eq(tasks.id, id)).run();
      });
    });
    return { reorderedCount: ids.length };
  });

  // POST /api/tasks/bulk-delete
  app.post('/api/tasks/bulk-delete', async (request, reply) => {
    const parsed = parseIds(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid ids', details: parsed.error.flatten() });
    }
    const result = db.delete(tasks).where(inArray(tasks.id, parsed.data.ids)).run();
    return { deletedCount: result.changes };
  });

  // POST /api/tasks/:taskId/subtasks
  app.post<{ Params: { taskId: string } }>(
    '/api/tasks/:taskId/subtasks',
    async (request, reply) => {
      const { taskId } = request.params;
      const existingTask = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
      if (!existingTask) {
        return reply.status(404).send({ error: 'Parent task not found' });
      }

      const parseResult = CreateSubtaskInputSchema.safeParse(request.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid subtask payload',
          details: parseResult.error.flatten(),
        });
      }

      const id = crypto.randomUUID();
      const now = Date.now();

      db.insert(subtasks)
        .values({
          id,
          taskId,
          title: parseResult.data.title,
          isCompleted: 0,
          sortOrder: now,
        })
        .run();

      db.update(tasks).set({ updatedAt: now }).where(eq(tasks.id, taskId)).run();

      const created = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
      return reply.status(201).send({ subtask: serializeSubtask(created!) });
    }
  );

  // PATCH /api/subtasks/:id
  app.patch<{ Params: { id: string } }>('/api/subtasks/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
    if (!existing) {
      return reply.status(404).send({ error: 'Subtask not found' });
    }

    const parseResult = UpdateSubtaskInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid subtask update payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    db.update(subtasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.isCompleted !== undefined
          ? { isCompleted: input.isCompleted ? 1 : 0 }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      })
      .where(eq(subtasks.id, id))
      .run();

    db.update(tasks)
      .set({ updatedAt: Date.now() })
      .where(eq(tasks.id, existing.taskId))
      .run();

    const updated = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
    return { subtask: serializeSubtask(updated!) };
  });

  // DELETE /api/subtasks/:id
  app.delete<{ Params: { id: string } }>('/api/subtasks/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(subtasks).where(eq(subtasks.id, id)).get();
    if (!existing) {
      return reply.status(404).send({ error: 'Subtask not found' });
    }

    db.delete(subtasks).where(eq(subtasks.id, id)).run();
    db.update(tasks)
      .set({ updatedAt: Date.now() })
      .where(eq(tasks.id, existing.taskId))
      .run();

    return reply.status(204).send();
  });
}
