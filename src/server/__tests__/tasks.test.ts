import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import {
  parseQuickAddSyntax,
  computeDashboardStats,
  tasksToCsv,
  sortOrderForMove,
} from '../../client/utils/taskUtils.ts';

describe('Tasks, Projects, Subtasks & Dashboard REST API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const built = await buildApp({ dbPath: ':memory:' });
    app = built.app;
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates, lists, updates, toggles completion, and deletes tasks', async () => {
    const emptyRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.json()).toEqual({ tasks: [] });

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: 'Write Stage 2 MVP',
        priority: 3,
        dueDate: '2026-10-22',
        tags: ['frontend', 'urgent'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json().task;
    expect(created.title).toBe('Write Stage 2 MVP');
    expect(created.status).toBe('todo');
    expect(created.priority).toBe(3);
    expect(created.dueDate).toBe('2026-10-22');
    expect(created.tags).toEqual(['frontend', 'urgent']);
    expect(created.subtasks).toEqual([]);
    expect(created.completedAt).toBeNull();

    const completeRes = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}`,
      payload: { status: 'done' },
    });
    expect(completeRes.statusCode).toBe(200);
    const completed = completeRes.json().task;
    expect(completed.status).toBe('done');
    expect(typeof completed.completedAt).toBe('number');

    const editRes = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}`,
      payload: { title: 'Write Stage 2 MVP (Updated)', status: 'todo', priority: 4 },
    });
    expect(editRes.statusCode).toBe(200);
    const edited = editRes.json().task;
    expect(edited.title).toBe('Write Stage 2 MVP (Updated)');
    expect(edited.status).toBe('todo');
    expect(edited.priority).toBe(4);
    expect(edited.completedAt).toBeNull();

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/tasks/${created.id}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    const finalRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });
    expect(finalRes.json()).toEqual({ tasks: [] });
  });

  it('rejects empty task titles with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates, updates, assigns tasks to projects, and nullifies task projectId on project deletion', async () => {
    const projRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Engineering', color: '#10b981' },
    });
    expect(projRes.statusCode).toBe(201);
    const project = projRes.json().project;

    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Implement project filter', projectId: project.id },
    });
    expect(taskRes.statusCode).toBe(201);
    expect(taskRes.json().task.projectId).toBe(project.id);

    const delProjRes = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
    });
    expect(delProjRes.statusCode).toBe(204);

    const tasksAfterRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });
    expect(tasksAfterRes.json().tasks[0].projectId).toBeNull();
  });

  it('manages subtasks and bulk clears completed tasks', async () => {
    const taskRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'Ship Stage 3 Drawer' },
    });
    const task = taskRes.json().task;

    // Add two subtasks
    const sub1Res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/subtasks`,
      payload: { title: 'Add markdown editor' },
    });
    expect(sub1Res.statusCode).toBe(201);
    const sub1 = sub1Res.json().subtask;
    expect(sub1.isCompleted).toBe(false);

    const sub2Res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/subtasks`,
      payload: { title: 'Add subtasks progress bar' },
    });
    expect(sub2Res.statusCode).toBe(201);
    const sub2 = sub2Res.json().subtask;

    // Toggle first subtask complete
    const toggleSubRes = await app.inject({
      method: 'PATCH',
      url: `/api/subtasks/${sub1.id}`,
      payload: { isCompleted: true },
    });
    expect(toggleSubRes.statusCode).toBe(200);
    expect(toggleSubRes.json().subtask.isCompleted).toBe(true);

    // Fetch tasks and verify subtasks array is embedded
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/tasks',
    });
    const fetchedTask = listRes.json().tasks[0];
    expect(fetchedTask.subtasks).toHaveLength(2);
    expect(fetchedTask.subtasks[0].isCompleted).toBe(true);
    expect(fetchedTask.subtasks[1].isCompleted).toBe(false);

    // Delete second subtask
    const delSubRes = await app.inject({
      method: 'DELETE',
      url: `/api/subtasks/${sub2.id}`,
    });
    expect(delSubRes.statusCode).toBe(204);

    // Mark parent task done, archive it, restore it, then bulk delete it
    const doneRes = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'done' },
    });
    const completedAt = doneRes.json().task.completedAt;

    const archiveRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-archive',
      payload: { ids: [task.id] },
    });
    expect(archiveRes.json().archivedCount).toBe(1);
    let fetched = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks[0];
    expect(fetched.status).toBe('archived');
    expect(fetched.completedAt).toBe(completedAt);

    const restoreRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-restore',
      payload: { ids: [task.id] },
    });
    expect(restoreRes.json().restoredCount).toBe(1);
    fetched = (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks[0];
    expect(fetched.status).toBe('done');
    expect(fetched.completedAt).toBe(completedAt);

    const deleteRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-delete',
      payload: { ids: [task.id] },
    });
    expect(deleteRes.json().deletedCount).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks).toHaveLength(0);

    const emptyIdsRes = await app.inject({
      method: 'POST',
      url: '/api/tasks/bulk-archive',
      payload: { ids: [] },
    });
    expect(emptyIdsRes.statusCode).toBe(400);
  });

  it('restores archived tasks to the status they had before archiving', async () => {
    const create = async (title: string, status: string) =>
      (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title, status } })).json()
        .task;
    const wip = await create('In flight', 'in_progress');
    const viaPatch = await create('Archived by PATCH', 'in_progress');
    const get = async (id: string) =>
      (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks.find(
        (t: { id: string }) => t.id === id
      );

    await app.inject({ method: 'POST', url: '/api/tasks/bulk-archive', payload: { ids: [wip.id] } });
    expect((await get(wip.id)).statusBeforeArchive).toBe('in_progress');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${viaPatch.id}`,
      payload: { status: 'archived' },
    });
    expect(patched.json().task.statusBeforeArchive).toBe('in_progress');

    // Survives an export/import round trip into a fresh database
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    const fresh = (await buildApp({ dbPath: ':memory:' })).app;
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    await fresh.inject({
      method: 'POST',
      url: '/api/tasks/bulk-restore',
      payload: { ids: [wip.id, viaPatch.id] },
    });
    const restored = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks;
    expect(restored.map((t: { status: string }) => t.status)).toEqual(['in_progress', 'in_progress']);
    expect(restored.every((t: { statusBeforeArchive: unknown }) => t.statusBeforeArchive === null)).toBe(true);
    await fresh.close();
  });

  it('reorders tasks atomically within the range they occupy', async () => {
    const base = {
      description: '', status: 'todo', priority: 0, projectId: null, tags: [], dueDate: null,
      completedAt: null, createdAt: 1, updatedAt: 1,
    };
    // Three tasks sharing sortOrder 5 (as imports can produce), plus one elsewhere
    await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: {
        tasks: [
          ...['a', 'b', 'c'].map((id) => ({ ...base, id, title: id, sortOrder: 5 })),
          { ...base, id: 'z', title: 'z', sortOrder: 100 },
        ],
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks/reorder',
      payload: { ids: ['c', 'a', 'b'] },
    });
    expect(res.statusCode).toBe(200);
    const byOrder = (await app.inject({ method: 'GET', url: '/api/tasks' }))
      .json()
      .tasks.sort((x: { sortOrder: number }, y: { sortOrder: number }) => x.sortOrder - y.sortOrder)
      .map((t: { id: string; sortOrder: number; updatedAt: number }) => [t.id, t.sortOrder, t.updatedAt]);
    expect(byOrder).toEqual([['c', 5, 1], ['a', 6, 1], ['b', 7, 1], ['z', 100, 1]]);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/tasks/reorder',
      payload: { ids: ['a', 'missing'] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('rejects cross-site origins and non-loopback hosts', async () => {
    const evilOrigin = await app.inject({
      method: 'GET',
      url: '/api/export',
      headers: { origin: 'https://evil.example' },
    });
    expect(evilOrigin.statusCode).toBe(403);
    expect(evilOrigin.headers['access-control-allow-origin']).toBeUndefined();

    const rebound = await app.inject({
      method: 'GET',
      url: '/api/export',
      headers: { host: 'evil.example:3001' },
    });
    expect(rebound.statusCode).toBe(403);

    const devProxy = await app.inject({
      method: 'GET',
      url: '/api/tasks',
      headers: { host: '127.0.0.1:3001', origin: 'http://localhost:5173' },
    });
    expect(devProxy.statusCode).toBe(200);
  });

  it('validates dates, colours and URLs, and imports all-or-nothing', async () => {
    const badDate = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { title: 'x', dueDate: 'banana' },
    });
    expect(badDate.statusCode).toBe(400);

    const badColor = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'x', color: 'red;background:url(x)' },
    });
    expect(badColor.statusCode).toBe(400);

    const base = {
      description: '',
      status: 'todo',
      priority: 0,
      projectId: null,
      tags: [],
      dueDate: null,
      sortOrder: 0,
      completedAt: null,
      createdAt: 1,
      updatedAt: 1,
    };
    const failed = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: {
        tasks: [
          { ...base, id: 'ok', title: 'fine' },
          { ...base, id: 'dangling', title: 'bad ref', projectId: 'missing-project' },
        ],
      },
    });
    expect(failed.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks).toHaveLength(0);

    const imported = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: {
        tasks: [{ ...base, id: 'ok', title: 'fine' }],
        quickLinks: [
          { id: 'l1', title: 'x', url: 'javascript:alert(1)', sortOrder: 0, createdAt: 0 },
        ],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ importedTasks: 1, importedProjects: 0, importedQuickLinks: 1 });
    const state = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(state.quickLinks[0].url).toBe('https://javascript:alert(1)');
  });

  it('manages scratchpad, quick links, widget config, and JSON export/import', async () => {
    // 1. Update scratchpad
    const scratchRes = await app.inject({
      method: 'PUT',
      url: '/api/dashboard/scratchpad',
      payload: { content: '- Draft release announcement\n- Check metrics' },
    });
    expect(scratchRes.statusCode).toBe(200);
    expect(scratchRes.json().scratchpad).toContain('Draft release announcement');

    // 2. Add a quick link (auto-prefixes https://)
    const linkRes = await app.inject({
      method: 'POST',
      url: '/api/quick-links',
      payload: { title: 'GitHub', url: 'github.com', category: 'Code' },
    });
    expect(linkRes.statusCode).toBe(201);
    const link = linkRes.json().quickLink;
    expect(link.url).toBe('https://github.com');

    // 3. Update widget config
    const cfgRes = await app.inject({
      method: 'PUT',
      url: '/api/dashboard/widgets',
      payload: { showHeaderSummary: false },
    });
    expect(cfgRes.statusCode).toBe(200);
    expect(cfgRes.json().widgetConfig.showHeaderSummary).toBe(false);

    // 4. Export full backup
    const exportRes = await app.inject({
      method: 'GET',
      url: '/api/export',
    });
    expect(exportRes.statusCode).toBe(200);
    const exported = exportRes.json();
    expect(exported.scratchpad).toContain('Draft release announcement');
    expect(exported.quickLinks).toHaveLength(1);

    // 5. Delete quick link and re-import backup
    await app.inject({
      method: 'DELETE',
      url: `/api/quick-links/${link.id}`,
    });

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/import',
      payload: exported,
    });
    expect(importRes.statusCode).toBe(200);

    const stateRes = await app.inject({
      method: 'GET',
      url: '/api/dashboard',
    });
    expect(stateRes.json().quickLinks).toHaveLength(1);
  });

  it('parses quick-add syntax tokens and computes dashboard stats & CSV', () => {
    const projects = [
      { id: 'proj-work', name: 'Work', color: '#6366f1', sortOrder: 1, createdAt: 1 },
    ];
    const parsed = parseQuickAddSyntax(
      'Fix login bug !urgent #work #Auth @2026-11-01',
      projects,
      {
        priority: 0,
        projectId: null,
        dueDate: null,
        tags: [],
      }
    );

    expect(parsed.title).toBe('Fix login bug');
    expect(parsed.priority).toBe(4);
    expect(parsed.projectId).toBe('proj-work');
    expect(parsed.tags).toEqual(['Auth']);
    expect(parsed.dueDate).toBe('2026-11-01');

    const now = Date.now();
    const sampleTasks = [
      {
        id: 't1',
        title: 'Task 1',
        description: '',
        status: 'done' as const,
        priority: 3 as const,
        projectId: 'proj-work',
        tags: ['Auth'],
        dueDate: null,
        sortOrder: 1,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
        statusBeforeArchive: null,
        recurrence: null,
        recurrenceParentId: null,
        subtasks: [],
      },
    ];
    const stats = computeDashboardStats(sampleTasks);
    expect(stats.totalCompleted).toBe(1);
    expect(stats.completedToday).toBe(1);
    expect(stats.streakDays).toBeGreaterThanOrEqual(1);

    const csv = tasksToCsv(sampleTasks, projects);
    expect(csv).toContain('Task 1');
    expect(csv).toContain('Work');
  });

  it('computes manual sort orders between neighbours', () => {
    expect(sortOrderForMove([], 0)).toBe(0);
    expect(sortOrderForMove([10, 20, 30], 0)).toBe(9);
    expect(sortOrderForMove([10, 20, 30], 3)).toBe(31);
    expect(sortOrderForMove([10, 20, 30], 1)).toBe(15);
    expect(sortOrderForMove([0, 0, 0], 1)).toBeNull(); // duplicates: caller renumbers
  });
});
