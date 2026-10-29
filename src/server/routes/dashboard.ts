import { FastifyInstance } from 'fastify';
import { eq, asc, desc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { listTasks } from './tasks.ts';
import { serializeProject } from './projects.ts';
import { listClaudeSessions } from './claude.ts';
import { listAdoProjectLinks } from './ado.ts';
import { listNotes } from './notes.ts';
import { hasSavedSettings, readSettings, writeSettings } from '../settings.ts';
import { listTaskEvents } from '../taskEvents.ts';
import {
  keyValueStore,
  quickLinks,
  projects,
  tasks,
  subtasks,
  claudeSessions,
  adoProjectLinks,
  adoDismissed,
  taskAdoLinks,
  taskEvents,
  notes,
  DbQuickLink,
} from '../db/schema.ts';
import {
  CreateQuickLinkInputSchema,
  UpdateScratchpadInputSchema,
  WidgetConfigSchema,
  BackupPayloadSchema,
  TaskAdoLinkSchema,
  QuickLink,
  WidgetConfig,
  TaskStatus,
  TaskPriority,
  SavedView,
  SavedViewListSchema,
  MAX_SAVED_VIEWS,
} from '../../shared/types.ts';
import { z } from 'zod';

const SCRATCHPAD_KEY = 'scratchpad_content';
const WIDGET_CONFIG_KEY = 'widget_config';
const SAVED_VIEWS_KEY = 'saved_views';

const DEFAULT_WIDGET_CONFIG: WidgetConfig = WidgetConfigSchema.parse({});

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

export async function registerDashboardRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  options: { beforeImport: (() => void) | null } = { beforeImport: null }
) {
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

  const getSavedViews = (): SavedView[] => {
    const row = db
      .select()
      .from(keyValueStore)
      .where(eq(keyValueStore.key, SAVED_VIEWS_KEY))
      .get();
    if (!row) return [];
    try {
      const parsed = SavedViewListSchema.safeParse(JSON.parse(row.value));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
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
      savedViews: getSavedViews(),
      claudeSessions: listClaudeSessions(db),
    };
  });

  // PUT /api/dashboard/saved-views: replaces the whole list
  app.put('/api/dashboard/saved-views', async (request, reply) => {
    const parsed = z.object({ savedViews: SavedViewListSchema }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid saved views payload',
        details: parsed.error.flatten(),
      });
    }
    setKeyValue(SAVED_VIEWS_KEY, JSON.stringify(parsed.data.savedViews));
    return { savedViews: parsed.data.savedViews };
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

  // PUT /api/quick-links/:id: replaces title, url and category
  app.put<{ Params: { id: string } }>('/api/quick-links/:id', async (request, reply) => {
    const { id } = request.params;
    const parsed = CreateQuickLinkInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid quick link payload',
        details: parsed.error.flatten(),
      });
    }
    const { title, url, category } = parsed.data;
    const result = db.update(quickLinks).set({ title, url, category }).where(eq(quickLinks.id, id)).run();
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Quick link not found' });
    }
    const updated = db.select().from(quickLinks).where(eq(quickLinks.id, id)).get();
    return { quickLink: serializeQuickLink(updated!) };
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
      version: 9,
      exportedAt: Date.now(),
      projects: allProjects,
      tasks: allTasks,
      scratchpad: getScratchpad(),
      quickLinks: allLinks,
      savedViews: getSavedViews(),
      claudeSessions: listClaudeSessions(db),
      settings: readSettings(db.$client),
      adoProjectLinks: listAdoProjectLinks(db),
      taskEvents: listTaskEvents(db),
      notes: listNotes(db),
      adoDismissed: db.select().from(adoDismissed).orderBy(asc(adoDismissed.dismissedAt)).all(),
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

    try {
      options.beforeImport?.();
    } catch (err) {
      request.log.error(err, 'Pre-import backup failed');
      return reply.status(500).send({
        error: 'Import cancelled: could not create a safety backup first',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    let importedProjects = 0;
    let importedTasks = 0;
    let importedQuickLinks = 0;
    let importedSavedViews = 0;
    let importedClaudeSessions = 0;
    let importedNotes = 0;

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
              adoEnabled: proj.adoEnabled,
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
              recurrence: t.recurrence ? JSON.stringify(t.recurrence) : null,
              recurrenceParentId: t.recurrenceParentId,
              holdReason: t.holdReason,
              heldSince: t.heldSince,
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

          const legacyLink = TaskAdoLinkSchema.safeParse({
            externalId: t.externalId,
            url: t.externalUrl,
            title: t.title,
            type: t.externalId?.startsWith('pr/') ? 'Pull Request' : '',
            state: '',
            linkedAt: t.createdAt,
          });
          const links = t.adoLinks.length ? t.adoLinks : legacyLink.success ? [legacyLink.data] : [];
          for (const link of links) {
            // An item already linked to another task stays there
            tx.insert(taskAdoLinks).values({ ...link, taskId: t.id }).onConflictDoNothing().run();
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

        for (const session of payload.claudeSessions) {
          // Drop a link to a task that is in neither the backup nor the database
          const taskExists =
            session.taskId !== null &&
            tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, session.taskId)).get();
          const result = tx
            .insert(claudeSessions)
            .values({ ...session, taskId: taskExists ? session.taskId : null })
            .onConflictDoNothing()
            .run();
          importedClaudeSessions += result.changes;
        }

        for (const link of payload.adoProjectLinks) {
          // Drop a mapping to a project that is in neither the backup nor the database
          const projectExists =
            link.projectId !== null &&
            tx.select({ id: projects.id }).from(projects).where(eq(projects.id, link.projectId)).get();
          tx.insert(adoProjectLinks)
            .values({
              adoProject: link.adoProject,
              projectId: projectExists ? link.projectId : null,
              workItemTypes: link.workItemTypes ? JSON.stringify(link.workItemTypes) : null,
              ignoredStates: link.ignoredStates ? JSON.stringify(link.ignoredStates) : null,
            })
            .onConflictDoNothing()
            .run();
        }

        for (const event of payload.taskEvents) {
          // Skip history for a task that is in neither the backup nor the database
          if (!tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, event.taskId)).get()) continue;
          tx.insert(taskEvents).values(event).onConflictDoNothing().run();
        }

        for (const note of payload.notes) {
          const result = tx
            .insert(notes)
            .values({ ...note, tags: JSON.stringify(note.tags) })
            .onConflictDoNothing()
            .run();
          importedNotes += result.changes;
        }

        for (const dismissed of payload.adoDismissed) {
          tx.insert(adoDismissed).values(dismissed).onConflictDoNothing().run();
        }

        // Only into a database with no saved settings, so an import never changes them.
        // The backup folder is machine-specific and not carried over.
        if (payload.settings && !hasSavedSettings(db.$client)) {
          writeSettings(db.$client, { ...payload.settings, backupDir: '' });
        }

        if (payload.scratchpad !== undefined) {
          setKeyValue(SCRATCHPAD_KEY, payload.scratchpad);
        }

        // Merge by id: existing views win, new ones are appended up to the limit.
        const existingViews = getSavedViews();
        const knownIds = new Set(existingViews.map((v) => v.id));
        const newViews = payload.savedViews
          .filter((v) => !knownIds.has(v.id))
          .slice(0, MAX_SAVED_VIEWS - existingViews.length);
        if (newViews.length > 0) {
          setKeyValue(SAVED_VIEWS_KEY, JSON.stringify([...existingViews, ...newViews]));
        }
        importedSavedViews = newViews.length;
      });
    } catch (err) {
      // e.g. a task referencing a project that is neither in the backup nor the database
      return reply.status(400).send({
        error: 'Import failed; no changes were made',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      importedTasks,
      importedProjects,
      importedQuickLinks,
      importedSavedViews,
      importedClaudeSessions,
      importedNotes,
    };
  });
}
