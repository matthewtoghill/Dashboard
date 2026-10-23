import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { AzError, AzRunner, describeAzFailure } from '../routes/ado.ts';
import { externalLinkLabel, externalShortLabel } from '../../client/components/AdoImport.tsx';
import { AdoFetchResult, Task } from '../../shared/types.ts';

const ORG = 'https://dev.azure.com/acme/';
const ME = 'me@acme.com';

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

  it('formats full and compact labels for external ids', () => {
    expect(externalLinkLabel('workitem/123')).toBe('Azure DevOps work item 123');
    expect(externalLinkLabel('pr/45')).toBe('Azure DevOps pull request 45');
    expect(externalShortLabel('workitem/123')).toBe('#123');
    expect(externalShortLabel('pr/45')).toBe('PR #45');
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

  const fetchItems = async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ado/items' });
    return { status: res.statusCode, body: res.json() as AdoFetchResult & { error?: string } };
  };
  const putLinks = (links: unknown[]) => app.inject({ method: 'PUT', url: '/api/ado/projects', payload: { links } });
  const createProject = async (name: string) =>
    (await app.inject({ method: 'POST', url: '/api/projects', payload: { name } })).json().project.id as string;
  const listTasks = async () => (await app.inject({ method: 'GET', url: '/api/tasks' })).json().tasks as Task[];

  it('validates and replaces project mappings', async () => {
    const projectId = await createProject('Work');
    expect((await putLinks([{ adoProject: 'Alpha', projectId, workItemTypes: ['Task'] }])).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/ado/projects' })).json().links).toEqual([
      { adoProject: 'Alpha', projectId, workItemTypes: ['Task'] },
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
    expect(tasks.map((t) => [t.title, t.projectId, t.externalId])).toEqual([
      ['Item 1', projectId, 'workitem/1'],
      ['Item 3', null, 'workitem/3'],
      ['Review: PR 11', projectId, 'pr/11'],
    ]);
    expect(tasks[0]).toMatchObject({ externalSource: 'ado', externalUrl: `${ORG}_workitems/edit/1` });

    const refetched = (await fetchItems()).body;
    expect(refetched.items.find((i) => i.externalId === 'workitem/1')!.taskId).toBe(tasks[0].id);
    expect(refetched.closed).toEqual([]);

    // Work item 1 closed and PR 11 merged: both drop off the open lists
    responses['boards query'] = [workItem(3, 'Bug', 'Beta')];
    responses['--wiql SELECT [System.Id], [System.State]'] = [workItem(1, 'Task', 'Alpha', 'Done')];
    responses['--project Alpha --status active --reviewer me'] = [];
    responses['repos pr show'] = pr(11, 'Alpha', [], 'completed');
    const closed = (await fetchItems()).body.closed;
    expect(closed.map((c) => [c.externalId, c.state]).sort()).toEqual([
      ['pr/11', 'Completed'],
      ['workitem/1', 'Done'],
    ]);

    // Completed tasks are no longer flagged
    await app.inject({ method: 'PATCH', url: `/api/tasks/${tasks[0].id}`, payload: { status: 'done' } });
    expect((await fetchItems()).body.closed.map((c) => c.externalId)).toEqual(['pr/11']);
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
    expect(exported.version).toBe(5);

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const task = (await fresh.inject({ method: 'GET', url: '/api/tasks' })).json().tasks[0];
    expect(task).toMatchObject({ externalSource: 'ado', externalId: 'workitem/9' });
    expect((await fresh.inject({ method: 'GET', url: '/api/ado/projects' })).json().links).toEqual([
      { adoProject: 'Alpha', projectId, workItemTypes: ['Bug'] },
    ]);
    // Re-importing a task with the same source item under a new id is skipped
    exported.tasks[0].id = 'other-id';
    expect((await fresh.inject({ method: 'POST', url: '/api/import', payload: exported })).json().importedTasks).toBe(0);
    await fresh.close();
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
