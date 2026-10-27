import { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { notes, DbNote } from '../db/schema.ts';
import { CreateNoteInputSchema, Note, UpdateNoteInputSchema } from '../../shared/types.ts';

export function serializeNote(row: DbNote): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color,
    tags: JSON.parse(row.tags) as string[],
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Pinned first, then most recently updated. */
export function listNotes(db: AppDatabase): Note[] {
  return db
    .select()
    .from(notes)
    .orderBy(desc(notes.pinned), desc(notes.updatedAt), asc(notes.id))
    .all()
    .map(serializeNote);
}

export async function registerNoteRoutes(app: FastifyInstance, db: AppDatabase) {
  const getNote = (id: string) => db.select().from(notes).where(eq(notes.id, id)).get();

  app.get('/api/notes', async () => ({ notes: listNotes(db) }));

  app.post('/api/notes', async (request, reply) => {
    const parsed = CreateNoteInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid note payload', details: parsed.error.flatten() });
    }
    const { tags, ...input } = parsed.data;
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(notes)
      .values({ ...input, id, tags: JSON.stringify(tags ?? []), createdAt: now, updatedAt: now })
      .run();
    return reply.status(201).send({ note: serializeNote(getNote(id)!) });
  });

  app.patch<{ Params: { id: string } }>('/api/notes/:id', async (request, reply) => {
    const parsed = UpdateNoteInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid note update payload', details: parsed.error.flatten() });
    }
    const { tags, ...input } = parsed.data;
    const result = db
      .update(notes)
      .set({ ...input, ...(tags !== undefined ? { tags: JSON.stringify(tags) } : {}), updatedAt: Date.now() })
      .where(eq(notes.id, request.params.id))
      .run();
    if (result.changes === 0) return reply.status(404).send({ error: 'Note not found' });
    return { note: serializeNote(getNote(request.params.id)!) };
  });

  app.delete<{ Params: { id: string } }>('/api/notes/:id', async (request, reply) => {
    const result = db.delete(notes).where(eq(notes.id, request.params.id)).run();
    if (result.changes === 0) return reply.status(404).send({ error: 'Note not found' });
    return reply.status(204).send();
  });
}
