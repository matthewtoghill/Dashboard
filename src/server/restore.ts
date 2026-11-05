import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as schema from './db/schema.ts';
import { AppDatabase } from './db/index.ts';
import { runMigrations } from './db/migrations.ts';
import { listBackups } from './backup.ts';
import { readSettings, readStoredSettings, writeSettings } from './settings.ts';
import { eq } from 'drizzle-orm';
import {
  exportPayload,
  getSavedViews,
  importPayload,
  insertTaskChildren,
  setSavedViews,
  setScratchpad,
  taskValues,
} from './routes/dashboard.ts';
import {
  MAX_SAVED_VIEWS,
  RESTORE_SECTIONS,
  type BackupPayload,
  type RestoreDiff,
  type RestoreFieldChange,
  type RestoreItem,
  type RestoreRequest,
  type RestoreResult,
  type RestoreSection,
  type Settings,
} from '../shared/types.ts';

/**
 * Selective restore from a local backup (see docs/PLAN-RESTORE.md).
 *
 * A backup is never opened directly: it is copied to the temp folder and migrated there, since
 * older backups have an older schema. The copy is deleted afterwards.
 */

export interface BackupSnapshot {
  payload: BackupPayload;
  /** Only the settings stored in the backup; newer fields are left out rather than defaulted. */
  settings: Partial<Settings>;
}

/** Runs `fn` on a migrated copy of the backup. Returns null when `file` is not a backup in `dir`. */
export function withBackupSnapshot<T>(dir: string, file: string, fn: (snapshot: BackupSnapshot) => T): T | null {
  // The name comes from the client: accepting only listed names blocks path traversal
  if (!listBackups(dir).some((b) => b.file === file)) return null;

  const copyPath = path.join(os.tmpdir(), `dashboard-restore-${crypto.randomUUID()}.db`);
  fs.copyFileSync(path.join(dir, file), copyPath);
  let sqlite: Database.Database | undefined;
  try {
    sqlite = new Database(copyPath);
    runMigrations(sqlite);
    const db = drizzle(sqlite, { schema }) as AppDatabase;
    return fn({ payload: exportPayload(db), settings: readStoredSettings(sqlite) });
  } finally {
    sqlite?.close();
    fs.rmSync(copyPath, { force: true });
  }
}

type Fields = Record<string, unknown>;

interface SectionRule<T> {
  key: (item: T) => string;
  label: (item: T) => string;
  /** What is compared; defaults to the item itself. */
  compare?: (item: T) => Fields;
  /** Only offer items missing from the live database, never changed ones. */
  missingOnly?: boolean;
  /** Leave items out of the section altogether. */
  include?: (item: T) => boolean;
}

