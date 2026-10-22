import { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { BackupConfig, backupDatabase, listBackups } from '../backup.ts';

/** `config` is null for in-memory databases, where backups are disabled. */
export async function registerBackupRoutes(
  app: FastifyInstance,
  sqlite: Database.Database,
  config: BackupConfig | null
) {
  // GET /api/backups
  app.get('/api/backups', async () =>
    config
      ? { enabled: true, dir: config.dir, keep: config.keep, backups: listBackups(config.dir) }
      : { enabled: false, backups: [] }
  );

  // POST /api/backups — back up now
  app.post('/api/backups', async (request, reply) => {
    if (!config) {
      return reply.status(400).send({ error: 'Backups are disabled for in-memory databases' });
    }
    try {
      return reply.status(201).send({ backup: backupDatabase(sqlite, config) });
    } catch (err) {
      request.log.error(err, 'Backup failed');
      return reply.status(500).send({
        error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
