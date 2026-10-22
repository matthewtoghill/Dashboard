import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.ts';
import { MIGRATIONS, runMigrations } from './migrations.ts';
import { backupDatabase, resolveBackupConfig } from '../backup.ts';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbFilePath?: string): {
  db: AppDatabase;
  sqlite: Database.Database;
  /** Resolved file path, or ':memory:' */
  dbPath: string;
} {
  const resolvedPath =
    dbFilePath ?? process.env.DB_PATH ?? path.resolve(process.cwd(), 'data', 'dashboard.db');

  if (resolvedPath !== ':memory:') {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  try {
    // Snapshot existing data before changing its schema (skipped for new, empty databases)
    if (resolvedPath !== ':memory:' && needsMigration(sqlite)) {
      backupDatabase(sqlite, resolveBackupConfig(resolvedPath));
    }
    runMigrations(sqlite);
  } catch (err) {
    sqlite.close();
    throw err;
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite, dbPath: resolvedPath };
}

function needsMigration(sqlite: Database.Database): boolean {
  const version = sqlite.pragma('user_version', { simple: true }) as number;
  const tables = (
    sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
      n: number;
    }
  ).n;
  return tables > 0 && version < MIGRATIONS.length;
}
