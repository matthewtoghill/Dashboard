import { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { AppDatabase } from '../db/index.ts';
import { claudeFolderLinks, claudeSessions, projects, tasks } from '../db/schema.ts';
import { cleanFolder, matchFolderLink, sameFolder } from '../../shared/claudeFolders.ts';
import { readSettings } from '../settings.ts';
import { recordTaskEvents, requestSource } from '../taskEvents.ts';
import {
  ClaudeFolderLink,
  ClaudeFolderLinkSchema,
  ClaudeHookEvent,
  ClaudeHookEventSchema,
  ClaudeSession,
  ClaudeSessionState,
  UpdateClaudeSessionInputSchema,
} from '../../shared/types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

// Notifications that don't need the user: "waiting for input" after 60s idle, login success
const QUIET_NOTIFICATIONS = new Set(['idle_prompt', 'auth_success']);

/** The state a hook event moves a session to, or null to leave it unchanged. */
export function stateForEvent(event: ClaudeHookEvent): ClaudeSessionState | null {
  switch (event.hook_event_name) {
    case 'SessionStart':
    case 'Stop':
      return 'idle';
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'running';
    case 'PreToolUse':
      // Claude asking the user a question blocks the session until they answer
      return event.tool_name === 'AskUserQuestion' ? 'needs_attention' : 'running';
    case 'PermissionRequest':
      return 'needs_attention';
    case 'Notification':
      return event.notification_type && QUIET_NOTIFICATIONS.has(event.notification_type)
        ? null
        : 'needs_attention';
    case 'SessionEnd':
      return 'ended';
    default:
      return null;
  }
}

/** First line of the first prompt, as a readable session title. */
export function titleFromPrompt(prompt: string): string {
  return clip(prompt.trim().split('\n')[0].trim(), 80);
}

/** Clipped copy of free text from a hook (prompts can be pages long). */
function clip(text: string, max = 500): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Panel details an event updates: last prompt, last tool, and why the session needs the user. */
export function detailsForEvent(
  event: ClaudeHookEvent,
  state: ClaudeSessionState | null
): { lastPrompt?: string; lastTool?: string; attentionMessage?: string } {
  const details: { lastPrompt?: string; lastTool?: string; attentionMessage?: string } = {};
  if (event.hook_event_name === 'UserPromptSubmit' && event.prompt) details.lastPrompt = clip(event.prompt.trim());
  if (event.tool_name) details.lastTool = event.tool_name;
  if (state === 'needs_attention') {
    details.attentionMessage = clip(
      event.message ??
        (event.tool_name === 'AskUserQuestion'
          ? 'Claude is asking a question'
          : `Claude needs permission${event.tool_name ? ` to use ${event.tool_name}` : ''}`)
    );
  } else if (state) {
    details.attentionMessage = '';
  }
  return details;
}

/** A cleared session comes back when it starts again or needs the user. */
export function reactivates(event: ClaudeHookEvent, state: ClaudeSessionState | null): boolean {
  return (
    event.hook_event_name === 'SessionStart' ||
    event.hook_event_name === 'UserPromptSubmit' ||
    state === 'needs_attention'
  );
}

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');

/**
 * The title Claude shows for a session, from its transcript (~/.claude/projects/.../<id>.jsonl):
 * the latest /rename (custom-title) beats the latest auto title (ai-title). Undocumented format,
 * so any surprise just means no title. Only reads .jsonl files under the projects folder.
 * Streamed line by line: transcripts run to megabytes and the hook shouldn't block the server.
 */
export async function readTranscriptTitle(
  transcriptPath: string,
  dir = path.join(claudeDir(), 'projects')
): Promise<string> {
  const file = path.resolve(transcriptPath);
  const rel = path.relative(path.resolve(dir), file);
  if (!file.endsWith('.jsonl') || !rel || rel.startsWith('..') || path.isAbsolute(rel)) return '';
  let custom = '';
  let ai = '';
  try {
    const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes('-title"')) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === 'custom-title' && typeof entry.customTitle === 'string') custom = entry.customTitle;
        if (entry?.type === 'ai-title' && typeof entry.aiTitle === 'string') ai = entry.aiTitle;
      } catch {
        // A line still being written
      }
    }
  } catch {
    return '';
  }
  return clip((custom.trim() || ai.trim()).split('\n')[0], 80);
}

/**
 * The desktop app's id (local_...) for a session, from Claude Code's live session registry
 * (~/.claude/sessions/<pid>.json). Undocumented format, so any surprise just means no deep link.
 */
