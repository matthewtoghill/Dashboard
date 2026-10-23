import React, { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, ExternalLink, Link2, ListPlus, Unlink, X, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { ClaudeSession, ClaudeSessionState, Task } from '../../shared/types.ts';
import { formatTimestamp } from '../utils/taskUtils.ts';

export const STATE_STYLES: Record<ClaudeSessionState, { label: string; className: string }> = {
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

export const SESSION_ROW_BADGE_STYLES: Record<ClaudeSessionState, string> = {
  needs_attention:
    'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/50',
  running:
    'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/50',
  idle:
    'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/50',
  ended:
    'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200/70 dark:border-zinc-700/70 hover:text-indigo-600 dark:hover:text-indigo-400',
};

// Needs attention first, then by latest activity (the server already sorts by activity)
const STATE_ORDER: ClaudeSessionState[] = ['needs_attention', 'running', 'idle', 'ended'];

/** Picks the most urgent (then most recently active) session linked to a task. */
export function primaryClaudeSession(sessions: ClaudeSession[]): ClaudeSession | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort(
    (a, b) =>
      STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
      b.lastEventAt - a.lastEventAt
  )[0];
}

const CLIENT_LABELS: Record<string, string> = {
  'claude-desktop': 'Claude desktop',
  'claude-vscode': 'VS Code',
  cli: 'Terminal',
  'sdk-ts': 'Agent SDK',
  'sdk-py': 'Agent SDK',
};

const iconButtonClass =
  'p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer';

/** Shell command that reopens the session in Claude Code, whichever client started it. */
export function resumeCommand(session: ClaudeSession): string {
  return `cd "${session.cwd}" && claude --resume ${session.sessionId}`;
}

/**
 * Link that opens the session: the desktop app's own deep link for its sessions, otherwise the
 * claude-resume:// handler from scripts/register-claude-resume.ps1 (a terminal running --resume).
 */
export function sessionLink(session: ClaudeSession): { url: string; label: string } {
  return session.entrypoint === 'claude-desktop' && session.hostSessionId
    ? {
        url: `claude://code/continue?session=${encodeURIComponent(session.hostSessionId)}`,
        label: 'Open in Claude desktop',
      }
    : {
        url: `claude-resume://${encodeURIComponent(session.sessionId)}`,
        label: 'Open in terminal (needs scripts/register-claude-resume.ps1)',
      };
}

/** Title and notes for a task created from a session. */
export function taskFromSession(session: ClaudeSession): { title: string; description: string } {
  return {
    title: session.title || `Claude session in ${folderName(session.cwd)}`,
    description: `Started from a Claude session in \`${session.cwd}\`.\n\nResume: \`${resumeCommand(session)}\``,
  };
}

const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;

const StateBadge: React.FC<{ state: ClaudeSessionState }> = ({ state }) => (
  <span
    className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATE_STYLES[state].className}`}
  >
    {STATE_STYLES[state].label}
  </span>
);

const CopyResumeButton: React.FC<{ session: ClaudeSession; withLabel?: boolean }> = ({
  session,
  withLabel,
}) => {
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
      className={`${iconButtonClass} inline-flex items-center gap-1.5 text-xs`}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      {withLabel && <span>{copied ? 'Copied' : 'Copy resume command'}</span>}
    </button>
  );
};

const OpenSessionLink: React.FC<{ session: ClaudeSession; withLabel?: boolean }> = ({
  session,
  withLabel,
}) => {
  const link = sessionLink(session);
  return (
    <a
      href={link.url}
      title={link.label}
      aria-label={link.label}
      className={`${iconButtonClass} inline-flex items-center gap-1.5 text-xs`}
    >
      <ExternalLink className="w-3.5 h-3.5" />
      {withLabel && <span>{link.label.replace(/ \(.*\)$/, '')}</span>}
    </a>
  );
};

const inputClass =
  'w-full px-3 py-1.5 rounded-lg text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-400';

/** Dialog for choosing the session's task among open tasks, or creating a new one to link. */
const TaskLinkDialog: React.FC<{
  session: ClaudeSession | null;
  tasks: Task[];
  onClose: () => void;
  onLink: (sessionId: string, taskId: string | null) => void;
  onCreateTask: (session: ClaudeSession, title: string) => void;
}> = ({ session, tasks, onClose, onLink, onCreateTask }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (session && !dialog.open) {
      setQuery('');
      setNewTitle(taskFromSession(session).title);
      dialog.showModal();
    }
    if (!session && dialog.open) dialog.close();
  }, [session]);

  const linkedTask = session && tasks.find((t) => t.id === session.taskId);
  const q = query.trim().toLowerCase();
  const choices = tasks.filter(
    (t) => (t.status === 'todo' || t.status === 'in_progress') && t.title.toLowerCase().includes(q)
  );
  const link = (taskId: string | null) => {
    if (session) onLink(session.sessionId, taskId);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Keep Esc and typing away from the panel and global shortcuts underneath
      onKeyDown={(e) => e.stopPropagation()}
      aria-labelledby="task-link-dialog-title"
      className="m-auto w-full max-w-md max-h-[80vh] overflow-hidden rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      {session && (
        <div className="flex flex-col max-h-[80vh] text-sm">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <h2 id="task-link-dialog-title" className="text-base font-semibold truncate">
              Link task to session
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className={iconButtonClass}>
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {linkedTask && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10">
                <span className="flex-1 min-w-0 truncate">
                  <span className="text-zinc-500 dark:text-zinc-400">Linked: </span>
                  {linkedTask.title}
                </span>
                <button
                  type="button"
                  onClick={() => link(null)}
                  className={`${iconButtonClass} inline-flex items-center gap-1.5 text-xs`}
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Unlink
                </button>
              </div>
            )}

            <div className="space-y-2">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search open tasks"
                aria-label="Search open tasks"
                className={inputClass}
              />
              {choices.length === 0 ? (
                <p className="py-3 text-center text-xs text-zinc-500 dark:text-zinc-400">No matching open tasks.</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
                  {choices.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => link(t.id)}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-left rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer ${
                          t.id === session.taskId ? 'font-medium text-indigo-600 dark:text-indigo-400' : ''
                        }`}
                      >
                        <span className="flex-1 truncate">{t.title}</span>
                        {t.id === session.taskId && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTitle.trim()) return;
                onCreateTask(session, newTitle.trim());
                onClose();
              }}
              className="space-y-2 pt-4 border-t border-zinc-200 dark:border-zinc-800"
            >
              <label htmlFor="task-link-new-title" className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Or create a new task
              </label>
              <div className="flex gap-2">
                <input
                  id="task-link-new-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  Create & link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </dialog>
  );
};

