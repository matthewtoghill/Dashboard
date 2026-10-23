import { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { SettingsResponse, SettingsSchema, UpdateSettingsInputSchema } from '../../shared/types.ts';
import { readSettings, writeSettings } from '../settings.ts';

export async function registerSettingsRoutes(app: FastifyInstance, sqlite: Database.Database) {
  const response = (): SettingsResponse => ({
    settings: readSettings(sqlite),
    envOverrides: {
      backupKeep: process.env.BACKUP_KEEP || null,
      backupDir: process.env.BACKUP_DIR || null,
    },
  });

  // GET /api/settings
  app.get('/api/settings', async () => response());

  // PUT /api/settings — partial update; omitted fields keep their value
  app.put('/api/settings', async (request, reply) => {
    const parsed = UpdateSettingsInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid settings', details: parsed.error.flatten() });
    }
    const next = SettingsSchema.parse({ ...readSettings(sqlite), ...parsed.data });
    if (next.backupDir && !path.isAbsolute(next.backupDir)) {
      return reply.status(400).send({ error: 'Backup folder must be an absolute path' });
    }
    writeSettings(sqlite, next);
    return response();
  });
}
