import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bot,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  ListPlus,
  Unlink,
  X,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';
import { ClaudeSession, ClaudeSessionState, Task } from '../../shared/types.ts';
import { formatRelativeTime, formatTimestamp } from '../utils/taskUtils.ts';
import { DockedPanel, LABEL_CLASS, SectionHeader } from './ui.tsx';

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
  { session: ClaudeSession; tasks: Task[]; /** Icon only, no linked-task chip. */ compact?: boolean } & Omit<
    ClaudeSessionActions,
    'onOpen' | 'onToggleCleared'
  >
> = ({ session, tasks, onLink, onCreateTask, onOpenTask, compact }) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const linkedTask = tasks.find((t) => t.id === session.taskId);
  return (
    <>
      {linkedTask && !compact && (
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
        {!linkedTask && !compact && <span>Link task</span>}
      </button>
      {/* Portalled: the Home rail hides these controls with display: none when not hovered, which
          would leave the open modal invisible and the page inert */}
      {createPortal(
        <TaskLinkDialog
          session={dialogOpen ? session : null}
          tasks={tasks}
          onClose={() => setDialogOpen(false)}
          onLink={onLink}
          onCreateTask={onCreateTask}
        />,
        document.body
      )}
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
  <li className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border ${CARD_STYLES[session.state].card}`}>
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

const RAIL_DOT: Record<ClaudeSessionState, string> = {
  needs_attention: 'bg-amber-400 ring-[3px] ring-amber-400/20',
  running: 'bg-indigo-400',
  idle: 'bg-emerald-400',
  ended: 'bg-zinc-400 dark:bg-zinc-600',
};

/** Live (not ended, not cleared) sessions: needs attention first, then running, then idle. */
export const liveSessions = (sessions: ClaudeSession[]) =>
  sessions
    .filter((s) => s.state !== 'ended' && !s.dismissedAt)
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || b.lastEventAt - a.lastEventAt);

export const CLAUDE_RAIL_ID = 'home-claude-sessions';

/** Home rail: live sessions with a state dot; link, open, copy and clear appear on hover. */
export const ClaudeSessionsRail: React.FC<
  { sessions: ClaudeSession[]; tasks: Task[] } & ClaudeSessionActions
> = ({ sessions, tasks, onOpen, onOpenTask, onLink, onCreateTask, onToggleCleared }) => {
  const live = liveSessions(sessions);
  return (
    <section id={CLAUDE_RAIL_ID} aria-labelledby={`${CLAUDE_RAIL_ID}-title`} className="scroll-mt-6">
      <SectionHeader id={`${CLAUDE_RAIL_ID}-title`} title="Claude sessions" meta={`${live.length} live`} />
      {live.length === 0 ? (
        <p className="px-1 py-3 text-[13px] text-zinc-500">
          {sessions.length > 0 ? (
            'No live sessions.'
          ) : (
            <>
              No sessions yet. Add the Dashboard hooks to <code>~/.claude/settings.json</code> (see "Claude Session
              Tracking" in PLAN.md).
            </>
          )}
        </p>
      ) : (
        <ul className="pt-1.5">
          {live.map((s) => (
            <li
              key={s.sessionId}
              className={`group flex items-center gap-2.5 py-1.5 ${
                s.state === 'needs_attention' ? '-mx-1 px-2 rounded-lg bg-amber-50 dark:bg-amber-500/10' : 'px-1'
              }`}
            >
              <span
                role="img"
                aria-label={STATE_STYLES[s.state].label}
                title={STATE_STYLES[s.state].label}
                className={`shrink-0 w-2 h-2 rounded-full ${RAIL_DOT[s.state]}`}
              />
              <button
                type="button"
                onClick={() => onOpen(s.sessionId)}
                title="Show session details"
                className="flex-1 min-w-0 text-left cursor-pointer"
              >
                <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                  {s.title || 'Untitled session'}
                </span>
                <span className="block truncate text-[11px] text-zinc-500" title={s.cwd}>
                  {folderName(s.cwd)} · {sessionStateLine(s)}
                </span>
              </button>
              <span className="shrink-0 hidden group-hover:flex group-focus-within:flex items-center">
                <TaskLinkControls
                  session={s}
                  tasks={tasks}
                  onOpenTask={onOpenTask}
                  onLink={onLink}
                  onCreateTask={onCreateTask}
                  compact
                />
                <OpenSessionLink session={s} />
                <CopyResumeButton session={s} />
                <button
                  type="button"
                  aria-label="Clear session"
                  title="Clear from this list (it comes back if the session becomes active)"
                  onClick={() => onToggleCleared(s)}
                  className={iconButtonClass}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

/** "needs attention", "running · Edit", "idle · 14 minutes ago" */
function sessionStateLine(s: ClaudeSession): string {
  if (s.state === 'running') return s.lastTool ? `running · ${s.lastTool}` : 'running';
  if (s.state === 'idle') return `idle · ${formatRelativeTime(s.lastEventAt)}`;
  return STATE_STYLES[s.state].label.toLowerCase();
}

/** Text with `backticked` parts shown as code chips. */
const InlineCode: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(`[^`]+`)/).map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
        <code
          key={i}
          className="mx-0.5 px-1.5 py-px rounded font-mono text-[11.5px] bg-amber-500/15 dark:bg-black/35 text-amber-800 dark:text-amber-200"
        >
          {part.slice(1, -1)}
        </code>
      ) : (
        part
      )
    )}
  </>
);

