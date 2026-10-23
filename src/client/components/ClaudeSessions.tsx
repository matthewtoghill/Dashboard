import React, { useState } from 'react';
import { Bot, Check, Copy, Unlink } from 'lucide-react';
import { ClaudeSession, ClaudeSessionState, Task } from '../../shared/types.ts';
import { formatTimestamp } from '../utils/taskUtils.ts';

const STATE_STYLES: Record<ClaudeSessionState, { label: string; className: string }> = {
  needs_attention: {
    label: 'Needs attention',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  },
  running: {
    label: 'Running',
    className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  idle: {
    label: 'Idle',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  ended: {
    label: 'Ended',
    className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

// Needs attention first, then by latest activity (the server already sorts by activity)
const STATE_ORDER: ClaudeSessionState[] = ['needs_attention', 'running', 'idle', 'ended'];

/** Shell command that reopens the session in Claude Code, whichever client started it. */
export function resumeCommand(session: ClaudeSession): string {
  return `cd "${session.cwd}" && claude --resume ${session.sessionId}`;
}

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

const CopyResumeButton: React.FC<{ session: ClaudeSession }> = ({ session }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={resumeCommand(session)}
      aria-label={copied ? 'Resume command copied' : 'Copy resume command'}
      onClick={async () => {
        await navigator.clipboard.writeText(resumeCommand(session));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

/**
 * One session: state, title, folder and last activity, plus a copy-resume button.
 * With `tasks`, shows a picker to link the session to a task; without, an Unlink button.
 */
export const ClaudeSessionItem: React.FC<{
  session: ClaudeSession;
  tasks?: Task[];
  onLink: (sessionId: string, taskId: string | null) => void;
}> = ({ session, tasks, onLink }) => {
  const style = STATE_STYLES[session.state];
  return (
    <li className="flex items-center gap-3 py-2">
      <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${style.className}`}>
        {style.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-zinc-800 dark:text-zinc-100">
          {session.title || 'Untitled session'}
        </span>
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={session.cwd}>
          {folderName(session.cwd)} · {formatTimestamp(session.lastEventAt)}
        </span>
      </span>
      {tasks ? (
        <select
          aria-label="Linked task"
          value={session.taskId ?? ''}
          onChange={(e) => onLink(session.sessionId, e.target.value || null)}
          className="max-w-[10rem] text-xs px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none cursor-pointer"
        >
          <option value="">No task</option>
          {tasks
            .filter((t) => t.status !== 'archived' || t.id === session.taskId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </select>
      ) : (
        <button
          type="button"
          aria-label="Unlink session"
          title="Unlink session"
          onClick={() => onLink(session.sessionId, null)}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        >
          <Unlink className="w-3.5 h-3.5" />
        </button>
      )}
      <CopyResumeButton session={session} />
    </li>
  );
};

/** Overview card listing every tracked Claude Code session. */
export const ClaudeSessionsCard: React.FC<{
  sessions: ClaudeSession[];
  tasks: Task[];
  onLink: (sessionId: string, taskId: string | null) => void;
}> = ({ sessions, tasks, onLink }) => {
  const sorted = [...sessions].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)
  );
  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-zinc-500" />
        <h3 className="text-sm font-semibold">Claude sessions</h3>
      </div>
      {sorted.length === 0 ? (
        <p className="py-6 px-4 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
          No sessions yet. Add the Dashboard hooks to <code>~/.claude/settings.json</code> (see
          "Claude Session Tracking" in PLAN.md) and start a Claude Code session.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sorted.map((s) => (
            <ClaudeSessionItem key={s.sessionId} session={s} tasks={tasks} onLink={onLink} />
          ))}
        </ul>
      )}
    </div>
  );
};
