import { FastifyInstance } from 'fastify';
import { AppDatabase } from '../db/index.ts';
import { BackupConfig, backupDatabase, listBackups } from '../backup.ts';
import { applyRestore, diffPayloads, planRestore, RestoreError, withBackupSnapshot } from '../restore.ts';
import { RestoreRequestSchema } from '../../shared/types.ts';
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

  // POST /api/backups/:file/restore — add the selected missing items, settings and scratchpad
  app.post<{ Params: { file: string } }>('/api/backups/:file/restore', async (request, reply) => {
    if (!getConfig) {
      return reply.status(400).send({ error: 'Backups are disabled for in-memory databases' });
    }
    const parsed = RestoreRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid restore request', details: parsed.error.flatten() });
    }
    const config = getConfig();
    try {
      const result = withBackupSnapshot(config.dir, request.params.file, (snapshot) => {
        const plan = planRestore(
          snapshot,
          { payload: exportPayload(db), settings: readSettings(db.$client) },
          parsed.data
        );
        // The backup is already copied, so not pruning only keeps it around for another restore
        try {
          backupDatabase(db.$client, config, { prune: false });
        } catch (err) {
          request.log.error(err, 'Pre-restore backup failed');
          throw new RestoreError(
            `Restore cancelled: could not create a safety backup first (${err instanceof Error ? err.message : String(err)})`,
            500
          );
        }
        try {
          return applyRestore(db, plan);
        } catch (err) {
          throw new RestoreError(
            `Restore failed; no changes were made (${err instanceof Error ? err.message : String(err)})`
          );
        }
      });
      return result ?? reply.status(404).send({ error: 'Backup not found' });
    } catch (err) {
      if (err instanceof RestoreError) return reply.status(err.status).send({ error: err.message });
      request.log.error(err, 'Reading backup failed');
      return reply.status(400).send({
        error: 'Could not read the backup',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
