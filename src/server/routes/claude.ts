import { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppDatabase } from '../db/index.ts';
import { claudeSessions, tasks } from '../db/schema.ts';
import {
  ClaudeHookEvent,
  ClaudeHookEventSchema,
  ClaudeSession,
  ClaudeSessionState,
  UpdateClaudeSessionInputSchema,
} from '../../shared/types.ts';

/** Sessions with no linked task are deleted this long after their last event. */
export const UNLINKED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * The desktop app's id (local_...) for a session, from Claude Code's live session registry
 * (~/.claude/sessions/<pid>.json). Undocumented format, so any surprise just means no deep link.
 */
export function readHostSessionId(
  pid: string,
  sessionId: string,
  dir = path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'sessions')
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

export function listClaudeSessions(db: AppDatabase): ClaudeSession[] {
  return db
    .select()
    .from(claudeSessions)
    .orderBy(desc(claudeSessions.lastEventAt))
    .all();
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
          ...(!existing.title && title ? { title } : {}),
          ...details,
          ...(reactivates(event, state) ? { dismissedAt: null } : {}),
          lastEventAt: now,
        })
        .where(eq(claudeSessions.sessionId, event.session_id))
        .run();
    } else {
      db.insert(claudeSessions)
        .values({
          sessionId: event.session_id,
          cwd: event.cwd,
          title,
          state: state ?? 'running',
          startedAt: now,
          lastEventAt: now,
          ...details,
        })
        .run();
    }
    return reply.status(204).send();
  });

  // GET /api/claude/sessions — newest activity first; prunes old unlinked sessions
  app.get('/api/claude/sessions', async () => {
    db.delete(claudeSessions)
      .where(
        and(
          isNull(claudeSessions.taskId),
          lt(claudeSessions.lastEventAt, Date.now() - UNLINKED_SESSION_TTL_MS)
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

    const result = db
      .update(claudeSessions)
      .set({
        ...(taskId !== undefined ? { taskId } : {}),
        ...(dismissed !== undefined ? { dismissedAt: dismissed ? Date.now() : null } : {}),
      })
      .where(eq(claudeSessions.sessionId, request.params.id))
      .run();
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Session not found' });
    }

    const updated = db
      .select()
      .from(claudeSessions)
      .where(eq(claudeSessions.sessionId, request.params.id))
      .get();
    return { session: updated! };
  });
}