/** Differences in these fields alone don't make an item changed; they're still listed alongside others. */
const HOUSEKEEPING_FIELDS = new Set(['updatedAt']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function fieldChanges(backup: Fields, live: Fields, skip = new Set<string>()): RestoreFieldChange[] {
  const fields = new Set([...Object.keys(backup), ...Object.keys(live)]);
  return [...fields]
    .filter((field) => !skip.has(field) && !same(backup[field], live[field]))
    .map((field) => ({ field, backup: backup[field], live: live[field] }));
}

function diffSection<T>(backup: T[], live: T[], rule: SectionRule<T>): RestoreItem[] {
  const compare = rule.compare ?? ((item: T) => item as Fields);
  const liveByKey = new Map(live.map((item) => [rule.key(item), item]));
  const items: RestoreItem[] = [];
  for (const item of backup) {
    if (rule.include && !rule.include(item)) continue;
    const id = rule.key(item);
    const label = rule.label(item);
    const current = liveByKey.get(id);
    if (!current) {
      items.push({ id, label, state: 'missing', changes: [] });
      continue;
    }
    if (rule.missingOnly) continue;
    const changes = fieldChanges(compare(item), compare(current));
    if (changes.some((c) => !HOUSEKEEPING_FIELDS.has(c.field))) items.push({ id, label, state: 'changed', changes });
  }
  return items;
}

type Payload = BackupPayload;
type Item<S extends RestoreSection> = Payload[S][number];

const RULES: { [S in RestoreSection]: SectionRule<Item<S>> } = {
  projects: { key: (p) => p.id, label: (p) => p.name },
  tasks: {
    key: (t) => t.id,
    label: (t) => t.title,
    // latestNote is derived from the activity log. A link's title, type and state are rewritten
    // by every ADO check, so only which items are linked counts.
    compare: ({ latestNote: _latestNote, adoLinks, ...task }) => ({
      ...task,
      adoLinks: adoLinks.map(({ externalId, url }) => ({ externalId, url })),
    }),
  },
  notes: { key: (n) => n.id, label: (n) => n.title || 'Untitled note' },
  quickLinks: { key: (l) => l.id, label: (l) => l.title },
  savedViews: { key: (v) => v.id, label: (v) => v.name },
  // Sessions change with every hook event and unlinked ones are pruned, so only linked sessions
  // that are gone are offered
  claudeSessions: {
    key: (s) => s.sessionId,
    label: (s) => s.title || s.cwd,
    missingOnly: true,
    include: (s) => s.taskId !== null,
  },
  claudeFolderLinks: { key: (l) => l.path, label: (l) => l.path },
  adoProjectLinks: { key: (l) => l.adoProject, label: (l) => l.adoProject },
  // Only the time it was dismissed could differ
  adoDismissed: { key: (d) => d.externalId, label: (d) => d.externalId, missingOnly: true },
};

/** What restoring from `backup` could bring back or overwrite in `live`. Never lists live-only items. */
export function diffPayloads(backup: BackupSnapshot, live: { payload: Payload; settings: Settings }): RestoreDiff {
  const sections = Object.fromEntries(
    Object.entries(RULES).map(([section, rule]) => [
      section,
      diffSection(
        backup.payload[section as RestoreSection] as unknown[],
        live.payload[section as RestoreSection] as unknown[],
        rule as SectionRule<unknown>
      ),
    ])
  ) as RestoreDiff['sections'];

  // The backup folder is machine-specific and never restored
  const settings = fieldChanges(backup.settings, live.settings, new Set(['backupDir'])).filter(
    (c) => c.field in backup.settings
  );

  // Restore never deletes, so an empty backup scratchpad is not offered
  const backupText = backup.payload.scratchpad ?? '';
  const liveText = live.payload.scratchpad ?? '';
  const scratchpad = backupText.trim() && backupText !== liveText ? { backup: backupText, live: liveText } : null;

  return { sections, settings, scratchpad };
}

/** A restore request that can't be applied as asked; nothing has been changed. */
export class RestoreError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

type Selected = { [S in RestoreSection]: Item<S>[] };

export interface RestorePlan {
  /** Missing items to insert, through importPayload. */
  payload: BackupPayload;
  /** Changed items to update in place. */
  overwrite: Selected;
  settings: Partial<Settings>;
  scratchpad: string | null;
  result: RestoreResult;
}

const counts = (items: Selected) =>
  Object.fromEntries(RESTORE_SECTIONS.map((section) => [section, items[section].length])) as Record<RestoreSection, number>;

/**
 * Works out what `selection` restores from `backup` into `live`, without changing anything.
 * Throws a RestoreError when an id, setting or the scratchpad isn't offered by the diff.
 */
export function planRestore(
  backup: BackupSnapshot,
  live: { payload: BackupPayload; settings: Settings },
  selection: RestoreRequest
): RestorePlan {
  const diff = diffPayloads(backup, live);
  const warnings: string[] = [];

  // Each id must be listed in the diff with the matching state: missing to add, changed to overwrite
  const pick = (state: RestoreItem['state'], ids: RestoreRequest['add']): Selected => {
    const select = <S extends RestoreSection>(section: S): Item<S>[] => {
      const wanted = new Set(ids?.[section] ?? []);
      const offered = new Set(diff.sections[section].filter((i) => i.state === state).map((i) => i.id));
      const notOffered = [...wanted].filter((id) => !offered.has(id));
      if (notOffered.length) {
        throw new RestoreError(
          state === 'missing'
            ? `Not missing from the database, so it can't be added (${section}): ${notOffered.join(', ')}`
            : `Not changed since the backup, so it can't be overwritten (${section}): ${notOffered.join(', ')}`
        );
      }
      const rule = RULES[section] as SectionRule<Item<S>>;
      return (backup.payload[section] as Item<S>[]).filter((item) => wanted.has(rule.key(item)));
    };
    return Object.fromEntries(RESTORE_SECTIONS.map((section) => [section, select(section)])) as Selected;
  };
  const add = pick('missing', selection.add);
  const overwrite = pick('changed', selection.overwrite);

  const projectIds = new Set([...live.payload.projects, ...add.projects].map((p) => p.id));
  const projectName = (id: string) => backup.payload.projects.find((p) => p.id === id)?.name ?? id;
  const taskIds = new Set([...live.payload.tasks, ...add.tasks].map((t) => t.id));

  // A project that isn't there after the restore is dropped, rather than restored unticked
  for (const items of [add, overwrite]) {
    items.tasks = items.tasks.map((task) => {
      if (!task.projectId || projectIds.has(task.projectId)) return task;
      warnings.push(`Task "${task.title}" was restored without its project "${projectName(task.projectId)}".`);
      return { ...task, projectId: null };
    });
    items.claudeFolderLinks = items.claudeFolderLinks.filter((l) => {
      if (projectIds.has(l.projectId)) return true;
      warnings.push(`Folder link "${l.path}" was skipped because its project "${projectName(l.projectId)}" isn't in the database.`);
      return false;
    });
    items.adoProjectLinks = items.adoProjectLinks.map((l) => {
      if (!l.projectId || projectIds.has(l.projectId)) return l;
      warnings.push(`ADO project "${l.adoProject}" was restored without its project "${projectName(l.projectId)}".`);
      return { ...l, projectId: null };
    });
  }

  // An unlinked session would be pruned straight away, so it isn't restored without its task
  add.claudeSessions = add.claudeSessions.filter((s) => {
    if (s.taskId && taskIds.has(s.taskId)) return true;
    warnings.push(`Claude session "${s.title || s.cwd}" was skipped because its task isn't in the database.`);
    return false;
  });

  const room = Math.max(0, MAX_SAVED_VIEWS - live.payload.savedViews.length);
  for (const view of add.savedViews.slice(room)) {
    warnings.push(`Saved view "${view.name}" was skipped: at most ${MAX_SAVED_VIEWS} saved views.`);
  }
  add.savedViews = add.savedViews.slice(0, room);

  const restoredTaskIds = new Set(add.tasks.map((t) => t.id));
  const payload: BackupPayload = {
    ...backup.payload,
    ...add,
    taskEvents: backup.payload.taskEvents.filter((e) => restoredTaskIds.has(e.taskId)),
    // Settings and the scratchpad are applied by applyRestore, not by import's keep-existing rules
    settings: undefined,
    scratchpad: undefined,
  };

  const offeredSettings = new Set(diff.settings.map((c) => c.field));
  const badSettings = (selection.settings ?? []).filter((key) => !offeredSettings.has(key));
  if (badSettings.length) throw new RestoreError(`These settings don't differ from the backup: ${badSettings.join(', ')}`);
  const settings = Object.fromEntries(
    (selection.settings ?? []).map((key) => [key, backup.settings[key as keyof Settings]])
  ) as Partial<Settings>;

  if (selection.scratchpad && !diff.scratchpad) throw new RestoreError('The backup has no scratchpad text to restore');
  const scratchpad = selection.scratchpad ? diff.scratchpad!.backup : null;

  return {
    payload,
    overwrite,
    settings,
    scratchpad,
    result: {
      restored: counts(add),
      overwritten: counts(overwrite),
      settings: Object.keys(settings).length,
      scratchpad: scratchpad !== null,
      warnings,
    },
  };
}

/**
 * Updates changed items in place to the backup's values. Never deletes and re-inserts a task:
 * that would cascade to its history, links and Claude sessions.
 */
function overwriteItems(db: AppDatabase, items: Selected): void {
  for (const { id, ...project } of items.projects) {
    db.update(schema.projects).set(project).where(eq(schema.projects.id, id)).run();
  }
  for (const task of items.tasks) {
    const { id, ...values } = taskValues(task);
    db.update(schema.tasks).set(values).where(eq(schema.tasks.id, id)).run();
    // Subtasks become the backup's; links from the backup are added back, newer links stay
    db.delete(schema.subtasks).where(eq(schema.subtasks.taskId, id)).run();
    insertTaskChildren(db, task);
  }
  for (const { id, tags, ...note } of items.notes) {
    db.update(schema.notes).set({ ...note, tags: JSON.stringify(tags) }).where(eq(schema.notes.id, id)).run();
  }
  for (const { id, ...link } of items.quickLinks) {
    db.update(schema.quickLinks).set(link).where(eq(schema.quickLinks.id, id)).run();
  }
  if (items.savedViews.length) {
    const byId = new Map(items.savedViews.map((v) => [v.id, v]));
    setSavedViews(db, getSavedViews(db).map((v) => byId.get(v.id) ?? v));
  }
  for (const { path: folder, projectId } of items.claudeFolderLinks) {
    db.update(schema.claudeFolderLinks).set({ projectId }).where(eq(schema.claudeFolderLinks.path, folder)).run();
  }
  for (const { adoProject, projectId, workItemTypes, ignoredStates } of items.adoProjectLinks) {
    db.update(schema.adoProjectLinks)
      .set({
        projectId,
        workItemTypes: workItemTypes ? JSON.stringify(workItemTypes) : null,
        ignoredStates: ignoredStates ? JSON.stringify(ignoredStates) : null,
      })
      .where(eq(schema.adoProjectLinks.adoProject, adoProject))
      .run();
  }
}

/** Applies a plan in one transaction: all of it or, if anything fails, none of it. */
export function applyRestore(db: AppDatabase, plan: RestorePlan): RestoreResult {
  db.transaction(() => {
    importPayload(db, plan.payload);
    overwriteItems(db, plan.overwrite);
    if (Object.keys(plan.settings).length) {
      writeSettings(db.$client, { ...readSettings(db.$client), ...plan.settings });
    }
    if (plan.scratchpad !== null) setScratchpad(db, plan.scratchpad);
  });
  return plan.result;
}
