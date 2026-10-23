import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index.ts';
import { stateForEvent, titleFromPrompt, UNLINKED_SESSION_TTL_MS } from '../routes/claude.ts';
import { ClaudeSession } from '../../shared/types.ts';

describe('stateForEvent', () => {
  const ev = (hook_event_name: string, extra = {}) => ({ session_id: 's', hook_event_name, ...extra });

  it('maps hook events to session states', () => {
    expect(stateForEvent(ev('SessionStart'))).toBe('idle');
    expect(stateForEvent(ev('UserPromptSubmit'))).toBe('running');
    expect(stateForEvent(ev('PostToolUse'))).toBe('running');
    expect(stateForEvent(ev('PreToolUse', { tool_name: 'Bash' }))).toBe('running');
    expect(stateForEvent(ev('PreToolUse', { tool_name: 'AskUserQuestion' }))).toBe('needs_attention');
    expect(stateForEvent(ev('PermissionRequest'))).toBe('needs_attention');
    expect(stateForEvent(ev('Stop'))).toBe('idle');
    expect(stateForEvent(ev('Notification', { notification_type: 'permission_prompt' }))).toBe(
      'needs_attention'
    );
    expect(stateForEvent(ev('Notification', { message: 'Claude needs your permission' }))).toBe(
      'needs_attention'
    );
    expect(stateForEvent(ev('SessionEnd'))).toBe('ended');
  });

  it('leaves the state alone for quiet notifications and unknown events', () => {
    expect(stateForEvent(ev('Notification', { notification_type: 'idle_prompt' }))).toBeNull();
    expect(stateForEvent(ev('PreCompact'))).toBeNull();
  });
});

describe('titleFromPrompt', () => {
  it('uses the first line, trimmed and capped at 80 characters', () => {
    expect(titleFromPrompt('  Fix the build\nmore detail')).toBe('Fix the build');
    expect(titleFromPrompt('x'.repeat(100))).toHaveLength(80);
  });
});

describe('Claude sessions API', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await buildApp({ dbPath: ':memory:' }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  const post = (body: object) =>
    app.inject({ method: 'POST', url: '/api/claude/events', payload: body });
  const list = async () =>
    (await app.inject({ method: 'GET', url: '/api/claude/sessions' })).json().sessions as ClaudeSession[];
  const createTask = async () =>
    (await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: 'T' } })).json().task.id as string;

  it('tracks a session through its lifecycle and titles it from the first prompt', async () => {
    const base = { session_id: 'abc', cwd: 'C:\\Repos\\Dashboard' };
    expect((await post({ ...base, hook_event_name: 'SessionStart' })).statusCode).toBe(204);
    expect((await list())[0]).toMatchObject({ sessionId: 'abc', state: 'idle', title: '', taskId: null });

    await post({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Add sessions\nplease' });
    await post({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Second prompt' });
    expect((await list())[0]).toMatchObject({ state: 'running', title: 'Add sessions' });

    await post({ ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    expect((await list())[0].state).toBe('needs_attention');
    await post({ ...base, hook_event_name: 'Notification', notification_type: 'idle_prompt' });
    expect((await list())[0].state).toBe('needs_attention');

    await post({ ...base, hook_event_name: 'SessionEnd' });
    expect((await list())[0].state).toBe('ended');
  });

  it('rejects events without a session id', async () => {
    expect((await post({ hook_event_name: 'Stop' })).statusCode).toBe(400);
  });

  it('accepts large tool payloads', async () => {
    const res = await post({
      session_id: 'big',
      hook_event_name: 'PostToolUse',
      tool_response: 'x'.repeat(2 * 1024 * 1024),
    });
    expect(res.statusCode).toBe(204);
  });

  it('links and unlinks a task; deleting the task unlinks it', async () => {
    await post({ session_id: 's1', hook_event_name: 'SessionStart', cwd: '/x' });
    const taskId = await createTask();

    const link = (id: string, taskId: string | null) =>
      app.inject({ method: 'PATCH', url: `/api/claude/sessions/${id}`, payload: { taskId } });
    expect((await link('s1', 'missing')).statusCode).toBe(400);
    expect((await link('nope', taskId)).statusCode).toBe(404);
    expect((await link('s1', taskId)).json().session.taskId).toBe(taskId);
    expect((await link('s1', null)).json().session.taskId).toBeNull();

    await link('s1', taskId);
    await app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}` });
    expect((await list())[0].taskId).toBeNull();
  });

  it('prunes unlinked sessions after a week of silence but keeps linked ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000_000_000);
    await post({ session_id: 'old-unlinked', hook_event_name: 'SessionEnd', cwd: '/x' });
    await post({ session_id: 'old-linked', hook_event_name: 'SessionEnd', cwd: '/x' });
    const taskId = await createTask();
    await app.inject({ method: 'PATCH', url: '/api/claude/sessions/old-linked', payload: { taskId } });

    vi.setSystemTime(1_000_000_000_000 + UNLINKED_SESSION_TTL_MS + 1);
    await post({ session_id: 'fresh', hook_event_name: 'SessionStart', cwd: '/x' });
    expect((await list()).map((s) => s.sessionId).sort()).toEqual(['fresh', 'old-linked']);
  });

  it('round-trips sessions through export and import, dropping links to missing tasks', async () => {
    await post({ session_id: 's1', hook_event_name: 'Stop', cwd: '/x' });
    const taskId = await createTask();
    await app.inject({ method: 'PATCH', url: '/api/claude/sessions/s1', payload: { taskId } });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.version).toBe(3);
    expect(exported.claudeSessions).toHaveLength(1);

    const { app: fresh } = await buildApp({ dbPath: ':memory:' });
    const orphan = { ...exported.claudeSessions[0], sessionId: 's2', taskId: 'gone' };
    const res = await fresh.inject({
      method: 'POST',
      url: '/api/import',
      payload: { ...exported, claudeSessions: [...exported.claudeSessions, orphan] },
    });
    expect(res.json().importedClaudeSessions).toBe(2);
    const sessions = (await fresh.inject({ method: 'GET', url: '/api/claude/sessions' })).json()
      .sessions as ClaudeSession[];
    expect(Object.fromEntries(sessions.map((s) => [s.sessionId, s.taskId]))).toEqual({ s1: taskId, s2: null });
    await fresh.close();
  });
});
