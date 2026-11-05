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
import { readStoredSettings } from './settings.ts';
import { exportPayload } from './routes/dashboard.ts';
import type {
  BackupPayload,
  RestoreDiff,
  RestoreFieldChange,
  RestoreItem,
  RestoreSection,
  Settings,
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
