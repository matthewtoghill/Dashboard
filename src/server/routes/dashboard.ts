import { FastifyInstance } from 'fastify';
import { eq, asc, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { listTasks } from './tasks.ts';
import { serializeProject } from './projects.ts';
import {
  keyValueStore,
  quickLinks,
  projects,
  tasks,
  subtasks,
  DbQuickLink,
} from '../db/schema.ts';
import {
  CreateQuickLinkInputSchema,
  UpdateScratchpadInputSchema,
  WidgetConfigSchema,
  BackupPayloadSchema,
  QuickLink,
  WidgetConfig,
  TaskStatus,
  TaskPriority,
} from '../../shared/types.ts';

const SCRATCHPAD_KEY = 'scratchpad_content';
const WIDGET_CONFIG_KEY = 'widget_config';

const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  showStats: true,
  showScratchpad: true,
  showQuickLinks: true,
  showHeaderSummary: true,
};

function serializeQuickLink(row: DbQuickLink): QuickLink {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    category: row.category,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export async function registerDashboardRoutes(app: FastifyInstance, db: AppDatabase) {
  const getScratchpad = (): string => {
    const row = db
      .select()
      .from(keyValueStore)
      .where(eq(keyValueStore.key, SCRATCHPAD_KEY))
      .get();
    return row?.value ?? '';
  };

  const setKeyValue = (key: string, value: string) => {
    const now = Date.now();
    const existing = db
      .select()
      .from(keyValueStore)
      .where(eq(keyValueStore.key, key))
      .get();
    if (existing) {
      db.update(keyValueStore)
        .set({ value, updatedAt: now })
        .where(eq(keyValueStore.key, key))
        .run();
    } else {
      db.insert(keyValueStore)
        .values({ key, value, updatedAt: now })
        .run();
    }
  };

  const getWidgetConfig = (): WidgetConfig => {
    const row = db
      .select()
      .from(keyValueStore)
      .where(eq(keyValueStore.key, WIDGET_CONFIG_KEY))
      .get();
    if (!row) return DEFAULT_WIDGET_CONFIG;
    try {
      const parsed = WidgetConfigSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : DEFAULT_WIDGET_CONFIG;
    } catch {
      return DEFAULT_WIDGET_CONFIG;
    }
  };

  // GET /api/dashboard
  app.get('/api/dashboard', async () => {
    const links = db
      .select()
      .from(quickLinks)
      .orderBy(asc(quickLinks.sortOrder), asc(quickLinks.createdAt))
      .all();

    return {
      scratchpad: getScratchpad(),
      widgetConfig: getWidgetConfig(),
      quickLinks: links.map(serializeQuickLink),
    };
  });

  // PUT /api/dashboard/scratchpad
  app.put('/api/dashboard/scratchpad', async (request, reply) => {
    const parsed = UpdateScratchpadInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid scratchpad payload' });
    }
    setKeyValue(SCRATCHPAD_KEY, parsed.data.content);
    return { scratchpad: parsed.data.content };
  });

  // PUT /api/dashboard/widgets
  app.put('/api/dashboard/widgets', async (request, reply) => {
    const current = getWidgetConfig();
    const merged = {
      ...current,
      ...(typeof request.body === 'object' && request.body !== null ? request.body : {}),
    };
    const parsed = WidgetConfigSchema.safeParse(merged);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid widget config' });
    }
    setKeyValue(WIDGET_CONFIG_KEY, JSON.stringify(parsed.data));
    return { widgetConfig: parsed.data };
  });

  // POST /api/quick-links
  app.post('/api/quick-links', async (request, reply) => {
    const parsed = CreateQuickLinkInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid quick link payload',
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(quickLinks)
      .values({
        id,
        title: input.title,
        url: input.url,
        category: input.category,
        sortOrder: now,
        createdAt: now,
      })
      .run();

    const created = db.select().from(quickLinks).where(eq(quickLinks.id, id)).get();
    return reply.status(201).send({ quickLink: serializeQuickLink(created!) });
  });

  // DELETE /api/quick-links/:id
  app.delete<{ Params: { id: string } }>('/api/quick-links/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(quickLinks).where(eq(quickLinks.id, id)).get();
    if (!existing) {
      return reply.status(404).send({ error: 'Quick link not found' });
    }
    db.delete(quickLinks).where(eq(quickLinks.id, id)).run();
    return reply.status(204).send();
  });

  // GET /api/export
  app.get('/api/export', async () => {
    const allProjects = db
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder))
      .all()
      .map(serializeProject);
    const allTasks = listTasks(db);

    const allLinks = db
      .select()
      .from(quickLinks)
      .orderBy(asc(quickLinks.sortOrder))
      .all()
      .map(serializeQuickLink);

    return {
      version: 1,
      exportedAt: Date.now(),
      projects: allProjects,
      tasks: allTasks,
      scratchpad: getScratchpad(),
      quickLinks: allLinks,
    };
  });

  // POST /api/import — all-or-nothing; rows whose id already exists are skipped
  app.post('/api/import', { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    const parsed = BackupPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid backup payload',
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    let importedProjects = 0;
    let importedTasks = 0;
    let importedQuickLinks = 0;

    try {
      db.transaction((tx) => {
        for (const proj of payload.projects) {
          const result = tx
            .insert(projects)
            .values({
              id: proj.id,
              name: proj.name,
              color: proj.color,
              sortOrder: proj.sortOrder,
              createdAt: proj.createdAt,
            })
            .onConflictDoNothing()
            .run();
          importedProjects += result.changes;
        }

        for (const t of payload.tasks) {
          const result = tx
            .insert(tasks)
            .values({
              id: t.id,
              title: t.title,
              description: t.description,
              status: t.status,
              priority: t.priority,
              projectId: t.projectId,
              tags: JSON.stringify(t.tags),
              dueDate: t.dueDate,
              sortOrder: t.sortOrder,
              completedAt: t.completedAt,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
              statusBeforeArchive: t.status === 'archived' ? t.statusBeforeArchive : null,
            })
            .onConflictDoNothing()
            .run();
          if (result.changes === 0) continue;
          importedTasks++;

          for (const sub of t.subtasks) {
            tx.insert(subtasks)
              .values({
                id: sub.id,
                taskId: t.id,
                title: sub.title,
                isCompleted: sub.isCompleted ? 1 : 0,
                sortOrder: sub.sortOrder,
              })
              .run();
          }
        }

        for (const link of payload.quickLinks) {
          const result = tx
            .insert(quickLinks)
            .values({
              id: link.id,
              title: link.title,
              url: link.url,
              category: link.category,
              sortOrder: link.sortOrder,
              createdAt: link.createdAt,
            })
            .onConflictDoNothing()
            .run();
          importedQuickLinks += result.changes;
        }

        if (payload.scratchpad !== undefined) {
          setKeyValue(SCRATCHPAD_KEY, payload.scratchpad);
        }
      });
    } catch (err) {
      // e.g. a task referencing a project that is neither in the backup nor the database
      return reply.status(400).send({
        error: 'Import failed; no changes were made',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    return { importedTasks, importedProjects, importedQuickLinks };
  });
}