/** Linked task title (opens the task), an unlink X, and the button that opens TaskLinkDialog. */
const TaskLinkControls: React.FC<
  { session: ClaudeSession; tasks: Task[] } & Omit<ClaudeSessionActions, 'onOpen' | 'onToggleCleared'>
> = ({ session, tasks, onLink, onCreateTask, onOpenTask }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const linkedTask = tasks.find((t) => t.id === session.taskId);
  return (
    <>
      {linkedTask && (
        <span className="inline-flex items-center min-w-0 max-w-[14rem] rounded-lg border border-zinc-200 dark:border-zinc-700 text-xs">
          <button
            type="button"
            onClick={() => onOpenTask(linkedTask.id)}
            title={`Open task: ${linkedTask.title}`}
            className="min-w-0 truncate pl-2 py-1 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {linkedTask.title}
          </button>
          <button
            type="button"
            onClick={() => onLink(session.sessionId, null)}
            aria-label="Unlink task"
            title="Unlink task"
            className="flex-shrink-0 p-1 mr-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        aria-label={linkedTask ? 'Change linked task' : 'Link task'}
        title={linkedTask ? 'Change linked task' : 'Link or create a task'}
        className={`${iconButtonClass} inline-flex items-center gap-1.5 text-xs`}
      >
        <Link2 className="w-3.5 h-3.5" />
        {!linkedTask && <span>Link task</span>}
      </button>
      <TaskLinkDialog
        session={dialogOpen ? session : null}
        tasks={tasks}
        onClose={() => setDialogOpen(false)}
        onLink={onLink}
        onCreateTask={onCreateTask}
      />
    </>
  );
};

export interface ClaudeSessionActions {
  onOpen: (sessionId: string) => void;
  onOpenTask: (taskId: string) => void;
  onLink: (sessionId: string, taskId: string | null) => void;
  onCreateTask: (session: ClaudeSession, title: string) => void;
  onToggleCleared: (session: ClaudeSession) => void;
}

/**
 * One session: state, title (opens the side panel), folder and last activity, and actions.
 * With `tasks` (Overview) it has the linked task and link button, and Clear; without (task
 * drawer), an Unlink button.
 */
export const ClaudeSessionItem: React.FC<
  { session: ClaudeSession; tasks?: Task[] } & ClaudeSessionActions
> = ({ session, tasks, onOpen, onOpenTask, onLink, onCreateTask, onToggleCleared }) => (
  <li className="flex items-center gap-2 py-2">
    <StateBadge state={session.state} />
    <button
      type="button"
      onClick={() => onOpen(session.sessionId)}
      title="Show session details"
      className="min-w-0 flex-1 text-left cursor-pointer group ml-1"
    >
      <span className="block truncate text-sm text-zinc-800 dark:text-zinc-100 group-hover:underline">
        {session.title || 'Untitled session'}
      </span>
      <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={session.cwd}>
        {folderName(session.cwd)} · {formatTimestamp(session.lastEventAt)}
      </span>
    </button>
    {tasks ? (
      <TaskLinkControls
        session={session}
        tasks={tasks}
        onOpenTask={onOpenTask}
        onLink={onLink}
        onCreateTask={onCreateTask}
      />
    ) : (
      <button
        type="button"
        aria-label="Unlink session"
        title="Unlink session"
        onClick={() => onLink(session.sessionId, null)}
        className={iconButtonClass}
      >
        <Unlink className="w-3.5 h-3.5" />
      </button>
    )}
    <OpenSessionLink session={session} />
    <CopyResumeButton session={session} />
    {tasks && (
      <button
        type="button"
        aria-label="Clear session"
        title="Clear from this list (it comes back if the session becomes active)"
        onClick={() => onToggleCleared(session)}
        className={iconButtonClass}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    )}
  </li>
);

/** Overview card listing tracked Claude Code sessions, except cleared ones. */
export const ClaudeSessionsCard: React.FC<
  { sessions: ClaudeSession[]; tasks: Task[] } & ClaudeSessionActions
> = ({ sessions, tasks, ...actions }) => {
  const visible = sessions
    .filter((s) => !s.dismissedAt)
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-zinc-500" />
        <h3 className="text-sm font-semibold">Claude sessions</h3>
      </div>
      {visible.length === 0 ? (
        <p className="py-6 px-4 text-center text-xs text-zinc-500 dark:text-zinc-400 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
          {sessions.length > 0 ? (
            'All sessions cleared. They come back here when they become active again.'
          ) : (
            <>
              No sessions yet. Add the Dashboard hooks to <code>~/.claude/settings.json</code> (see
              "Claude Session Tracking" in PLAN.md) and start a Claude Code session.
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visible.map((s) => (
            <ClaudeSessionItem key={s.sessionId} session={s} tasks={tasks} {...actions} />
          ))}
        </ul>
      )}
    </div>
  );
};

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-0.5">
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
    <dd className="text-sm text-zinc-800 dark:text-zinc-100 break-words">{children}</dd>
  </div>
);

/** Side panel with everything the hooks have reported about one session, plus its actions. */
export const ClaudeSessionPanel: React.FC<
  {
    session: ClaudeSession | null;
    tasks: Task[];
    onClose: () => void;
  } & Omit<ClaudeSessionActions, 'onOpen'>
> = ({ session, tasks, onClose, onOpenTask, onLink, onCreateTask, onToggleCleared }) => {
  const asideRef = useRef<HTMLElement>(null);
  const isOpen = session !== null;

  // Move focus into the panel on open and hand it back on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  if (!session) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/25 dark:bg-black/50 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Claude session: ${session.title || 'Untitled session'}`}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className="focus:outline-none w-full max-w-lg bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <Bot className="w-4 h-4" />
            Claude session
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session details"
            title="Close (Esc)"
            className={iconButtonClass}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-2">
            <StateBadge state={session.state} />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 break-words">
              {session.title || 'Untitled session'}
            </h2>
          </div>

          {session.state === 'needs_attention' && session.attentionMessage && (
            <p className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {session.attentionMessage}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <OpenSessionLink session={session} withLabel />
            <CopyResumeButton session={session} withLabel />
            <button
              type="button"
              onClick={() => onToggleCleared(session)}
              className={`${iconButtonClass} inline-flex items-center gap-1.5 text-xs`}
            >
              {!session.dismissedAt ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Clear from Overview</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Show on Overview</span>
                </>
              )}
            </button>
          </div>

          <div className="space-y-2">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Task
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <TaskLinkControls
                session={session}
                tasks={tasks}
                onOpenTask={onOpenTask}
                onLink={onLink}
                onCreateTask={onCreateTask}
              />
            </div>
          </div>

          <dl className="space-y-3">
            {session.lastPrompt && (
              <Detail label="Last prompt">
                <span className="whitespace-pre-wrap">{session.lastPrompt}</span>
              </Detail>
            )}
            {session.lastTool && <Detail label="Last tool">{session.lastTool}</Detail>}
            <Detail label="Client">{CLIENT_LABELS[session.entrypoint] ?? (session.entrypoint || 'Unknown')}</Detail>
            <Detail label="Folder">
              <code className="text-xs">{session.cwd}</code>
            </Detail>
            <Detail label="Session id">
              <code className="text-xs">{session.sessionId}</code>
            </Detail>
            <Detail label="Started">{formatTimestamp(session.startedAt)}</Detail>
            <Detail label="Last activity">{formatTimestamp(session.lastEventAt)}</Detail>
          </dl>
        </div>
      </aside>
    </div>
  );
};
