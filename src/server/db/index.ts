import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.ts';
import { runMigrations } from './migrations.ts';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbFilePath?: string): { db: AppDatabase; sqlite: Database.Database } {
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
    runMigrations(sqlite);
  } catch (err) {
    sqlite.close();
    throw err;
  }

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}
