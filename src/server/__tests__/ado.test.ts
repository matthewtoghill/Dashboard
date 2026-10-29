import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { AzError, AzRunner, describeAzFailure, openWorkItemsWiql } from '../routes/ado.ts';
import { externalLinkLabel, externalShortLabel } from '../../client/components/AdoImport.tsx';
import { arrangeAdoItems } from '../../client/components/AdoProjectPanel.tsx';
import { AdoSyncResult, Task } from '../../shared/types.ts';

const ORG = 'https://dev.azure.com/acme/';
const ME = 'me@acme.com';
/** Longer than the other WIQL keys, so the fake az answers the mentions query with it. */
const MENTIONS = 'WHERE [System.Id] IN (@RecentMentions)';

const workItem = (id: number, type: string, project = 'Alpha', state = 'Active') => ({
  id,
  fields: {
    'System.Id': id,
    'System.Title': `Item ${id}`,
    'System.State': state,
    'System.WorkItemType': type,
    'System.TeamProject': project,
  },
});

const pr = (id: number, project: string, reviewers: { uniqueName: string; vote: number }[] = [], status = 'active') => ({
  pullRequestId: id,
  title: `PR ${id}`,
  status,
  repository: { name: 'repo one', project: { name: project } },
  reviewers,
});

/** Fake az: answers from `responses` by matching the start of the joined command line. */
function fakeAz(responses: Record<string, unknown>, calls: string[][] = []): AzRunner {
  return async (args) => {
    calls.push(args);
    const line = args.join(' ').toLowerCase();
    const key = Object.keys(responses)
      .filter((k) => line.includes(k.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) throw new Error(`Unexpected az call: ${line}`);
    const value = responses[key];
    if (value instanceof AzError) throw value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
}

describe('describeAzFailure', () => {
  it('explains the common failures', () => {
    expect(describeAzFailure("'az' is not recognized as an internal or external command")).toMatch(/not found/);
    expect(describeAzFailure('', true)).toMatch(/not found/);
    expect(describeAzFailure("ERROR: 'boards' is misspelled or not recognized by the system.")).toMatch(
      /az extension add --name azure-devops/
    );
    expect(describeAzFailure("ERROR: Please run 'az login' to setup account.")).toMatch(/Run az login/);
    expect(describeAzFailure('WARNING: x\nERROR: TF401180: not found')).toBe('Azure CLI: TF401180: not found');
  });

  it('quotes project names in WIQL', () => {
    expect(openWorkItemsWiql(["O'Brien", 'Beta'])).toContain("[System.TeamProject] IN ('O''Brien', 'Beta')");
    expect(openWorkItemsWiql()).not.toContain('TeamProject] IN');
  });

  it('filters, sorts and groups project panel items', () => {
    const item = (id: number, type: string, state: string, taskId: string | null = null) => ({
      externalId: `workitem/${id}`,
      title: `Item ${id}`,
      url: `${ORG}_workitems/edit/${id}`,
      adoProject: 'Alpha',
      type,
      state,
      role: null,
      repo: null,
      mention: null,
      taskId,
    });
    const items = [item(1, 'Bug', 'Active'), item(2, 'Task', 'New'), item(3, 'Bug', 'New', 'task-3')];
    const base = { search: '', type: '', state: '', showImported: false, sortBy: 'id', groupBy: 'none' } as const;
    const ids = (groups: ReturnType<typeof arrangeAdoItems>) =>
      groups.map(([name, list]) => [name, list.map((i) => i.externalId.split('/')[1]).join()]);

    expect(ids(arrangeAdoItems(items, base))).toEqual([['', '2,1']]);
    expect(ids(arrangeAdoItems(items, { ...base, showImported: true, groupBy: 'type' }))).toEqual([
      ['Bug', '3,1'],
      ['Task', '2'],
    ]);
    expect(ids(arrangeAdoItems(items, { ...base, showImported: true, state: 'New', sortBy: 'type' }))).toEqual([
      ['', '3,2'],
    ]);
    expect(ids(arrangeAdoItems(items, { ...base, search: '#1' }))).toEqual([['', '1']]);
  });

  it('formats full and compact labels for external ids', () => {
    expect(externalLinkLabel('workitem/123')).toBe('Azure DevOps work item 123');
    expect(externalLinkLabel('pr/45')).toBe('Azure DevOps pull request 45');
    expect(externalShortLabel('workitem/123')).toBe('#123');
    expect(externalShortLabel('pr/45')).toBe('PR #45');
    expect(externalLinkLabel('mention/7')).toBe('Azure DevOps mention on work item 7');
    expect(externalShortLabel('mention/7')).toBe('@#7');
  });
});

describe('Azure DevOps import', () => {
  let app: FastifyInstance;
  let calls: string[][];
  let responses: Record<string, unknown>;

  beforeEach(async () => {
    calls = [];
    responses = {
      'devops configure --list': `[defaults]\norganization = ${ORG}\nproject = Alpha\n`,
      'account show': `${ME}\n`,
      [MENTIONS]: [],
      'boards query': [workItem(1, 'Task'), workItem(2, 'Feature'), workItem(3, 'Bug', 'Beta')],
      '--project Alpha --status active --creator me': [pr(10, 'Alpha')],
      '--project Alpha --status active --reviewer me': [
        pr(10, 'Alpha', [{ uniqueName: ME, vote: 0 }]), // also authored: listed once
        pr(11, 'Alpha', [{ uniqueName: 'ME@acme.com', vote: 0 }]),
        pr(12, 'Alpha', [{ uniqueName: ME, vote: 10 }]), // already approved
      ],
    };
    const runner: AzRunner = (args) => fakeAz(responses, calls)(args);
    ({ app } = await buildApp({ dbPath: ':memory:', az: runner }));
  });

  afterEach(async () => {
    await app.close();
  });

  /** A check now; `cached` reads the stored result instead. */
  const fetchItems = async (cached = false) => {
    const res = await app.inject({ method: 'GET', url: cached ? '/api/ado/items' : '/api/ado/items?refresh=1' });
    return { status: res.statusCode, body: res.json() as AdoSyncResult & { error?: string } };
  };
  const putSettings = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', payload });
  const putLinks = (links: unknown[]) => app.inject({ method: 'PUT', url: '/api/ado/projects', payload: { links } });
  const createProject = async (name: string) =>
    (await app.inject({ method: 'POST', url: '/api/projects', payload: { name } })).json().project.id as string;
  const listTasks = async () => (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks as Task[];

  it('validates and replaces project mappings', async () => {
    const projectId = await createProject('Work');
    expect((await putLinks([{ adoProject: 'Alpha', projectId, workItemTypes: ['Task'] }])).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/ado/projects' })).json().links).toEqual([
      { adoProject: 'Alpha', projectId, workItemTypes: ['Task'], ignoredStates: null },
    ]);

    expect((await putLinks([{ adoProject: 'Alpha' }, { adoProject: 'alpha' }])).statusCode).toBe(400);
    expect((await putLinks([{ adoProject: 'Al"pha' }])).statusCode).toBe(400);
    expect((await putLinks([{ adoProject: '100%' }])).statusCode).toBe(400);
    expect((await putLinks([{ adoProject: 'Beta', projectId: 'missing' }])).statusCode).toBe(400);

    await putLinks([]);
    expect((await app.inject({ method: 'GET', url: '/api/ado/projects' })).json().links).toEqual([]);
  });

  it('fetches work items by type and PRs for mapped projects only', async () => {
    let { body } = await fetchItems();
    // Default types; no mapped projects, so no PR calls
    expect(body.items.map((i) => i.externalId)).toEqual(['workitem/1', 'workitem/3']);
    expect(calls.some((c) => c.includes('pr'))).toBe(false);
    expect(body.items[0]).toMatchObject({ url: `${ORG}_workitems/edit/1`, type: 'Task', adoProject: 'Alpha' });

    await putLinks([{ adoProject: 'alpha', workItemTypes: ['Feature'] }]);
    ({ body } = await fetchItems());
    expect(body.items.map((i) => [i.externalId, i.role])).toEqual([
      ['workitem/2', null],
      ['workitem/3', null],
      ['pr/10', 'author'],
      ['pr/11', 'reviewer'],
    ]);
    expect(body.items.find((i) => i.externalId === 'pr/10')!.url).toBe(
      `${ORG}Alpha/_git/repo%20one/pullrequest/10`
    );
  });

  it('fetches recent mentions with their comment and imports them as reply tasks', async () => {
    responses[MENTIONS] = [workItem(7, 'Product Backlog Item'), workItem(8, 'Bug', 'Beta')];
    responses['rest --method get'] = 'ME-GUID\n';
    responses['workItemId=7'] = {
      comments: [
        { text: '<div>later</div>', createdBy: { displayName: 'Other' } },
        {
          text: '<div>FYI&nbsp;<a href="#" data-vss-mention="version:2.0,me-guid">@Me</a> &amp; co</div>',
          createdDate: '2026-10-01T00:00:00Z',
          createdBy: { displayName: 'Sam Smith' },
        },
      ],
    };
    responses['workItemId=8'] = new AzError('boom');

    let { body } = await fetchItems();
    const mention = body.items.find((i) => i.externalId === 'mention/7')!;
    expect(mention).toMatchObject({
      role: 'mention',
      url: `${ORG}_workitems/edit/7`,
      mention: { by: 'Sam Smith', at: '2026-10-01T00:00:00Z', snippet: 'FYI @Me & co', repliesAfter: 1 },
    });
    // A failed comment lookup still lists the mention
    expect(body.items.find((i) => i.externalId === 'mention/8')).toMatchObject({ role: 'mention', mention: null });
    expect(body.warnings).toEqual([]);

    await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: [mention] } });
    expect((await listTasks()).map((t) => t.title)).toContain('Reply to Sam on PBI 7: Item 7');

    // Imported: its comment isn't fetched again, and dropping off the list doesn't close the task
    calls.length = 0;
    ({ body } = await fetchItems());
    expect(calls.some((c) => c.includes('workItemId=7'))).toBe(false);
    responses[MENTIONS] = [];
    ({ body } = await fetchItems());
    expect(body.closed).toEqual([]);
  });

  it('uses the organization from settings when set', async () => {
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { adoOrganization: 'https://dev.azure.com/other' } });
    await fetchItems();
    expect(calls.some((c) => c[0] === 'devops')).toBe(false);
    expect(calls.find((c) => c[0] === 'boards')).toContain('https://dev.azure.com/other/');
    expect(
      (await app.inject({ method: 'PUT', url: '/api/settings', payload: { adoOrganization: 'https://x" & calc' } }))
        .statusCode
    ).toBe(400);
  });

  it('reports az failures as 502 and per-project PR failures as warnings', async () => {
    await putLinks([{ adoProject: 'Alpha' }]);
    responses['--project Alpha --status active --creator me'] = new AzError('Azure CLI: project not found');
    let res = await fetchItems();
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual(['Alpha: Azure CLI: project not found']);

    responses['boards query'] = new AzError('Not signed in to Azure DevOps. Run az login, then try again.');
    res = await fetchItems();
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/az login/);

    responses['devops configure --list'] = '[defaults]\n';
    res = await fetchItems();
    expect(res.body.error).toMatch(/No Azure DevOps organization/);
  });

  it('imports items once, into the mapped project, and flags closed sources', async () => {
    const projectId = await createProject('Work');
    await putLinks([{ adoProject: 'Alpha', projectId }]);
    const { body } = await fetchItems();

    const pick = body.items.filter((i) => ['workitem/1', 'pr/11', 'workitem/3'].includes(i.externalId));
    const res = await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: pick } });
    expect(res.json()).toEqual({ importedCount: 3 });
    expect((await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: pick } })).json()).toEqual({
      importedCount: 0,
    });

    const tasks = await listTasks();
    expect(tasks.map((t) => [t.title, t.projectId, t.adoLinks.map((l) => l.externalId)])).toEqual([
      ['Item 1', projectId, ['workitem/1']],
      ['Item 3', null, ['workitem/3']],
      ['Review: PR 11', projectId, ['pr/11']],
    ]);
    expect(tasks[0].adoLinks[0]).toMatchObject({ url: `${ORG}_workitems/edit/1`, title: 'Item 1', type: 'Task', state: 'Active' });

    const refetched = (await fetchItems()).body;
    expect(refetched.items.find((i) => i.externalId === 'workitem/1')!.taskId).toBe(tasks[0].id);
    expect(refetched.closed).toEqual([]);

    // Work item 1 closed and PR 11 merged: both drop off the open lists
    responses['boards query'] = [workItem(3, 'Bug', 'Beta')];
    responses['WHERE [System.Id] IN'] = [workItem(1, 'Task', 'Alpha', 'Done')];
    responses['--project Alpha --status active --reviewer me'] = [];
    responses['repos pr show'] = pr(11, 'Alpha', [], 'completed');
    const closed = (await fetchItems()).body.closed;
    expect(closed.map((c) => [c.title, c.state]).sort()).toEqual([
      ['Item 1', 'Done'],
      ['Review: PR 11', 'Completed'],
    ]);

    // Completed tasks are no longer flagged
    await app.inject({ method: 'PATCH', url: `/api/tasks/${tasks[0].id}`, payload: { status: 'done' } });
    expect((await fetchItems()).body.closed.map((c) => c.title)).toEqual(['Review: PR 11']);
    // The check refreshed the closed item's snapshot
    expect((await listTasks()).find((t) => t.id === tasks[0].id)!.adoLinks[0].state).toBe('Done');
  });

  it('links several items to an existing task, flags it closed once all are, and unlinks', async () => {
    const { body } = await fetchItems();
    const task = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'Mine' } })).json().task as Task;
    const link = (items: unknown[], taskId: string) =>
      app.inject({ method: 'POST', url: '/api/ado/import', payload: { items, taskId } });

    expect((await link(body.items, 'missing')).statusCode).toBe(404);
    expect((await link(body.items, task.id)).json()).toEqual({ importedCount: 2 });
    let tasks = await listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].adoLinks.map((l) => l.externalId)).toEqual(['workitem/1', 'workitem/3']);
    // Already linked: skipped
    expect((await link(body.items, task.id)).json()).toEqual({ importedCount: 0 });
    expect((await fetchItems(true)).body.items.map((i) => i.taskId)).toEqual([task.id, task.id]);

    // One of two closed: not flagged yet
    responses['boards query'] = [workItem(3, 'Bug', 'Beta')];
    responses['WHERE [System.Id] IN'] = [workItem(1, 'Task', 'Alpha', 'Done')];
    expect((await fetchItems()).body.closed).toEqual([]);
    responses['boards query'] = [];
    responses['WHERE [System.Id] IN'] = [workItem(1, 'Task', 'Alpha', 'Done'), workItem(3, 'Bug', 'Beta', 'Closed')];
    expect((await fetchItems()).body.closed).toEqual([{ taskId: task.id, title: 'Mine', state: 'Done, Closed' }]);

    expect((await app.inject({ method: 'DELETE', url: '/api/ado/links/workitem/3' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/ado/links/workitem/3' })).statusCode).toBe(404);
    tasks = await listTasks();
    expect(tasks[0].adoLinks.map((l) => l.externalId)).toEqual(['workitem/1']);
  });

  it('rejects non-https links and round-trips imported tasks and mappings through export', async () => {
    const bad = { externalId: 'workitem/9', title: 'x', url: 'javascript:alert(1)', adoProject: 'A', type: 'Task', state: 'New' };
    expect((await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: [bad] } })).statusCode).toBe(400);

    const projectId = await createProject('Work');
    await putLinks([{ adoProject: 'Alpha', projectId, workItemTypes: ['Bug'] }]);
    await app.inject({
      method: 'POST',
      url: '/api/ado/import',
      payload: { items: [{ ...bad, url: `${ORG}_workitems/edit/9` }] },
    });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.version).toBe(10);

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const task = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks[0];
    expect(task.adoLinks).toEqual([expect.objectContaining({ externalId: 'workitem/9', type: 'Task' })]);
    expect((await fresh.inject({ method: 'GET', url: '/api/ado/projects' })).json().links).toEqual([
      { adoProject: 'Alpha', projectId, workItemTypes: ['Bug'], ignoredStates: null },
    ]);
    // A task under a new id comes in, but its item stays linked to the first task
    exported.tasks[0].id = 'other-id';
    expect((await fresh.inject({ method: 'POST', url: '/api/import', payload: exported })).json().importedTasks).toBe(1);
    const copy = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks.find((t: Task) => t.id === 'other-id');
    expect(copy.adoLinks).toEqual([]);
    await fresh.close();
  });

  it('imports the single link of a backup from before version 7', async () => {
    const legacy = {
      version: 6,
      tasks: [
        {
          id: 't1', title: 'Old', description: '', status: 'todo', priority: 0, projectId: null, tags: [],
          dueDate: null, sortOrder: 0, completedAt: null, createdAt: 5, updatedAt: 5,
          externalSource: 'ado', externalId: 'pr/7', externalUrl: `${ORG}Alpha/_git/r/pullrequest/7`,
        },
      ],
    };
    expect((await app.inject({ method: 'POST', url: '/api/import', payload: legacy })).statusCode).toBe(200);
    expect((await listTasks())[0].adoLinks).toEqual([
      { externalId: 'pr/7', url: `${ORG}Alpha/_git/r/pullrequest/7`, title: 'Old', type: 'Pull Request', state: '', linkedAt: 5 },
    ]);
  });

  it('serves the stored result, with current task links, and keeps it when a check fails', async () => {
    // No stored result yet: the first read checks
    expect((await fetchItems(true)).body.items.map((i) => i.externalId)).toEqual(['workitem/1', 'workitem/3']);
    const boardCalls = () => calls.filter((c) => c[0] === 'boards').length;
    const before = boardCalls();

    let { body } = await fetchItems(true);
    expect(boardCalls()).toBe(before);
    expect(body.checkedAt).toEqual(expect.any(Number));
    expect(body.error).toBeNull();

    // An import shows straight away, without asking az
    await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: [body.items[0]] } });
    ({ body } = await fetchItems(true));
    expect(body.items[0].taskId).toEqual(expect.any(String));
    expect(boardCalls()).toBe(before);

    responses['boards query'] = new AzError('Not signed in to Azure DevOps. Run az login, then try again.');
    expect((await fetchItems()).status).toBe(502);
    ({ body } = await fetchItems(true));
    expect(body.items).toHaveLength(2);
    expect(body.error).toMatch(/az login/);
    expect(body.lastErrorAt).toEqual(expect.any(Number));
  });

  it('moves dismissed items out of the list until restored, and exports them', async () => {
    const dismiss = (externalIds: string[], dismissed: boolean) =>
      app.inject({ method: 'POST', url: '/api/ado/dismissed', payload: { externalIds, dismissed } });
    await fetchItems();
    expect((await dismiss(['workitem/3'], true)).statusCode).toBe(204);
    expect((await dismiss(['workitem/3'], true)).statusCode).toBe(204); // again: no change
    let { body } = await fetchItems(true);
    expect(body.items.map((i) => i.externalId)).toEqual(['workitem/1']);
    expect(body.dismissed.map((i) => i.externalId)).toEqual(['workitem/3']);
    // A later check keeps it dismissed
    ({ body } = await fetchItems());
    expect(body.dismissed.map((i) => i.externalId)).toEqual(['workitem/3']);

    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.adoDismissed).toEqual([{ externalId: 'workitem/3', dismissedAt: expect.any(Number) }]);
    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    expect((await fresh.inject({ method: 'GET', url: '/api/export' })).json().adoDismissed).toEqual(exported.adoDismissed);
    await fresh.close();

    expect((await dismiss(['workitem/3'], false)).statusCode).toBe(204);
    ({ body } = await fetchItems(true));
    expect(body.items.map((i) => i.externalId)).toEqual(['workitem/1', 'workitem/3']);
    expect(body.dismissed).toEqual([]);
    expect((await dismiss(['bogus'], true)).statusCode).toBe(400);
  });

  it('leaves out ignored states, and flags imported tasks that reach one as closed', async () => {
    responses['boards query'] = [
      workItem(1, 'Task'),
      workItem(2, 'Task', 'Alpha', 'Ready for QA'),
      workItem(3, 'Bug', 'Beta', 'In UAT'),
    ];
    await putSettings({ adoIgnoredStates: ['ready for qa'] });
    expect((await fetchItems()).body.items.map((i) => i.externalId)).toEqual(['workitem/1', 'workitem/3']);

    // A mapping's own list replaces the default
    responses['--project Beta'] = [];
    await putLinks([{ adoProject: 'Beta', ignoredStates: ['In UAT'] }]);
    let { body } = await fetchItems();
    expect(body.items.map((i) => i.externalId)).toEqual(['workitem/1']);

    await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: [body.items[0]] } });
    responses['boards query'] = [workItem(2, 'Task', 'Alpha', 'Active')];
    responses['WHERE [System.Id] IN'] = [workItem(1, 'Task', 'Alpha', 'Ready for QA')];
    ({ body } = await fetchItems());
    expect(body.closed.map((c) => [c.title, c.state])).toEqual([['Item 1', 'Ready for QA']]);
  });

  it('skips ADO projects linked to a Dashboard project with Azure DevOps off', async () => {
    const projectId = await createProject('Work');
    await putLinks([{ adoProject: 'Alpha', projectId }]);
    let { body } = await fetchItems();
    await app.inject({ method: 'POST', url: '/api/ado/import', payload: { items: [body.items[0]] } }); // workitem/1

    const patch = await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { adoEnabled: false } });
    expect(patch.json().project.adoEnabled).toBe(false);
    calls.length = 0;
    responses['boards query'] = [workItem(3, 'Bug', 'Beta')];
    responses['WHERE [System.Id] IN'] = [workItem(1, 'Task', 'Alpha', 'Done')];
    ({ body } = await fetchItems());
    expect(body.items.map((i) => i.externalId)).toEqual(['workitem/3']);
    expect(body.closed).toEqual([]);
    expect(calls.some((c) => c[0] === 'repos')).toBe(false);

    await app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, payload: { adoEnabled: true } });
    expect((await fetchItems()).body.closed.map((c) => c.title)).toEqual(['Item 1']);
  });

  it('only fetches projects mapped to a Dashboard project when asked', async () => {
    await putSettings({ adoLinkedProjectsOnly: true });
    await putLinks([{ adoProject: 'Alpha' }]);
    let { body } = await fetchItems();
    expect(body.items).toEqual([]);
    expect(body.warnings[0]).toMatch(/No Azure DevOps project is mapped/);
    expect(calls.some((c) => c[0] === 'boards' || c[0] === 'repos')).toBe(false);

    const projectId = await createProject('Work');
    await putLinks([{ adoProject: 'Alpha', projectId }, { adoProject: 'Beta' }]);
    ({ body } = await fetchItems());
    expect(calls.find((c) => c[0] === 'boards')!.join(' ')).toContain("[System.TeamProject] IN ('Alpha')");
    expect(calls.filter((c) => c[0] === 'repos').every((c) => c.includes('Alpha'))).toBe(true);
    expect(body.items.map((i) => i.externalId)).toContain('pr/10');
  });

  it('lists enabled work item types for one project, or across mapped projects', async () => {
    const types = (...names: [string, boolean?][]) => ({ value: names.map(([name, isDisabled]) => ({ name, isDisabled })) });
    responses['project=Alpha'] = types(['Task'], ['Bug'], ['Old', true]);
    responses['project=Beta'] = types(['Bug'], ['Product Backlog Item']);
    responses['project=Gone'] = new AzError('Azure CLI: project not found');
    const get = async (query = '') => {
      const res = await app.inject({ method: 'GET', url: `/api/ado/work-item-types${query}` });
      return { status: res.statusCode, body: res.json() as { types: string[]; fetchedAt: number | null } };
    };
    const typeCalls = () => calls.filter((c) => c.includes('workitemtypes')).length;

    // No mappings: the az default project
    expect((await get()).body.types).toEqual(['Bug', 'Task']);

    await putLinks([{ adoProject: 'Alpha' }, { adoProject: 'Beta' }, { adoProject: 'Gone' }]);
    const all = await get();
    expect(all.body.types).toEqual(['Bug', 'Product Backlog Item', 'Task']);
    expect(all.body.fetchedAt).toEqual(expect.any(Number));
    expect((await get('?project=Beta')).body.types).toEqual(['Bug', 'Product Backlog Item']);
    expect((await get('?project=Gone')).status).toBe(502);
    expect((await get('?project=a%22b')).status).toBe(400);

    // Cached: only the project that failed is asked again, until a refresh
    const before = typeCalls();
    responses['project=Beta'] = types(['Epic']);
    expect((await get()).body.types).toEqual(['Bug', 'Product Backlog Item', 'Task']);
    expect(typeCalls()).toBe(before + 1); // Gone
    expect((await get('?refresh=1')).body.types).toEqual(['Bug', 'Epic', 'Task']);
    expect(typeCalls()).toBe(before + 4);

    // A different organization setting starts a fresh cache
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { adoOrganization: 'https://dev.azure.com/other' } });
    await get('?project=Alpha');
    expect(typeCalls()).toBe(before + 5);
  });
});
