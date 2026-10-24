import { FastifyInstance, FastifyReply } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { AppDatabase } from '../db/index.ts';
import { adoProjectLinks, DbAdoProjectLink, keyValueStore, projects, tasks } from '../db/schema.ts';
import { readSettings } from '../settings.ts';
import { recordTaskEvents } from '../taskEvents.ts';
import {
  AdoFetchResult,
  AdoImportInputSchema,
  AdoItem,
  AdoProjectLink,
  AdoProjectLinkListSchema,
  AdoProjectNameSchema,
  AdoSyncResult,
} from '../../shared/types.ts';

/** Runs `az` with the given arguments and resolves with its stdout. */
export type AzRunner = (args: string[]) => Promise<string>;

export class AzError extends Error {}

const CLOSED_STATES = ['Done', 'Closed', 'Removed'];

const wiqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Open work assigned to me, optionally limited to some projects. */
export function openWorkItemsWiql(projects?: string[]): string {
  return (
    'SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.TeamProject] ' +
    'FROM WorkItems WHERE [System.AssignedTo] = @Me ' +
    `AND [System.State] NOT IN (${CLOSED_STATES.map(wiqlString).join(', ')}) ` +
    (projects ? `AND [System.TeamProject] IN (${projects.map(wiqlString).join(', ')}) ` : '') +
    'ORDER BY [System.ChangedDate] DESC'
  );
}

/** Turns az's stderr into a message that says what to do about it. */
export function describeAzFailure(stderr: string, notFound = false): string {
  if (/misspelled or not recognized by the system/i.test(stderr)) {
    return 'The azure-devops extension for the Azure CLI is missing. Run: az extension add --name azure-devops';
  }
  if (notFound || /is not recognized as an internal or external command|command not found/i.test(stderr)) {
    return 'The Azure CLI (az) was not found. Install it, then run az login.';
  }
  if (/az login|az devops login|AADSTS|refresh token|not logged in/i.test(stderr)) {
    return 'Not signed in to Azure DevOps. Run az login, then try again.';
  }
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const error = lines.find((l) => l.startsWith('ERROR:')) ?? lines[0];
  return error ? `Azure CLI: ${error.replace(/^ERROR:\s*/, '')}` : 'The Azure CLI failed.';
}

export const runAz: AzRunner = (args) =>
  new Promise((resolve, reject) => {
    const windows = process.platform === 'win32';
    // az is a .cmd script on Windows, which Node only starts through cmd.exe. Each argument is
    // double-quoted there; values from users are validated to contain no " or % (see types.ts).
    execFile(
      'az',
      windows ? args.map((a) => `"${a}"`) : args,
      { shell: windows, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout);
        const notFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
        reject(new AzError(describeAzFailure(String(stderr), notFound)));
      }
    );
  });

const parseJson = <T>(stdout: string): T => JSON.parse(stdout || 'null') as T;

const withSlash = (url: string) => (url.endsWith('/') ? url : `${url}/`);

interface AzWorkItem {
  id: number;
  fields: Record<string, string | undefined>;
}

interface AzPullRequest {
  pullRequestId: number;
  title: string;
  status: string;
  isDraft?: boolean;
  repository: { name: string; project: { name: string } };
  reviewers?: { uniqueName?: string; vote?: number }[];
}

export function workItemToItem(org: string, wi: AzWorkItem): AdoItem {
  return {
    externalId: `workitem/${wi.id}`,
    title: wi.fields['System.Title'] || `Work item ${wi.id}`,
    url: `${org}_workitems/edit/${wi.id}`,
    adoProject: wi.fields['System.TeamProject'] ?? '',
    type: wi.fields['System.WorkItemType'] ?? '',
    state: wi.fields['System.State'] ?? '',
    role: null,
  };
}

export function pullRequestToItem(org: string, pr: AzPullRequest, role: 'author' | 'reviewer'): AdoItem {
  const project = pr.repository.project.name;
  return {
    externalId: `pr/${pr.pullRequestId}`,
    title: pr.title || `Pull request ${pr.pullRequestId}`,
    url: `${org}${encodeURIComponent(project)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`,
    adoProject: project,
    type: 'Pull Request',
    state: pr.isDraft ? 'Draft' : pr.status,
    role,
  };
}

/** True when `me` is a reviewer on the PR who has not voted yet. */
export function awaitsMyVote(pr: AzPullRequest, me: string): boolean {
  if (pr.isDraft) return false;
  const mine = pr.reviewers?.find((r) => r.uniqueName?.toLowerCase() === me.toLowerCase());
  return !!mine && !mine.vote;
}

