import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { Note } from '../../shared/types.ts';

describe('Notes REST API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = (await buildApp({ dbPath: ':memory:' })).app;
  });

  afterEach(async () => {
    await app.close();
  });

  const create = async (payload: object) => {
    const res = await app.inject({ method: 'POST', url: '/api/notes', payload });
    expect(res.statusCode).toBe(201);
    return res.json().note as Note;
  };
  const list = async () => (await app.inject({ method: 'GET', url: '/api/notes' })).json().notes as Note[];

  it('creates, updates, lists pinned first, and deletes notes', async () => {
    const plain = await create({ body: '# Hello' });
    expect(plain).toMatchObject({ title: '', body: '# Hello', color: null, tags: [], pinned: false });

    const pinned = await create({ title: ' Ideas ', tags: ['work', 'work', 'misc'], color: '#10b981', pinned: true });
    expect(pinned).toMatchObject({ title: 'Ideas', tags: ['work', 'misc'], pinned: true });
    expect((await list()).map((n) => n.id)).toEqual([pinned.id, plain.id]);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/notes/${plain.id}`,
      payload: { body: 'changed', color: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().note).toMatchObject({ body: 'changed', title: '', color: null });

    expect((await app.inject({ method: 'PATCH', url: `/api/notes/${plain.id}`, payload: { color: 'red' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/notes/missing', payload: { body: 'x' } })).statusCode).toBe(404);

    expect((await app.inject({ method: 'DELETE', url: `/api/notes/${plain.id}` })).statusCode).toBe(204);
    expect((await list()).map((n) => n.id)).toEqual([pinned.id]);
  });

  it('round-trips notes through export and import', async () => {
    const note = await create({ title: 'Keep me', body: '- [ ] item', tags: ['a'] });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.notes).toEqual([note]);

    const other = (await buildApp({ dbPath: ':memory:' })).app;
    try {
      const imported = await other.inject({ method: 'POST', url: '/api/import', payload: exported });
      expect(imported.json().importedNotes).toBe(1);
      const again = await other.inject({ method: 'POST', url: '/api/import', payload: exported });
      expect(again.json().importedNotes).toBe(0);
      expect((await other.inject({ method: 'GET', url: '/api/notes' })).json().notes).toEqual([note]);
    } finally {
      await other.close();
    }
  });
});
