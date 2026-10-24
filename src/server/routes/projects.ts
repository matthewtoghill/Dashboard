import { FastifyInstance } from 'fastify';
import { eq, asc } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { projects, DbProject } from '../db/schema.ts';
import {
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  Project,
} from '../../shared/types.ts';

export function serializeProject(row: DbProject): Project {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    adoEnabled: row.adoEnabled,
  };
}

export async function registerProjectRoutes(app: FastifyInstance, db: AppDatabase) {
  // GET /api/projects
  app.get('/api/projects', async () => {
    const rows = db
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder), asc(projects.createdAt))
      .all();

    return {
      projects: rows.map(serializeProject),
    };
  });

  // POST /api/projects
  app.post('/api/projects', async (request, reply) => {
    const parseResult = CreateProjectInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid project payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;
    const now = Date.now();
    const id = crypto.randomUUID();

    const newProject = {
      id,
      name: input.name,
      color: input.color,
      sortOrder: now,
      createdAt: now,
    };

    db.insert(projects).values(newProject).run();

    const created = db.select().from(projects).where(eq(projects.id, id)).get();
    return reply.status(201).send({ project: serializeProject(created!) });
  });

  // PATCH /api/projects/:id
  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(projects).where(eq(projects.id, id)).get();

    if (!existing) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const parseResult = UpdateProjectInputSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Invalid project update payload',
        details: parseResult.error.flatten(),
      });
    }

    const input = parseResult.data;

    db.update(projects)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.adoEnabled !== undefined ? { adoEnabled: input.adoEnabled } : {}),
      })
      .where(eq(projects.id, id))
      .run();

    const updated = db.select().from(projects).where(eq(projects.id, id)).get();
    return { project: serializeProject(updated!) };
  });

  // DELETE /api/projects/:id
  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const { id } = request.params;
    const existing = db.select().from(projects).where(eq(projects.id, id)).get();

    if (!existing) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    db.delete(projects).where(eq(projects.id, id)).run();
    return reply.status(204).send();
  });
}
