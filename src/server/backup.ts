import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types.ts';

/**
 * Local database backups.
 *
 * Backups are full SQLite files written with `VACUUM INTO` (a consistent snapshot, safe with
 * WAL and while the app is running). They are taken before schema migrations, before every
 * JSON import, once a day while the server runs, and on demand.
 *
 * Restore (manual): stop the server, copy the chosen backup over the database file
 * (default `data/dashboard.db`, deleting any `-wal`/`-shm` files next to it), start the server.
 */

export interface BackupConfig {
  dir: string;
  keep: number;
}

export interface BackupInfo {
  file: string;
  createdAt: number;
  size: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FILE_PATTERN = /^dashboard-.+\.db$/;

/**
 * The `BACKUP_DIR` and `BACKUP_KEEP` environment variables win over the saved settings.
 * Changing the folder only affects new backups; existing ones stay where they are.
 */
export function resolveBackupConfig(
  dbPath: string,
  settings: Pick<Settings, 'backupDir' | 'backupKeep'>
): BackupConfig {
  const envKeep = Number(process.env.BACKUP_KEEP);
  return {
    dir:
      process.env.BACKUP_DIR || settings.backupDir || path.join(path.dirname(dbPath), 'backups'),
    keep: Number.isInteger(envKeep) && envKeep > 0 ? envKeep : settings.backupKeep,
  };
}

/** Newest first. Names embed an ISO timestamp, so name order is time order. */
export function listBackups(dir: string): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => FILE_PATTERN.test(name))
    .sort()
    .reverse()
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { file: name, createdAt: stat.mtimeMs, size: stat.size };
    });
}

/** Writes a snapshot, then deletes the oldest backups beyond `keep`. */
export function backupDatabase(sqlite: Database.Database, config: BackupConfig): BackupInfo {
  fs.mkdirSync(config.dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let name = `dashboard-${stamp}.db`;
  for (let n = 1; fs.existsSync(path.join(config.dir, name)); n++) {
    name = `dashboard-${stamp}-${n}.db`; // two backups in the same millisecond
  }
  sqlite.prepare('VACUUM INTO ?').run(path.join(config.dir, name));

  for (const old of listBackups(config.dir).slice(config.keep)) {
    fs.rmSync(path.join(config.dir, old.file), { force: true });
  }
  return listBackups(config.dir).find((b) => b.file === name)!;
}

/** True when there is no backup from the last 24 hours. */
export function isDailyBackupDue(dir: string, now = Date.now()): boolean {
  const newest = listBackups(dir)[0];
  return !newest || now - newest.createdAt >= DAY_MS;
}