function parseStringList(json: string | null): string[] | null {
  try {
    const raw = json ? JSON.parse(json) : null;
    return Array.isArray(raw) ? raw.map(String) : null;
  } catch {
    return null;
  }
}

function serializeLink(row: DbAdoProjectLink): AdoProjectLink {
  return {
    adoProject: row.adoProject,
    projectId: row.projectId ?? null,
    workItemTypes: parseStringList(row.workItemTypes),
    ignoredStates: parseStringList(row.ignoredStates),
  };
}

export function listAdoProjectLinks(db: AppDatabase): AdoProjectLink[] {
  return db.select().from(adoProjectLinks).orderBy(adoProjectLinks.adoProject).all().map(serializeLink);
}

const TYPE_CACHE_KEY = 'ado_work_item_types';
/** Cache entry for the az default project, used while no projects are mapped. */
const DEFAULT_PROJECT = '*default';

/**
 * Work item types by lower-cased project name. Keyed by the organization setting as saved
 * (empty = az default), so changing it starts a fresh cache without asking az.
 */
interface TypeCache {
  org: string;
  /** `states` is the union over the enabled types; missing in caches written before it existed. */
  projects: Record<string, { types: string[]; states?: string[]; fetchedAt: number }>;
}

function readTypeCache(db: AppDatabase): TypeCache {
  const org = readSettings(db.$client).adoOrganization;
  const row = db.select().from(keyValueStore).where(eq(keyValueStore.key, TYPE_CACHE_KEY)).get();
  try {
    const cache = row ? (JSON.parse(row.value) as TypeCache) : null;
    if (cache?.org === org && cache.projects) return cache;
  } catch {
    // Unreadable: start again
  }
  return { org, projects: {} };
}

function writeValue(db: AppDatabase, key: string, data: unknown): void {
  const value = JSON.stringify(data);
  db.insert(keyValueStore)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: keyValueStore.key, set: { value, updatedAt: Date.now() } })
    .run();
}

const SYNC_KEY = 'ado_sync';

/** The last check's result, kept when a later check fails. */
interface SyncState {
  result: AdoFetchResult | null;
  checkedAt: number | null;
  error: string | null;
  lastErrorAt: number | null;
}

function readSyncState(db: AppDatabase): SyncState {
  const row = db.select().from(keyValueStore).where(eq(keyValueStore.key, SYNC_KEY)).get();
  try {
    if (row) return JSON.parse(row.value) as SyncState;
  } catch {
    // Unreadable: start again
  }
  return { result: null, checkedAt: null, error: null, lastErrorAt: null };
}

/** How often the background timer looks at whether a check is due. */
const SYNC_TICK_MS = 60_000;
/** The first look after startup, so a check that fell due while the server was down runs soon. */
const SYNC_STARTUP_DELAY_MS = 10_000;

