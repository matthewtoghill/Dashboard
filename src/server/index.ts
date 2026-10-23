import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase, AppDatabase } from './db/index.ts';
import { registerTaskRoutes } from './routes/tasks.ts';
import { registerProjectRoutes } from './routes/projects.ts';
import { registerDashboardRoutes } from './routes/dashboard.ts';
import { registerBackupRoutes } from './routes/backups.ts';
import { registerClaudeRoutes } from './routes/claude.ts';
import { registerSettingsRoutes } from './routes/settings.ts';
import { AzRunner, registerAdoRoutes } from './routes/ado.ts';
import { readSettings } from './settings.ts';
import { backupDatabase, isDailyBackupDue, resolveBackupConfig } from './backup.ts';

const ALLOWED_HOSTNAMES = new Set(
  ['localhost', '127.0.0.1', '[::1]', '::1', process.env.HOST].filter(Boolean)
);

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_HOSTNAMES.has(hostname);
}

function isAllowedOrigin(origin: string): boolean {
  try {
    return isAllowedHost(new URL(origin).hostname);
  } catch {
    return false; // e.g. "null" from sandboxed frames
  }
}

export async function buildApp(options?: { dbPath?: string; az?: AzRunner }): Promise<{
  app: FastifyInstance;
  db: AppDatabase;
}> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // No CORS: the API is only for this app's own pages. Reject cross-site requests (CSRF)
  // and requests addressed to a non-loopback host name (DNS rebinding).
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!isAllowedHost(request.hostname) || (origin !== undefined && !isAllowedOrigin(origin))) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  });

  const { db, sqlite, dbPath } = createDatabase(options?.dbPath);
  // Re-read on each use so changes in the settings panel apply without a restart
  const backupConfig =
    dbPath === ':memory:' ? null : () => resolveBackupConfig(dbPath, readSettings(sqlite));

  // Daily backup: checked at startup and hourly, so frequent dev restarts don't pile up copies
  let backupTimer: NodeJS.Timeout | undefined;
  if (backupConfig) {
    const dailyBackup = () => {
      try {
        const config = backupConfig();
        if (isDailyBackupDue(config.dir)) backupDatabase(sqlite, config);
      } catch (err) {
        app.log.error(err, 'Daily backup failed');
      }
    };
    dailyBackup();
    backupTimer = setInterval(dailyBackup, 60 * 60 * 1000).unref();
  }

  app.addHook('onClose', async () => {
    clearInterval(backupTimer);
    sqlite.close();
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: Date.now(),
  }));

  await registerTaskRoutes(app, db);
  await registerProjectRoutes(app, db);
  await registerDashboardRoutes(app, db, {
    // Snapshot before an import changes data; null when backups are disabled
    beforeImport: backupConfig ? () => backupDatabase(sqlite, backupConfig()) : null,
  });
  await registerBackupRoutes(app, sqlite, backupConfig);
  await registerClaudeRoutes(app, db);
  await registerSettingsRoutes(app, sqlite);
  await registerAdoRoutes(app, db, options?.az);

  // Serve built static client in production if dist exists
  const distPath = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(distPath)) {
    await app.register(fastifyStatic, {
      root: distPath,
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        reply.status(404).send({ error: 'Not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return { app, db };
}

// Start server if invoked directly
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const port = Number(process.env.PORT ?? 3444);
  const host = process.env.HOST ?? '127.0.0.1';

  buildApp()
    .then(async ({ app }) => {
      await app.listen({ port, host });
      console.log(`Dashboard API server listening on http://${host}:${port}`);
    })
    .catch((err) => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}