/** Home banner for the newest session waiting on the user; nothing when none is. */
export const ClaudeAttentionBanner: React.FC<{ sessions: ClaudeSession[]; tasks: Task[] }> = ({ sessions, tasks }) => {
  const [copied, setCopied] = useState(false);
  const waiting = sessions
    .filter((s) => s.state === 'needs_attention' && !s.dismissedAt)
    .sort((a, b) => b.lastEventAt - a.lastEventAt);
  const session = waiting[0];
  if (!session) return null;
  const task = tasks.find((t) => t.id === session.taskId);
  const link = sessionLink(session);

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3.5 px-4 py-3.5 rounded-xl bg-amber-500/[.08] border border-amber-500/30"
    >
      <span className="shrink-0 w-[34px] h-[34px] rounded-[9px] bg-amber-500/20 text-amber-700 dark:text-amber-300 flex items-center justify-center">
        <Bot className="w-[17px] h-[17px]" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] truncate">
          <span className="font-semibold uppercase tracking-[0.04em] text-amber-700 dark:text-amber-300">
            Claude needs you
          </span>
          <span className="ml-2 text-zinc-500 dark:text-zinc-400" title={session.cwd}>
            {folderName(session.cwd)} · {formatRelativeTime(session.lastEventAt)}
          </span>
        </p>
        <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
          {task?.title ?? (session.title || 'Untitled session')}
        </p>
        <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300 truncate">
          {session.attentionMessage ? <InlineCode text={session.attentionMessage} /> : 'Waiting for your input'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={link.url}
          title={link.label}
          className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-900 text-xs font-semibold transition-colors duration-150"
        >
          <ExternalLink className="w-[13px] h-[13px]" />
          Open in Claude
        </a>
        <button
          type="button"
          title={resumeCommand(session)}
          onClick={async () => {
            await navigator.clipboard.writeText(resumeCommand(session));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-[7px] rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150 cursor-pointer"
        >
          {copied ? <Check className="w-[13px] h-[13px] text-emerald-500" /> : <Copy className="w-[13px] h-[13px]" />}
          {copied ? 'Copied' : 'Resume'}
        </button>
        {waiting.length > 1 && (
          <button
            type="button"
            onClick={() => document.getElementById(CLAUDE_RAIL_ID)?.scrollIntoView({ behavior: 'smooth' })}
            className="text-xs text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
          >
            +{waiting.length - 1} more
          </button>
        )}
      </div>
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
                  <span>Clear from Home</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Show on Home</span>
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

/** Claude's starburst mark, drawn in currentColor. */
export const ClaudeIcon: React.FC<{ className?: string }> = ({ className }) => (
  // Claude Bot
  // <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden className={className}>
  //   <path clip-rule="evenodd" d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z" />
  // </svg>
  
  // Claude Starburst
  <svg xmlns="http://www.w3.org/2000/svg" height="24" width="24" viewBox="0 0 640 640" aria-hidden className={className}>
    <path fill="currentColor" d="M164.4 404.5L265.1 348L266.8 343.1L265.1 340.4L260.2 340.4L243.4 339.4L185.9 337.8L136 335.7L87.7 333.1L75.5 330.5L64.1 315.5L65.3 308L75.5 301.1L90.2 302.4C109.1 303.7 136.1 305.5 171.2 308L206.4 310.1L258.6 315.5L266.9 315.5L268.1 312.1L265.3 310L263.1 307.9L212.8 273.8L158.4 237.8L129.9 217.1L114.5 206.6L106.7 196.8L103.3 175.3L117.3 159.9L136.1 161.2L140.9 162.5L159.9 177.2L200.6 208.7L253.7 247.8L261.5 254.3L264.6 252.1L265 250.5L261.5 244.7L232.6 192.5L201.8 139.4L188.1 117.4L184.5 104.2C183.2 98.8 182.3 94.2 182.3 88.7L198.2 67.1L207 64.3L228.2 67.1L237.1 74.9L250.3 105.1L271.7 152.6L304.9 217.2L314.6 236.4L319.8 254.2L321.7 259.6L325.1 259.6L325.1 256.5L327.8 220.1L332.8 175.4L337.7 117.9L339.4 101.7L347.4 82.3L363.3 71.8L375.7 77.7L385.9 92.4L384.5 101.9L378.4 141.4L366.5 203.3L358.7 244.8L363.2 244.8L368.4 239.6L389.4 211.8L424.6 167.7L440.1 150.2L458.2 130.9L469.8 121.7L491.8 121.7L508 145.8L500.7 170.7L478 199.4L459.2 223.8L432.2 260.1L415.4 289.1L417 291.4L421 291L481.9 278L514.8 272.1L554.1 265.4L571.9 273.7L573.8 282.1L566.8 299.3L524.8 309.7L475.6 319.5L402.3 336.8L401.4 337.5L402.4 338.8L435.4 341.9L449.5 342.7L484.1 342.7L548.5 347.5L565.3 358.6L575.4 372.2L573.7 382.6L547.8 395.8C532.3 392.1 493.4 382.9 431.2 368.1L403.2 361.1L399.3 361.1L399.3 363.4L422.6 386.2L465.3 424.8L518.8 474.6L521.5 486.9L514.6 496.6L507.3 495.6L460.3 460.2L442.2 444.3L401.1 409.7L398.4 409.7L398.4 413.3L407.9 427.2L457.9 502.4L460.5 525.4L456.9 532.9L443.9 537.4L429.7 534.8L400.4 493.7L370.2 447.4L345.8 405.9L342.8 407.6L328.4 562.4L321.7 570.3L306.2 576.2L293.2 566.4L286.3 550.5L293.2 519L301.5 477.9L308.2 445.2L314.3 404.6L317.9 391.1L317.7 390.2L314.7 390.6L284.1 432.6L237.6 495.5L200.8 534.9L192 538.4L176.7 530.5L178.1 516.4L186.6 503.8L237.5 439L268.2 398.8L288 375.6L287.9 372.2L286.7 372.2L151.4 460L127.3 463.1L116.9 453.4L118.2 437.5L123.1 432.3L163.8 404.3L163.7 404.4L163.7 404.5z"/>
  </svg>
);

/** Card look per state: border and background, dot, and state label colour. */
const CARD_STYLES: Record<ClaudeSessionState, { card: string; dot: string; label: string }> = {
  needs_attention: {
    card: 'border-amber-400/70 dark:border-amber-500/50 bg-amber-100/70 dark:bg-amber-500/[.12] shadow-sm shadow-amber-500/10',
    dot: 'bg-amber-400 ring-[3px] ring-amber-400/25 animate-pulse',
    label: 'text-amber-700 dark:text-amber-300',
  },
  running: {
    card: 'border-indigo-300/70 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10',
    dot: 'bg-indigo-400 animate-pulse',
    label: 'text-indigo-600 dark:text-indigo-300',
  },
  idle: {
    card: 'border-emerald-200/80 dark:border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-500/[.07]',
    dot: 'bg-emerald-400',
    label: 'text-emerald-700 dark:text-emerald-400',
  },
  ended: {
    card: 'border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-800/40 opacity-75 hover:opacity-100 focus-within:opacity-100',
    dot: 'bg-zinc-300 dark:bg-zinc-600',
    label: 'text-zinc-500 dark:text-zinc-400',
  },
};

/** One session in the side panel: state, time, title, folder, attention message or last prompt, actions. */
const SessionCard: React.FC<{ session: ClaudeSession; tasks: Task[] } & ClaudeSessionActions> = ({
  session: s,
  tasks,
  onOpen,
  onToggleCleared,
  ...linkActions
}) => {
  const style = CARD_STYLES[s.state];
  const attention = s.state === 'needs_attention';
  const detail = attention ? s.attentionMessage || 'Waiting for your input' : s.lastPrompt;
  return (
    <li className={`rounded-xl border p-3 space-y-2 transition-opacity duration-150 ${style.card}`}>
      <div className="flex items-center gap-2 text-[11px]">
        <span aria-hidden className={`shrink-0 w-2 h-2 rounded-full ${style.dot}`} />
        <span className={`font-semibold uppercase tracking-[0.04em] truncate ${style.label}`}>
          {s.state === 'running' && s.lastTool ? `Running · ${s.lastTool}` : STATE_STYLES[s.state].label}
        </span>
        <span className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400" title={formatTimestamp(s.lastEventAt)}>
          {formatRelativeTime(s.lastEventAt)}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onOpen(s.sessionId)}
        title="Show session details"
        className="block w-full text-left cursor-pointer group"
      >
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100 line-clamp-2 break-words group-hover:underline">
          {s.title || 'Untitled session'}
        </span>
        <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-400" title={s.cwd}>
          {folderName(s.cwd)}
          {CLIENT_LABELS[s.entrypoint] && ` · ${CLIENT_LABELS[s.entrypoint]}`}
        </span>
      </button>

      {detail && (
        <p
          className={`text-xs line-clamp-2 break-words ${
            attention ? 'text-amber-900 dark:text-amber-200' : 'text-zinc-600 dark:text-zinc-400'
          }`}
        >
          {attention ? <InlineCode text={detail} /> : detail}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1 pt-1.5 border-t border-zinc-200/70 dark:border-zinc-800/70">
        <TaskLinkControls session={s} tasks={tasks} {...linkActions} />
        <span className="ml-auto flex items-center">
          <OpenSessionLink session={s} />
          <CopyResumeButton session={s} />
          <button
            type="button"
            aria-label={s.dismissedAt ? 'Restore session' : 'Clear session'}
            title={s.dismissedAt ? 'Restore' : 'Clear (it comes back if the session becomes active)'}
            onClick={() => onToggleCleared(s)}
            className={iconButtonClass}
          >
            {s.dismissedAt ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </span>
      </div>
    </li>
  );
};

/** Sessions needing the user first, then the rest by latest activity; cleared ones kept apart. */
export function groupSessionsForPanel(sessions: ClaudeSession[]) {
  const byActivity = [...sessions].sort((a, b) => b.lastEventAt - a.lastEventAt);
  const shown = byActivity.filter((s) => !s.dismissedAt);
  return {
    attention: shown.filter((s) => s.state === 'needs_attention'),
    rest: shown.filter((s) => s.state !== 'needs_attention'),
    cleared: byActivity.filter((s) => s.dismissedAt),
  };
}

/** Docked right-hand panel with every Claude session, live or ended, as a card. */
export const ClaudeSessionsSidePanel: React.FC<
  { sessions: ClaudeSession[]; tasks: Task[]; onClose: () => void } & ClaudeSessionActions
> = ({ sessions, tasks, onClose, ...actions }) => {
  const { attention, rest, cleared } = groupSessionsForPanel(sessions);
  const count = (state: ClaudeSessionState) => rest.filter((s) => s.state === state).length;
  const summary = [
    attention.length && `${attention.length} need you`,
    count('running') && `${count('running')} running`,
    count('idle') && `${count('idle')} idle`,
    count('ended') && `${count('ended')} ended`,
  ].filter(Boolean);
  const cards = (list: ClaudeSession[]) => (
    <ul className="space-y-2">
      {list.map((s) => (
        <SessionCard key={s.sessionId} session={s} tasks={tasks} {...actions} />
      ))}
    </ul>
  );

  return (
    <DockedPanel title="Claude sessions" widthKey="dashboard_claude_panel_width" onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4">
        {sessions.length === 0 ? (
          <p className="px-1 py-3 text-[13px] text-zinc-500">
            No sessions yet. Add the Dashboard hooks to <code>~/.claude/settings.json</code> (see "Claude Session
            Tracking" in PLAN.md).
          </p>
        ) : (
          <>
            {summary.length > 0 && <p className="px-1 text-xs text-zinc-500">{summary.join(' · ')}</p>}
            {attention.length > 0 && (
              <section aria-label="Needs your input" className="space-y-2">
                <h3 className={`px-1 ${LABEL_CLASS} text-amber-700 dark:text-amber-300`}>Needs your input</h3>
                {cards(attention)}
              </section>
            )}
            {rest.length > 0 && (
              <section aria-label="Recent activity" className="space-y-2">
                {attention.length > 0 && <h3 className={`px-1 ${LABEL_CLASS} text-zinc-500`}>Recent activity</h3>}
                {cards(rest)}
              </section>
            )}
            {cleared.length > 0 && (
              <details className="group/cleared space-y-2">
                <summary
                  className={`flex items-center gap-1.5 px-1 list-none cursor-pointer ${LABEL_CLASS} text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300`}
                >
                  <ChevronRight className="w-3 h-3 transition-transform duration-150 group-open/cleared:rotate-90" />
                  Cleared · {cleared.length}
                </summary>
                {cards(cleared)}
              </details>
            )}
          </>
        )}
      </div>
    </DockedPanel>
  );
};