export function readHostSessionId(
  pid: string,
  sessionId: string,
  dir = path.join(claudeDir(), 'sessions')
): string | null {
  if (!/^\d{1,10}$/.test(pid)) return null;
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, `${pid}.json`), 'utf8'));
    return entry?.sessionId === sessionId &&
      typeof entry.hostSessionId === 'string' &&
      /^local_[A-Za-z0-9-]{1,64}$/.test(entry.hostSessionId)
      ? entry.hostSessionId
      : null;
  } catch {
    return null;
  }
}

export function listClaudeFolderLinks(db: AppDatabase): ClaudeFolderLink[] {
  return db
    .select({ path: claudeFolderLinks.path, projectId: claudeFolderLinks.projectId })
    .from(claudeFolderLinks)
    .orderBy(asc(claudeFolderLinks.path))
    .all();
}

/** Newest activity first, each with its project: the linked task's, else its folder's. */
export function listClaudeSessions(db: AppDatabase, sessionId?: string): ClaudeSession[] {
  const folders = listClaudeFolderLinks(db);
  return db
    .select({ session: claudeSessions, taskProjectId: tasks.projectId })
    .from(claudeSessions)
    .leftJoin(tasks, eq(tasks.id, claudeSessions.taskId))
    .where(sessionId ? eq(claudeSessions.sessionId, sessionId) : undefined)
    .orderBy(desc(claudeSessions.lastEventAt))
    .all()
    .map(({ session, taskProjectId }) => ({
      ...session,
      projectId: taskProjectId ?? matchFolderLink(session.cwd, folders)?.projectId ?? null,
    }));
}

/** Moves a session's linked task from todo to in_progress, logged as a Claude change. */
function startLinkedTask(db: AppDatabase, taskId: string, now: number): void {
  db.transaction(() => {
    const started = db
      .update(tasks)
      .set({ status: 'in_progress', updatedAt: now })
      .where(and(eq(tasks.id, taskId), eq(tasks.status, 'todo')))
      .run();
    if (started.changes) {
      recordTaskEvents(db, taskId, [{ kind: 'status', from: 'todo', to: 'in_progress' }], 'claude', now);
    }
  });
}

