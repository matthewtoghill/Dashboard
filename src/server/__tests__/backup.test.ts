import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupDatabase, isDailyBackupDue, listBackups } from '../backup.ts';
import { createDatabase } from '../db/index.ts';
import { MIGRATIONS } from '../db/migrations.ts';
import { buildApp } from '../index.ts';

describe('backups', () => {
  let dir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-backup-'));
    dbPath = path.join(dir, 'test.db');
    backupDir = path.join(dir, 'backups');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes restorable snapshots and keeps only the newest N', () => {
    const { sqlite } = createDatabase(dbPath);
    sqlite
      .prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('t1', 'Backed up', 1, 1);

    for (let i = 0; i < 5; i++) backupDatabase(sqlite, { dir: backupDir, keep: 3 });
    sqlite.close();

    const backups = listBackups(backupDir);
    expect(backups).toHaveLength(3);
    const restored = new Database(path.join(backupDir, backups[0].file), { readonly: true });
    expect(restored.prepare('SELECT title FROM tasks').all()).toEqual([{ title: 'Backed up' }]);
    restored.close();
  });

  it('backs up an existing database before migrating it, but not a brand-new one', () => {
    const fresh = path.join(dir, 'fresh.db');
    createDatabase(fresh).sqlite.close();
    expect(listBackups(path.join(dir, 'backups'))).toHaveLength(0);
    fs.rmSync(fresh);

    // A database written by an older app version: original tables, no migrations recorded
    const old = new Database(dbPath);
    old.exec(MIGRATIONS[0]);
    old.close();

    const { sqlite } = createDatabase(dbPath);
    expect(sqlite.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    sqlite.close();
    expect(listBackups(backupDir)).toHaveLength(1);
  });

  it('runs a daily backup at startup and before imports, and serves the list', async () => {
    const { app } = await buildApp({ dbPath });
    expect(listBackups(backupDir)).toHaveLength(1); // startup: none in the last 24h

    const imported = await app.inject({ method: 'POST', url: '/api/import', payload: {} });
    expect(imported.statusCode).toBe(200);
    expect(listBackups(backupDir)).toHaveLength(2);

    const created = await app.inject({ method: 'POST', url: '/api/backups' });
    expect(created.statusCode).toBe(201);

    const list = (await app.inject({ method: 'GET', url: '/api/backups' })).json();
    expect(list.enabled).toBe(true);
    expect(list.backups).toHaveLength(3);
    await app.close();

    // A restart within 24 hours does not add another daily copy
    const again = await buildApp({ dbPath });
    expect(listBackups(backupDir)).toHaveLength(3);
    await again.app.close();
  });

  it('reports daily backups as due only after 24 hours', () => {
    expect(isDailyBackupDue(backupDir)).toBe(true);
    const { sqlite } = createDatabase(dbPath);
    backupDatabase(sqlite, { dir: backupDir, keep: 5 });
    sqlite.close();
    expect(isDailyBackupDue(backupDir)).toBe(false);
    expect(isDailyBackupDue(backupDir, Date.now() + 25 * 60 * 60 * 1000)).toBe(true);
  });

  it('is disabled for in-memory databases', async () => {
    const { app } = await buildApp({ dbPath: ':memory:' });
    expect((await app.inject({ method: 'GET', url: '/api/backups' })).json().enabled).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/backups' })).statusCode).toBe(400);
    await app.close();
  });
});