export async function registerAdoRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  az: AzRunner = runAz,
  options: { backgroundSync?: boolean } = {}
) {
  const linkFor = (links: AdoProjectLink[], adoProject: string) =>
    links.find((l) => l.adoProject.toLowerCase() === adoProject.toLowerCase());

  const resolveOrg = async (): Promise<string> => {
    const configured = readSettings(db.$client).adoOrganization;
    if (configured) return withSlash(configured);
    const defaults = await az(['devops', 'configure', '--list']);
    const match = /^\s*organization\s*=\s*(https:\/\/\S+)/m.exec(defaults);
    if (!match) {
      throw new AzError(
        'No Azure DevOps organization set. Add it under Settings > Integrations, or run ' +
          'az devops configure --defaults organization=https://dev.azure.com/<org>'
      );
    }
    return withSlash(match[1]);
  };

  const sendAzError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof AzError) return reply.status(502).send({ error: err.message });
    throw err;
  };

  // GET /api/ado/projects
  app.get('/api/ado/projects', async () => ({ links: listAdoProjectLinks(db) }));

  // PUT /api/ado/projects — replaces the whole list
  app.put('/api/ado/projects', async (request, reply) => {
    const body = request.body as { links?: unknown } | null;
    const parsed = AdoProjectLinkListSchema.safeParse(body?.links);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid project mappings', details: parsed.error.flatten() });
    }
    const projectIds = [...new Set(parsed.data.flatMap((l) => (l.projectId ? [l.projectId] : [])))];
    const known = projectIds.length
      ? db.select({ id: projects.id }).from(projects).where(inArray(projects.id, projectIds)).all()
      : [];
    if (known.length !== projectIds.length) {
      return reply.status(400).send({ error: 'Unknown Dashboard project' });
    }
    db.transaction((tx) => {
      tx.delete(adoProjectLinks).run();
      for (const link of parsed.data) {
        tx.insert(adoProjectLinks)
          .values({
            adoProject: link.adoProject,
            projectId: link.projectId,
            workItemTypes: link.workItemTypes ? JSON.stringify(link.workItemTypes) : null,
            ignoredStates: link.ignoredStates ? JSON.stringify(link.ignoredStates) : null,
          })
          .run();
      }
    });
    return { links: listAdoProjectLinks(db) };
  });

  // GET /api/ado/work-item-types?project=&refresh=1 — enabled types for the settings pickers: for
  // one project, or for every mapped project (the az default project when none are mapped).
  // Types rarely change, so they are cached in the database; refresh=1 asks Azure DevOps again.
  app.get<{ Querystring: { project?: string; refresh?: string } }>(
    '/api/ado/work-item-types',
    async (request, reply) => {
      const single = request.query.project !== undefined;
      let names: string[];
      if (single) {
        const parsed = AdoProjectNameSchema.safeParse(request.query.project);
        if (!parsed.success) return reply.status(400).send({ error: 'Invalid project name' });
        names = [parsed.data];
      } else {
        names = listAdoProjectLinks(db).map((l) => l.adoProject);
        if (names.length === 0) names = [DEFAULT_PROJECT];
      }

      const cache = readTypeCache(db);
      const missing = names.filter((n) => request.query.refresh === '1' || !cache.projects[n.toLowerCase()]?.states);
      try {
        if (missing.length > 0) {
          const org = await resolveOrg();
          await Promise.all(
            missing.map(async (name) => {
              try {
                let project: string | undefined = name;
                if (name === DEFAULT_PROJECT) {
                  const defaults = await az(['devops', 'configure', '--list']);
                  const parsed = AdoProjectNameSchema.safeParse(/^\s*project\s*=\s*(.+)$/m.exec(defaults)?.[1]);
                  project = parsed.success ? parsed.data : undefined;
                }
                const out = project
                  ? await az([
                      'devops', 'invoke', '--org', org, '--detect', 'false', '--output', 'json',
                      '--area', 'wit', '--resource', 'workitemtypes', '--api-version', '7.1',
                      '--route-parameters', `project=${project}`,
                    ])
                  : '{}';
                const enabled = (
                  parseJson<{ value?: { name: string; isDisabled?: boolean; states?: { name: string }[] }[] }>(out)
                    .value ?? []
                ).filter((t) => !t.isDisabled);
                cache.projects[name.toLowerCase()] = {
                  types: enabled.map((t) => t.name),
                  states: [...new Set(enabled.flatMap((t) => (t.states ?? []).map((st) => st.name)))],
                  fetchedAt: Date.now(),
                };
              } catch (err) {
                // One bad mapped project shouldn't hide the others' types (stale ones stay cached)
                if (single || !(err instanceof AzError)) throw err;
              }
            })
          );
          writeValue(db, TYPE_CACHE_KEY, cache);
        }
      } catch (err) {
        return sendAzError(reply, err);
      }

      const entries = names.flatMap((n) => cache.projects[n.toLowerCase()] ?? []);
      const sorted = (list: string[]) => [...new Set(list)].sort((a, b) => a.localeCompare(b));
      return {
        types: sorted(entries.flatMap((e) => e.types)),
        states: sorted(entries.flatMap((e) => e.states ?? [])),
        /** When the oldest of these lists was fetched; null if none could be. */
        fetchedAt: entries.length ? Math.min(...entries.map((e) => e.fetchedAt)) : null,
      };
    }
  );

  /** Open work assigned to me, plus imported tasks whose source has closed. */
  const fetchItems = async (): Promise<AdoFetchResult> => {
    const org = await resolveOrg();
    const scope = ['--org', org, '--detect', 'false', '--output', 'json'];
    const settings = readSettings(db.$client);
    const allLinks = listAdoProjectLinks(db);
    const linkedOnly = settings.adoLinkedProjectsOnly;
    const links = linkedOnly ? allLinks.filter((l) => l.projectId) : allLinks;
    const lower = (list: string[]) => list.map((t) => t.toLowerCase());
    const typesFor = (project: string) =>
      lower(linkFor(allLinks, project)?.workItemTypes ?? settings.adoWorkItemTypes);
    const ignoredFor = (project: string) =>
      lower(linkFor(allLinks, project)?.ignoredStates ?? settings.adoIgnoredStates);
    const warnings: string[] = [];
    if (linkedOnly && links.length === 0) {
      warnings.push('No Azure DevOps project is mapped to a Dashboard project, so no work was fetched.');
    }

    // PRs can only be listed per project, so only mapped projects are searched
    const listPrs = async (project: string, filter: string[]) => {
      try {
        return parseJson<AzPullRequest[]>(
          await az(['repos', 'pr', 'list', ...scope, '--project', project, '--status', 'active', ...filter])
        );
      } catch (err) {
        if (!(err instanceof AzError)) throw err;
        warnings.push(`${project}: ${err.message}`);
        return [];
      }
    };

    const [workItems, me, prLists] = await Promise.all([
      linkedOnly && links.length === 0
        ? []
        : az([
            'boards', 'query', ...scope, '--wiql',
            openWorkItemsWiql(linkedOnly ? links.map((l) => l.adoProject) : undefined),
          ]).then((out) => parseJson<AzWorkItem[]>(out)),
      az(['account', 'show', '--query', 'user.name', '--output', 'tsv']).then((out) => out.trim()),
      Promise.all(
        links.map(async (l) => ({
          authored: await listPrs(l.adoProject, ['--creator', 'me']),
          reviewing: await listPrs(l.adoProject, ['--reviewer', 'me']),
        }))
      ),
    ]);

    const found = new Map<string, AdoItem>();
    for (const wi of workItems ?? []) {
      const item = workItemToItem(org, wi);
      if (
        typesFor(item.adoProject).includes(item.type.toLowerCase()) &&
        !ignoredFor(item.adoProject).includes(item.state.toLowerCase())
      ) {
        found.set(item.externalId, item);
      }
    }
    for (const { authored, reviewing } of prLists) {
      for (const pr of authored) found.set(`pr/${pr.pullRequestId}`, pullRequestToItem(org, pr, 'author'));
      for (const pr of reviewing) {
        const id = `pr/${pr.pullRequestId}`;
        if (!found.has(id) && awaitsMyVote(pr, me)) found.set(id, pullRequestToItem(org, pr, 'reviewer'));
      }
    }

    const imported = db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        externalId: tasks.externalId,
        externalUrl: tasks.externalUrl,
      })
      .from(tasks)
      .where(eq(tasks.externalSource, 'ado'))
      .all();
    const taskByExternalId = new Map(imported.map((t) => [t.externalId, t.id]));

    // Unfinished imported tasks that dropped off the open list: look up their source's state
    const unfinished = imported.filter(
      (t) => (t.status === 'todo' || t.status === 'in_progress') && t.externalId && !found.has(t.externalId)
    );
    const closedState = new Map<string, string>();
    const workItemIds = unfinished.flatMap((t) => /^workitem\/(\d+)$/.exec(t.externalId!)?.[1] ?? []);
    const prIds = unfinished.flatMap((t) => /^pr\/(\d+)$/.exec(t.externalId!)?.[1] ?? []);
    await Promise.all([
      workItemIds.length > 0 &&
        az([
          'boards', 'query', ...scope, '--wiql',
          'SELECT [System.Id], [System.State], [System.TeamProject] FROM WorkItems ' +
            `WHERE [System.Id] IN (${workItemIds.join(', ')})`,
        ])
          .then((out) => {
            // An ignored state (e.g. Ready for QA) means the work is off my plate, as closed does
            for (const wi of parseJson<AzWorkItem[]>(out) ?? []) {
              const state = wi.fields['System.State'] ?? '';
              const project = wi.fields['System.TeamProject'] ?? '';
              if (CLOSED_STATES.includes(state) || ignoredFor(project).includes(state.toLowerCase())) {
                closedState.set(`workitem/${wi.id}`, state);
              }
            }
          })
          .catch((err) => {
            if (!(err instanceof AzError)) throw err;
            warnings.push(`Checking imported work items: ${err.message}`);
          }),
      ...prIds.map((id) =>
        az(['repos', 'pr', 'show', ...scope, '--id', id])
          .then((out) => {
            const pr = parseJson<AzPullRequest>(out);
            if (pr.status === 'completed') closedState.set(`pr/${id}`, 'Completed');
            if (pr.status === 'abandoned') closedState.set(`pr/${id}`, 'Abandoned');
          })
          .catch((err) => {
            if (!(err instanceof AzError)) throw err;
            warnings.push(`Checking pull request ${id}: ${err.message}`);
          })
      ),
    ]);

    return {
      items: [...found.values()].map((item) => ({ ...item, taskId: taskByExternalId.get(item.externalId) ?? null })),
      closed: unfinished.flatMap((t) => {
        const state = closedState.get(t.externalId!);
        return state
          ? [{ taskId: t.id, title: t.title, externalId: t.externalId!, url: t.externalUrl, state }]
          : [];
      }),
      warnings,
    };
  };

  // One check at a time: a slow az run is shared rather than started again
  let running: Promise<void> | null = null;
  const check = () =>
    (running ??= (async () => {
      const previous = readSyncState(db);
      try {
        const result = await fetchItems();
        writeValue(db, SYNC_KEY, { result, checkedAt: Date.now(), error: null, lastErrorAt: null } satisfies SyncState);
      } catch (err) {
        const error = err instanceof AzError ? err.message : 'The Azure DevOps check failed unexpectedly.';
        writeValue(db, SYNC_KEY, { ...previous, error, lastErrorAt: Date.now() } satisfies SyncState);
        throw err;
      }
    })().finally(() => {
      running = null;
    }));

  /** The stored result, with imports and completions made since the check applied. */
  const syncResult = (): AdoSyncResult => {
    const state = readSyncState(db);
    const imported = db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, externalId: tasks.externalId })
      .from(tasks)
      .where(eq(tasks.externalSource, 'ado'))
      .all();
    const byExternalId = new Map(imported.map((t) => [t.externalId, t.id]));
    const unfinished = new Map(
      imported.filter((t) => t.status === 'todo' || t.status === 'in_progress').map((t) => [t.id, t])
    );
    return {
      items: (state.result?.items ?? []).map((item) => ({ ...item, taskId: byExternalId.get(item.externalId) ?? null })),
      closed: (state.result?.closed ?? []).flatMap((c) => {
        const task = unfinished.get(c.taskId);
        return task ? [{ ...c, title: task.title }] : [];
      }),
      warnings: state.result?.warnings ?? [],
      checkedAt: state.checkedAt,
      error: state.error,
      lastErrorAt: state.lastErrorAt,
    };
  };

  // GET /api/ado/items?refresh=1 — the last check's result; refresh=1 (or no check yet) checks now
  app.get<{ Querystring: { refresh?: string } }>('/api/ado/items', async (request, reply) => {
    if (request.query.refresh === '1' || readSyncState(db).checkedAt === null) {
      try {
        await check();
      } catch (err) {
        return sendAzError(reply, err);
      }
    }
    return syncResult();
  });

  // Background check. Due once the interval has passed since the last attempt, failed or not, so a
  // missing or signed-out az is retried at the interval rather than on every tick.
  if (options.backgroundSync) {
    const tick = () => {
      const minutes = readSettings(db.$client).adoSyncMinutes;
      const { checkedAt, lastErrorAt } = readSyncState(db);
      const last = Math.max(checkedAt ?? 0, lastErrorAt ?? 0);
      if (minutes === 0 || Date.now() - last < minutes * 60_000) return;
      check().catch((err) => {
        if (!(err instanceof AzError)) app.log.error(err, 'Azure DevOps check failed');
      });
    };
    const startup = setTimeout(tick, SYNC_STARTUP_DELAY_MS).unref();
    const timer = setInterval(tick, SYNC_TICK_MS).unref();
    app.addHook('onClose', async () => {
      clearTimeout(startup);
      clearInterval(timer);
    });
  }

  // POST /api/ado/import — creates a task per item; items already imported are skipped
  app.post('/api/ado/import', async (request, reply) => {
    const parsed = AdoImportInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid import payload', details: parsed.error.flatten() });
    }
    const links = listAdoProjectLinks(db);
    const now = Date.now();
    let importedCount = 0;
    db.transaction((tx) => {
      parsed.data.items.forEach((item, i) => {
        const id = crypto.randomUUID();
        const result = tx
          .insert(tasks)
          .values({
            id,
            title: item.role === 'reviewer' ? `Review: ${item.title}` : item.title,
            status: 'todo',
            projectId: linkFor(links, item.adoProject)?.projectId ?? null,
            sortOrder: i - now, // above existing tasks, in the order given
            createdAt: now,
            updatedAt: now,
            externalSource: 'ado',
            externalId: item.externalId,
            externalUrl: item.url,
          })
          .onConflictDoNothing()
          .run();
        if (result.changes > 0) recordTaskEvents(db, id, [{ kind: 'created' }], 'ado', now);
        importedCount += result.changes;
      });
    });
    return { importedCount };
  });
}