export async function registerClaudeRoutes(app: FastifyInstance, db: AppDatabase) {
  // POST /api/claude/events — a Claude Code hook's stdin JSON, piped through curl, with the
  // X-Claude-Entrypoint and X-Claude-Pid headers from the hook's environment (both optional).
  // PostToolUse payloads carry whole tool outputs, hence the large body limit.
  app.post('/api/claude/events', { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const parsed = ClaudeHookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid hook event',
        details: parsed.error.flatten(),
      });
    }
    const event = parsed.data;
    const now = Date.now();
    const state = stateForEvent(event);
    const title =
      event.hook_event_name === 'UserPromptSubmit' && event.prompt ? titleFromPrompt(event.prompt) : '';
    // Claude's own title (auto or renamed) replaces the first-prompt one; rechecked after each
    // turn and on resume rather than on every tool event, as transcripts run to megabytes
    const claudeTitle =
      (event.hook_event_name === 'Stop' || event.hook_event_name === 'SessionStart') && event.transcript_path
        ? await readTranscriptTitle(event.transcript_path)
        : '';
    const header = (name: string) => {
      const value = request.headers[name];
      return typeof value === 'string' ? value.trim() : '';
    };
    const entrypoint = /^[a-z0-9-]{1,40}$/.test(header('x-claude-entrypoint'))
      ? header('x-claude-entrypoint')
      : '';
    // Re-read on every desktop event: a resumed session runs in a new process
    const hostSessionId =
      entrypoint === 'claude-desktop' ? readHostSessionId(header('x-claude-pid'), event.session_id) : null;
    const details = {
      ...detailsForEvent(event, state),
      ...(entrypoint ? { entrypoint } : {}),
      ...(hostSessionId ? { hostSessionId } : {}),
    };

    const existing = db
      .select()
      .from(claudeSessions)
      .where(eq(claudeSessions.sessionId, event.session_id))
      .get();

    if (existing) {
      db.update(claudeSessions)
        .set({
          ...(state ? { state } : {}),
          ...(event.cwd ? { cwd: event.cwd } : {}),
          ...(claudeTitle ? { title: claudeTitle } : !existing.title && title ? { title } : {}),
          ...details,
          ...(reactivates(event, state) ? { dismissedAt: null } : {}),
          lastEventAt: now,
        })
        .where(eq(claudeSessions.sessionId, event.session_id))
        .run();
      // Prompting in a linked session starts its task; linking alone doesn't
      if (event.hook_event_name === 'UserPromptSubmit' && existing.taskId) {
        startLinkedTask(db, existing.taskId, now);
      }
    } else {
      db.insert(claudeSessions)
        .values({
          sessionId: event.session_id,
          cwd: event.cwd,
          title: claudeTitle || title,
          state: state ?? 'running',
          startedAt: now,
          lastEventAt: now,
          ...details,
        })
        .run();
    }
    return reply.status(204).send();
  });

  // GET /api/claude/sessions — newest activity first; prunes unlinked sessions older than
  // the claudeSessionTtlDays setting
  app.get('/api/claude/sessions', async () => {
    const ttlMs = readSettings(db.$client).claudeSessionTtlDays * DAY_MS;
    db.delete(claudeSessions)
      .where(
        and(
          isNull(claudeSessions.taskId),
          lt(claudeSessions.lastEventAt, Date.now() - ttlMs)
        )
      )
      .run();
    return { sessions: listClaudeSessions(db) };
  });

  // PATCH /api/claude/sessions/:id — { taskId } links (null unlinks); { dismissed } clears or restores
  app.patch<{ Params: { id: string } }>('/api/claude/sessions/:id', async (request, reply) => {
    const parsed = UpdateClaudeSessionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid session update payload',
        details: parsed.error.flatten(),
      });
    }
    const { taskId, dismissed } = parsed.data;
    if (taskId === undefined && dismissed === undefined) {
      return reply.status(400).send({ error: 'Nothing to update' });
    }
    if (taskId && !db.select().from(tasks).where(eq(tasks.id, taskId)).get()) {
      return reply.status(400).send({ error: 'Task not found' });
    }

    const existing = db
      .select()
      .from(claudeSessions)
      .where(eq(claudeSessions.sessionId, request.params.id))
      .get();
    if (!existing) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    db.transaction(() => {
      db.update(claudeSessions)
        .set({
          ...(taskId !== undefined ? { taskId } : {}),
          ...(dismissed !== undefined ? { dismissedAt: dismissed ? Date.now() : null } : {}),
        })
        .where(eq(claudeSessions.sessionId, request.params.id))
        .run();

      if (taskId !== undefined && taskId !== existing.taskId) {
        const label = existing.title || existing.sessionId;
        const source = requestSource(request.headers);
        if (existing.taskId) {
          recordTaskEvents(db, existing.taskId, [{ kind: 'session_unlinked', from: label }], source);
        }
        if (taskId) recordTaskEvents(db, taskId, [{ kind: 'session_linked', to: label }], source);
      }
    });

    return { session: listClaudeSessions(db, request.params.id)[0] };
  });

  // GET /api/claude/folders — folders mapped to projects
  app.get('/api/claude/folders', async () => ({ links: listClaudeFolderLinks(db) }));

  // PUT /api/claude/folders — maps a folder to a project, replacing its earlier mapping
  app.put('/api/claude/folders', async (request, reply) => {
    const parsed = ClaudeFolderLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid folder mapping', details: parsed.error.flatten() });
    }
    const folder = cleanFolder(parsed.data.path);
    if (!path.isAbsolute(folder)) {
      return reply.status(400).send({ error: 'Folder must be an absolute path' });
    }
    const { projectId } = parsed.data;
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get()) {
      return reply.status(400).send({ error: 'Unknown project' });
    }
    db.transaction((tx) => {
      // The same folder written with other separators or case is one mapping
      for (const link of listClaudeFolderLinks(db).filter((l) => sameFolder(l.path, folder))) {
        tx.delete(claudeFolderLinks).where(eq(claudeFolderLinks.path, link.path)).run();
      }
      tx.insert(claudeFolderLinks).values({ path: folder, projectId, createdAt: Date.now() }).run();
    });
    return { links: listClaudeFolderLinks(db) };
  });

  // DELETE /api/claude/folders?path=... — removes a folder's mapping
  app.delete<{ Querystring: { path?: string } }>('/api/claude/folders', async (request, reply) => {
    const folder = request.query.path ?? '';
    const matches = listClaudeFolderLinks(db).filter((l) => sameFolder(l.path, folder));
    if (!folder || matches.length === 0) return reply.status(404).send({ error: 'Folder not mapped' });
    db.transaction((tx) => {
      for (const link of matches) tx.delete(claudeFolderLinks).where(eq(claudeFolderLinks.path, link.path)).run();
    });
    return { links: listClaudeFolderLinks(db) };
  });
}
