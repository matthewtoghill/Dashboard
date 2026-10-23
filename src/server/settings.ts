import type Database from 'better-sqlite3';
import { Settings, SettingsSchema } from '../shared/types.ts';

const SETTINGS_KEY = 'settings';

/**
 * Takes the raw SQLite handle, not Drizzle, so it also works before migrations run (the
 * pre-migration backup reads the backup folder from here).
 */
export function readSettings(sqlite: Database.Database): Settings {
  try {
    const row = sqlite.prepare('SELECT value FROM key_value_store WHERE key = ?').get(SETTINGS_KEY) as
      | { value: string }
      | undefined;
    if (row) return SettingsSchema.parse(JSON.parse(row.value));
  } catch {
    // Missing table (brand-new database) or unreadable value: fall back to defaults
  }
  return SettingsSchema.parse({});
}

export function hasSavedSettings(sqlite: Database.Database): boolean {
  return !!sqlite.prepare('SELECT 1 FROM key_value_store WHERE key = ?').get(SETTINGS_KEY);
}

export function writeSettings(sqlite: Database.Database, settings: Settings): void {
  sqlite
    .prepare(
      `INSERT INTO key_value_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(SETTINGS_KEY, JSON.stringify(settings), Date.now());
}
