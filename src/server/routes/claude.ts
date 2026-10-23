import { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { AppDatabase } from '../db/index.ts';
import { claudeSessions, tasks } from '../db/schema.ts';
import {
  ClaudeHookEvent,
  ClaudeHookEventSchema,
  ClaudeSession,
  ClaudeSessionState,
  LinkClaudeSessionInputSchema,
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
  const line = prompt.trim().split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

export function listClaudeSessions(db: AppDatabase): ClaudeSession[] {
  return db
    .select()
    .from(claudeSessions)
    .orderBy(desc(claudeSessions.lastEventAt))
    .all();
}

export async function registerClaudeRoutes(app: FastifyInstance, db: AppDatabase) {
  // POST /api/claude/events — a Claude Code hook's stdin JSON, piped through curl.
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

  // PATCH /api/claude/sessions/:id — link to a task, or unlink with { taskId: null }
  app.patch<{ Params: { id: string } }>('/api/claude/sessions/:id', async (request, reply) => {
    const parsed = LinkClaudeSessionInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid session update payload',
        details: parsed.error.flatten(),
      });
    }
    const { taskId } = parsed.data;
    if (taskId && !db.select().from(tasks).where(eq(tasks.id, taskId)).get()) {
      return reply.status(400).send({ error: 'Task not found' });
    }

    const result = db
      .update(claudeSessions)
      .set({ taskId })
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
