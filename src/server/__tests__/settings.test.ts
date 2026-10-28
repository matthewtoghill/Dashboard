import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';

describe('settings', () => {
  let dir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-settings-'));
    ({ app } = await buildApp({ dbPath: path.join(dir, 'test.db') }));
  });

  afterEach(async () => {
    await app.close();
    delete process.env.BACKUP_KEEP;
    delete process.env.BACKUP_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/settings', payload });

  it('returns defaults, merges partial updates and rejects invalid ones', async () => {
    const initial = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(initial).toEqual({
      settings: {
        defaultProjectId: null,
        backupKeep: 14,
        backupDir: '',
        claudeSessionTtlDays: 7,
        adoOrganization: '',
        adoWorkItemTypes: ['Product Backlog Item', 'Task', 'Bug', 'User Story'],
        adoIgnoredStates: [],
        adoLinkedProjectsOnly: false,
        adoSyncMinutes: 30,
        weekStartDay: 1,
        staleTaskDays: 14,
        chaseHoldDays: 7,
        inProgressColor: '#fbbf24',
        primaryColor: 'indigo',
        density: 'comfortable',
        completionAnimation: 'none',
        completionAnimationFollowsPointer: true,
      },
      envOverrides: { backupKeep: null, backupDir: null },
    });

    const updated = await put({ backupKeep: 3 });
    expect(updated.json().settings).toMatchObject({ backupKeep: 3, claudeSessionTtlDays: 7 });

    expect((await put({ backupKeep: 0 })).statusCode).toBe(400);
    expect((await put({ weekStartDay: 2 })).statusCode).toBe(400);
    expect((await put({ backupDir: 'relative/path' })).statusCode).toBe(400);
    expect((await put({ inProgressColor: 'red' })).statusCode).toBe(400);
    expect((await put({ density: 'huge' })).statusCode).toBe(400);
    expect((await put({ primaryColor: 'beige' })).statusCode).toBe(400);
    expect((await put({ unknown: true })).statusCode).toBe(400);
  });

  it('applies backup settings without a restart, with environment variables winning', async () => {
    const newDir = path.join(dir, 'elsewhere');
    await put({ backupKeep: 2, backupDir: newDir });
    for (let i = 0; i < 3; i++) await app.inject({ method: 'POST', url: '/api/backups' });

    const backups = (await app.inject({ method: 'GET', url: '/api/backups' })).json();
    expect(backups).toMatchObject({ dir: newDir, keep: 2 });
    expect(fs.readdirSync(newDir)).toHaveLength(2);

    process.env.BACKUP_KEEP = '5';
    const envDir = path.join(dir, 'from-env');
    process.env.BACKUP_DIR = envDir;
    expect((await app.inject({ method: 'GET', url: '/api/backups' })).json()).toMatchObject({
      dir: envDir,
      keep: 5,
    });
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().envOverrides).toEqual({
      backupKeep: '5',
      backupDir: envDir,
    });
  });

  it('exports settings and imports them only into a database without saved settings', async () => {
    await put({ backupKeep: 4, backupDir: path.join(dir, 'mine'), claudeSessionTtlDays: 30 });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.settings.backupKeep).toBe(4);

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    const imported = (await fresh.inject({ method: 'GET', url: '/api/settings' })).json().settings;
    expect(imported).toMatchObject({ backupKeep: 4, claudeSessionTtlDays: 30, backupDir: '' });

    await fresh.inject({ method: 'PUT', url: '/api/settings', payload: { backupKeep: 9 } });
    await fresh.inject({ method: 'POST', url: '/api/import', payload: exported });
    expect((await fresh.inject({ method: 'GET', url: '/api/settings' })).json().settings.backupKeep).toBe(9);
    await fresh.close();
  });
});
