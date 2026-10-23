import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';
import {
  detailsForEvent,
  readHostSessionId,
  stateForEvent,
  titleFromPrompt,
} from '../routes/claude.ts';
import { ClaudeSession, ClaudeSessionSchema } from '../../shared/types.ts';
import { sessionLink, taskFromSession } from '../../client/components/ClaudeSessions.tsx';

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

describe('detailsForEvent', () => {
  const ev = (hook_event_name: string, extra = {}) => ({ session_id: 's', hook_event_name, ...extra });

  it('records the last prompt and tool, and why the session needs the user', () => {
    expect(detailsForEvent(ev('UserPromptSubmit', { prompt: ' hi ' }), 'running')).toEqual({
      lastPrompt: 'hi',
      attentionMessage: '',
    });
    expect(detailsForEvent(ev('PermissionRequest', { tool_name: 'Bash' }), 'needs_attention')).toEqual({
      lastTool: 'Bash',
      attentionMessage: 'Claude needs permission to use Bash',
    });
    expect(detailsForEvent(ev('Notification', { message: 'Waiting' }), 'needs_attention')).toEqual({
      attentionMessage: 'Waiting',
    });
    // A quiet notification leaves the attention message alone
    expect(detailsForEvent(ev('Notification', { notification_type: 'idle_prompt' }), null)).toEqual({});
  });
});

describe('readHostSessionId', () => {
  it('reads the desktop id from the session registry only when the session id matches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-'));
    const write = (pid: string, entry: object) =>
      fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(entry));
    write('100', { sessionId: 'abc', hostSessionId: 'local_6e92-aa' });
    write('200', { sessionId: 'abc', hostSessionId: 'javascript:alert(1)' });
    try {
      expect(readHostSessionId('100', 'abc', dir)).toBe('local_6e92-aa');
      expect(readHostSessionId('100', 'other', dir)).toBeNull();
      expect(readHostSessionId('200', 'abc', dir)).toBeNull();
      expect(readHostSessionId('../100', 'abc', dir)).toBeNull();
      expect(readHostSessionId('999', 'abc', dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('session links and tasks', () => {
  const session = ClaudeSessionSchema.parse({
    sessionId: '0f8e3c1a-2b4d-4e6f-8a9b-1c2d3e4f5a6b',
    cwd: 'C:\\Repos\\Dashboard',
    title: '',
    state: 'idle',
    taskId: null,
    startedAt: 1,
    lastEventAt: 1,
  });

  it('opens desktop sessions in the desktop app and others through the terminal handler', () => {
    expect(sessionLink({ ...session, entrypoint: 'claude-desktop', hostSessionId: 'local_abc' }).url).toBe(
      'claude://code/continue?session=local_abc'
    );
    expect(sessionLink({ ...session, entrypoint: 'claude-desktop' }).url).toBe(
      `claude-resume://${session.sessionId}`
    );
    expect(sessionLink({ ...session, entrypoint: 'cli' }).url).toBe(`claude-resume://${session.sessionId}`);
  });

  it('titles a task after the session, or its folder when untitled', () => {
    expect(taskFromSession(session).title).toBe('Claude session in Dashboard');
    expect(taskFromSession({ ...session, title: 'Fix login' }).title).toBe('Fix login');
    expect(taskFromSession(session).description).toContain(`claude --resume ${session.sessionId}`);
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

  it('records the client from the hook headers', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/claude/events',
      headers: { 'x-claude-entrypoint': 'cli', 'x-claude-pid': '1' },
      payload: { session_id: 's', hook_event_name: 'SessionStart' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/claude/events',
      headers: { 'x-claude-entrypoint': 'Bad Value!' },
      payload: { session_id: 's', hook_event_name: 'Stop' },
    });
    expect((await list())[0]).toMatchObject({ entrypoint: 'cli', hostSessionId: null });
  });

  it('clears a session until it starts again or needs the user', async () => {
    const dismiss = (dismissed: boolean) =>
      app.inject({ method: 'PATCH', url: '/api/claude/sessions/s', payload: { dismissed } });
    await post({ session_id: 's', hook_event_name: 'Stop' });
    expect((await dismiss(true)).json().session.dismissedAt).toEqual(expect.any(Number));

    await post({ session_id: 's', hook_event_name: 'PostToolUse' });
    await post({ session_id: 's', hook_event_name: 'SessionEnd' });
    expect((await list())[0].dismissedAt).not.toBeNull();

    await post({ session_id: 's', hook_event_name: 'PermissionRequest' });
    expect((await list())[0].dismissedAt).toBeNull();

    await dismiss(true);
    expect((await dismiss(false)).json().session.dismissedAt).toBeNull();
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/claude/sessions/s', payload: {} })).statusCode
    ).toBe(400);
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

  it('prunes unlinked sessions after the configured days of silence but keeps linked ones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000_000_000);
    await post({ session_id: 'old-unlinked', hook_event_name: 'SessionEnd', cwd: '/x' });
    await post({ session_id: 'old-linked', hook_event_name: 'SessionEnd', cwd: '/x' });
    const taskId = await createTask();
    await app.inject({ method: 'PATCH', url: '/api/claude/sessions/old-linked', payload: { taskId } });

    await app.inject({ method: 'PUT', url: '/api/settings', payload: { claudeSessionTtlDays: 2 } });
    vi.setSystemTime(1_000_000_000_000 + 2 * 24 * 60 * 60 * 1000 + 1);
    await post({ session_id: 'fresh', hook_event_name: 'SessionStart', cwd: '/x' });
    expect((await list()).map((s) => s.sessionId).sort()).toEqual(['fresh', 'old-linked']);
  });

  it('round-trips sessions through export and import, dropping links to missing tasks', async () => {
    await post({ session_id: 's1', hook_event_name: 'Stop', cwd: '/x' });
    const taskId = await createTask();
    await app.inject({ method: 'PATCH', url: '/api/claude/sessions/s1', payload: { taskId } });
    const exported = (await app.inject({ method: 'GET', url: '/api/export' })).json();
    expect(exported.version).toBe(4);
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
