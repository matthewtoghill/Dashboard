import { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { BackupConfig, backupDatabase, listBackups } from '../backup.ts';

/** `getConfig` is null for in-memory databases, where backups are disabled. */
export async function registerBackupRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  getConfig: (() => BackupConfig) | null
) {
  // GET /api/backups — lists the current folder only
  app.get('/api/backups', async () => {
    if (!getConfig) return { enabled: false, backups: [] };
    const { dir, keep } = getConfig();
    return { enabled: true, dir, keep, backups: listBackups(dir) };
  });

  // POST /api/backups — back up now
  app.post('/api/backups', async (request, reply) => {
    if (!getConfig) {
      return reply.status(400).send({ error: 'Backups are disabled for in-memory databases' });
    }
    try {
      return reply.status(201).send({ backup: backupDatabase(sqlite, getConfig()) });
    } catch (err) {
      request.log.error(err, 'Backup failed');
      return reply.status(500).send({
        error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
