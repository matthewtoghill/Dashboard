import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';
import { readSettings, writeSettings } from '../settings.ts';

describe('settings', () => {
  let dir: string;
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildApp>>['db'];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-settings-'));
    ({ app, db } = await buildApp({ dbPath: path.join(dir, 'test.db') }));
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
        adoReviewDoneWhen: 'completed',
        weekStartDay: 1,
        streakSkipsWeekends: false,
        staleTaskDays: 14,
        chaseHoldDays: 7,
        planSize: 6,
        statusNoteStyle: 'line',
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

    // Omitted fields keep their saved value rather than resetting to the default
    await put({ completionAnimation: 'confetti', density: 'compact' });
    const kept = (await put({ completionAnimationFollowsPointer: false })).json().settings;
    expect(kept).toMatchObject({
      backupKeep: 3,
      completionAnimation: 'confetti',
      completionAnimationFollowsPointer: false,
      density: 'compact',
    });

    expect((await put({ backupKeep: 0 })).statusCode).toBe(400);
    expect((await put({ weekStartDay: 2 })).statusCode).toBe(400);
    expect((await put({ backupDir: 'relative/path' })).statusCode).toBe(400);
    expect((await put({ inProgressColor: 'red' })).statusCode).toBe(400);
    expect((await put({ density: 'huge' })).statusCode).toBe(400);
    expect((await put({ statusNoteStyle: 'banner' })).statusCode).toBe(400);
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

  it('only accepts Azure DevOps hosts as the organization, since az sends a token there', async () => {
    for (const org of ['https://dev.azure.com/acme', 'https://dev.azure.com/acme/', 'https://acme.visualstudio.com']) {
      expect((await put({ adoOrganization: org })).statusCode).toBe(200);
    }
    for (const org of [
      'https://attacker.example/',
      'https://dev.azure.com.attacker.example/acme',
      'https://attacker.example/dev.azure.com/acme',
      'http://dev.azure.com/acme',
    ]) {
      expect((await put({ adoOrganization: org })).statusCode).toBe(400);
    }
  });

  it('keeps the other settings when a stored value no longer passes validation', async () => {
    await put({ backupKeep: 5 });
    // e.g. saved before the organization rule was tightened
    writeSettings(db.$client, { ...readSettings(db.$client), adoOrganization: 'https://attacker.example/' });
    expect(readSettings(db.$client)).toMatchObject({ backupKeep: 5, adoOrganization: '' });
  });
});
