import { FastifyInstance } from 'fastify';
import { AppDatabase } from '../db/index.ts';
import { BackupConfig, backupDatabase, listBackups } from '../backup.ts';
import { diffPayloads, withBackupSnapshot } from '../restore.ts';
import { exportPayload } from './dashboard.ts';
import { readSettings } from '../settings.ts';

/** `getConfig` is null for in-memory databases, where backups are disabled. */
export async function registerBackupRoutes(
  app: FastifyInstance,
  db: AppDatabase,
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
      return reply.status(201).send({ backup: backupDatabase(db.$client, getConfig()) });
    } catch (err) {
      request.log.error(err, 'Backup failed');
      return reply.status(500).send({
        error: `Backup failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // GET /api/backups/:file/diff — what a selective restore from this backup could change
  app.get<{ Params: { file: string } }>('/api/backups/:file/diff', async (request, reply) => {
    if (!getConfig) {
      return reply.status(400).send({ error: 'Backups are disabled for in-memory databases' });
    }
    try {
      const diff = withBackupSnapshot(getConfig().dir, request.params.file, (snapshot) =>
        diffPayloads(snapshot, { payload: exportPayload(db), settings: readSettings(db.$client) })
      );
      return diff ?? reply.status(404).send({ error: 'Backup not found' });
    } catch (err) {
      // e.g. a corrupt file, or a backup from a newer app version
      request.log.error(err, 'Reading backup failed');
      return reply.status(400).send({
        error: 'Could not read the backup',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
