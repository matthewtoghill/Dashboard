import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { Project, SavedView, SavedViewListSchema, Task, ViewStateSchema } from '../../shared/types.ts';
import { DEFAULT_VIEW_STATE, resolveSavedView, sameView } from '../../client/utils/taskView.ts';

const view = (id: string, name = `View ${id}`): SavedView => ({
  id,
  name,
  view: { ...DEFAULT_VIEW_STATE, nav: { type: 'project', id: 'work' }, priority: 4, sortBy: 'dueDate' },
  createdAt: 1,
});

describe('SavedViewListSchema', () => {
  it('accepts valid views and rejects bad ones', () => {
    expect(SavedViewListSchema.safeParse([view('a'), view('b')]).success).toBe(true);
    expect(SavedViewListSchema.safeParse([view('a'), view('a')]).success).toBe(false);
    expect(SavedViewListSchema.safeParse([{ ...view('a'), name: '  ' }]).success).toBe(false);
    expect(
      SavedViewListSchema.safeParse([{ ...view('a'), view: { ...view('a').view, sortBy: 'random' } }]).success
    ).toBe(false);
    expect(
      SavedViewListSchema.safeParse([{ ...view('a'), view: { ...view('a').view, nav: { type: 'smart', id: 'nope' } } }])
        .success
    ).toBe(false);
    expect(SavedViewListSchema.safeParse(Array.from({ length: 51 }, (_, i) => view(`v${i}`))).success).toBe(false);
  });
});

describe('resolveSavedView', () => {
  const projects: Project[] = [{ id: 'work', name: 'Work', color: '#6366f1', sortOrder: 1, createdAt: 1, adoEnabled: true }];
  const tagged = { tags: ['urgent'] } as Task;

  it('applies a view whose project still exists unchanged', () => {
    const saved = view('a').view;
    expect(resolveSavedView(saved, projects, [])).toEqual({ view: saved, notice: null });
  });

  it('falls back to All Active, keeping the filters, when the project was deleted', () => {
    const saved = view('a').view;
    const { view: applied, notice } = resolveSavedView(saved, [], []);
    expect(applied).toEqual({ ...saved, nav: { type: 'smart', id: 'inbox' } });
    expect(notice).toMatch(/project no longer exists/);
  });

  it('falls back when no task carries the tag any more', () => {
    const saved = { ...DEFAULT_VIEW_STATE, nav: { type: 'tag', id: 'urgent' } } as const;
    expect(resolveSavedView(saved, projects, [tagged]).notice).toBeNull();
    expect(resolveSavedView(saved, projects, []).view.nav).toEqual({ type: 'smart', id: 'inbox' });
  });

  it('sameView compares every field', () => {
    const saved = view('a').view;
    expect(sameView(saved, { ...saved, nav: { type: 'project', id: 'work' } })).toBe(true);
    expect(sameView(saved, { ...saved, search: 'x' })).toBe(false);
    expect(sameView(saved, { ...saved, nav: { type: 'tag', id: 'work' } })).toBe(false);
    expect(sameView(saved, { ...saved, layout: 'month' })).toBe(false);
  });

  it('reads views saved before layouts existed as lists', () => {
    const { layout: _layout, ...old } = view('a').view;
    expect(ViewStateSchema.parse(old).layout).toBe('list');
  });
});

describe('Saved views API', () => {
  let app: FastifyInstance;
  const json = async (method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object });
    return { status: res.statusCode, body: res.json() };
  };

  beforeEach(async () => {
    app = (await buildApp({ dbPath: ':memory:' })).app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('stores, replaces and validates the list', async () => {
    expect((await json('GET', '/api/dashboard')).body.savedViews).toEqual([]);

    const put = await json('PUT', '/api/dashboard/saved-views', { savedViews: [view('a'), view('b')] });
    expect(put.status).toBe(200);
    expect((await json('GET', '/api/dashboard')).body.savedViews.map((v: SavedView) => v.id)).toEqual(['a', 'b']);

    await json('PUT', '/api/dashboard/saved-views', { savedViews: [view('b')] });
    expect((await json('GET', '/api/dashboard')).body.savedViews).toEqual([view('b')]);

    const tooMany = Array.from({ length: 51 }, (_, i) => view(`v${i}`));
    expect((await json('PUT', '/api/dashboard/saved-views', { savedViews: tooMany })).status).toBe(400);
    expect((await json('PUT', '/api/dashboard/saved-views', { savedViews: [{ id: 'x' }] })).status).toBe(400);
    expect((await json('GET', '/api/dashboard')).body.savedViews).toEqual([view('b')]);
  });

  it('exports saved views (since version 2) and saved views and imports them merged by id', async () => {
    await json('PUT', '/api/dashboard/saved-views', { savedViews: [view('a', 'Mine')] });
    const exported = (await json('GET', '/api/export')).body;
    expect(exported.version).toBeGreaterThanOrEqual(2);
    expect(exported.savedViews).toEqual([view('a', 'Mine')]);

    // Fresh database: round trip restores the views
    await app.close();
    app = (await buildApp({ dbPath: ':memory:' })).app;
    const first = await json('POST', '/api/import', exported);
    expect(first.body.importedSavedViews).toBe(1);
    expect((await json('GET', '/api/dashboard')).body.savedViews).toEqual([view('a', 'Mine')]);

    // Existing ids win; new ones are appended
    const second = await json('POST', '/api/import', {
      ...exported,
      savedViews: [view('a', 'Renamed elsewhere'), view('c')],
    });
    expect(second.body.importedSavedViews).toBe(1);
    expect((await json('GET', '/api/dashboard')).body.savedViews).toEqual([view('a', 'Mine'), view('c')]);
  });

  it('still imports a version 1 backup without saved views', async () => {
    const res = await json('POST', '/api/import', { version: 1, projects: [], tasks: [] });
    expect(res.status).toBe(200);
    expect(res.body.importedSavedViews).toBe(0);
  });
});
