import React, { useEffect, useRef, useState } from 'react';
import { Project, Task, TaskStatus, UpdateTaskInput } from '../../shared/types.ts';
import {
  PRIORITY_CONFIG,
  STATUS_LABELS,
  completionsByDay,
  formatShortDate,
  getTodayIso,
  heldDays,
  isPlanned,
  plural,
  resolveDateToken,
  suggestedPlanSize,
} from '../utils/taskUtils.ts';
import { REVIEW_REASON_LABELS, ReviewReason, reviewTasks } from '../utils/taskView.ts';
import { isTextInput } from '../utils/useGlobalShortcuts.ts';
import { parseIsoDate } from '../../shared/dates.ts';
import { Dot, KBD_CLASS, LABEL_CLASS } from './ui.tsx';

const DAY_MS = 86_400_000;
const daysSince = (ts: number, now = Date.now()) => Math.floor((now - ts) / DAY_MS);

export interface WeeklyReviewActions {
  onOpen: (id: string) => void;
  /** Marks the task reviewed, adding the note when one was typed. */
  onKeep: (task: Task, note: string) => void;
  onUpdate: (id: string, payload: UpdateTaskInput) => void;
  onSetStatus: (task: Task, status: TaskStatus) => void;
  onReschedule: (task: Task, dueDate: string) => void;
  onArchive: (task: Task) => void;
  /** Copies `message` and notes the follow-up on the task. */
  onChase: (task: Task, message: string) => void;
  onSetPlanSize: (size: number) => void;
}

interface WeeklyReviewProps {
  tasks: Task[];
  projects: Project[];
  staleDays: number;
  chaseDays: number;
  planSize: number;
  /** False while a dialog, palette or drawer has the keyboard. */
  keysEnabled: boolean;
  actions: WeeklyReviewActions;
}

type PromptKind = 'keep' | 'hold' | 'reschedule';

/** Snapshot entry: the set is fixed when the review starts, so acting on a task doesn't reshuffle it. */
interface Entry {
  id: string;
  reason: ReviewReason;
}

export const chaseMessage = (task: Task, now = Date.now()) =>
  `Hi, just following up on "${task.title}"${task.holdReason ? ` (${task.holdReason})` : ''}. ` +
  `It's been ${plural(heldDays(task, now), 'day')}; is there any update?`;

function reasonDetail(task: Task, reason: ReviewReason, today: string): string {
  switch (reason) {
    case 'overdue':
      return `Due ${formatShortDate(task.dueDate!)} · ${daysSince(parseIsoDate(task.dueDate!).getTime(), parseIsoDate(today).getTime())}d late`;
    case 'chase':
      return `On hold ${heldDays(task)}d${task.holdReason ? ` · ${task.holdReason}` : ''}`;
    default:
      return `Untouched ${daysSince(task.updatedAt)}d`;
  }
}

/**
 * Weekly review (roadmap 8): one stale, overdue or chase-due task at a time with single-key actions,
 * then the in-progress cap and the daily plan size. Starting again rebuilds the set.
 */
export const WeeklyReview: React.FC<WeeklyReviewProps> = ({
  tasks,
  projects,
  staleDays,
  chaseDays,
  planSize,
  keysEnabled,
  actions,
}) => {
  const today = getTodayIso();
  const snapshot = () => reviewTasks(tasks, staleDays, chaseDays).map(({ task, reason }) => ({ id: task.id, reason }));
  // Tasks may still be loading on first render; take the snapshot once they are here
  const [entries, setEntries] = useState<Entry[] | null>(null);
  useEffect(() => {
    if (entries === null && tasks.length > 0) setEntries(snapshot());
  }, [tasks.length, entries]);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [prompt, setPrompt] = useState<PromptKind | null>(null);

  // Deleted tasks drop out; the rest show their current state
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items = (entries ?? []).flatMap((e) => {
    const task = byId.get(e.id);
    return task ? [{ task, reason: e.reason }] : [];
  });
  const total = items.length;
  const handled = items.filter((i) => outcomes[i.task.id]).length;
  const item = cursor < total ? items[cursor] : undefined;

  const move = (to: number) => {
    setPrompt(null);
    setCursor(Math.max(0, Math.min(total, to)));
  };
  /** Records the outcome, then moves to the next task not yet handled (or the summary). */
  const settle = (task: Task, outcome: string) => {
    const next = { ...outcomes, [task.id]: outcome };
    setOutcomes(next);
    setPrompt(null);
    const after = items.findIndex((i, index) => index > cursor && !next[i.task.id]);
    setCursor(after === -1 ? total : after);
  };
  const restart = () => {
    setEntries(snapshot());
    setOutcomes({});
    setPrompt(null);
    setCursor(0);
  };

  const available = (key: string, task: Task, reason: ReviewReason) => {
    if (key === 's') return task.status !== 'in_progress';
    if (key === 'h') return task.status !== 'on_hold';
    if (key === 'p') return !isPlanned(task, today);
    if (key === 'd') return reason === 'chase';
    return true;
  };
  const run = (key: string) => {
    if (!item || !available(key, item.task, item.reason)) return false;
    const { task } = item;
    switch (key) {
      case ' ':
      case 'Space':
        setPrompt('keep');
        return true;
      case 'r':
        setPrompt('reschedule');
        return true;
      case 'h':
        setPrompt('hold');
        return true;
      case 's':
        actions.onSetStatus(task, 'in_progress');
        settle(task, 'Started');
        return true;
      case 'p':
        actions.onUpdate(task.id, { plannedFor: today });
        settle(task, 'Planned today');
        return true;
      case 'x':
        actions.onSetStatus(task, 'done');
        settle(task, 'Completed');
        return true;
      case 'a':
        actions.onArchive(task);
        settle(task, 'Archived');
        return true;
      case 'd':
        actions.onChase(task, chaseMessage(task));
        settle(task, 'Chased');
        return true;
      case 'o':
      case 'Enter':
        actions.onOpen(task.id);
        return true;
    }
    return false;
  };
  const submitPrompt = (value: string) => {
    if (!item || !prompt) return;
    const { task } = item;
    if (prompt === 'keep') {
      actions.onKeep(task, value);
      settle(task, value ? 'Kept with a note' : 'Kept');
    } else if (prompt === 'hold') {
      actions.onUpdate(task.id, { status: 'on_hold', holdReason: value || null });
      settle(task, 'On hold');
    } else {
      const date = resolveDateToken(value.replace(/^@/, ''));
      if (!date) return;
      actions.onReschedule(task, date);
      settle(task, `Moved to ${formatShortDate(date)}`);
    }
  };

  const keyHandler = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keyHandler.current = (e) => {
    if (e.key === 'j') return move(cursor + 1), true;
    if (e.key === 'k') return move(cursor - 1), true;
    return run(e.key);
  };
  useEffect(() => {
    if (!keysEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTextInput(e.target)) return;
      if (keyHandler.current(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keysEnabled]);

  if (entries === null) return null;

  return (
    <div className="max-w-2xl w-full mx-auto flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Weekly Review</h1>
          <span className="text-sm text-zinc-500">
            {item ? `${cursor + 1} of ${total}` : `${handled} of ${total} handled`}
          </span>
        </div>
        <div className="h-1 rounded bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
          <div
            className="h-full bg-primary-500 transition-all"
            style={{ width: `${total ? (handled / total) * 100 : 100}%` }}
          />
        </div>
        <ReasonCounts reasons={items.map((i) => i.reason)} />
      </div>

      {item ? (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <ReasonPill reason={item.reason} />
            <span className="text-xs text-zinc-500">{reasonDetail(item.task, item.reason, today)}</span>
            <span className="flex-1" />
            {outcomes[item.task.id] && <OutcomeChip label={outcomes[item.task.id]} />}
          </div>
          <h2 className="text-2xl font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{item.task.title}</h2>
          <TaskMeta task={item.task} projects={projects} />
          {item.task.latestNote && (
            <p className="text-sm text-zinc-500 italic">
              "{item.task.latestNote.text}" · {daysSince(item.task.latestNote.at)}d ago
            </p>
          )}
          {item.task.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-4 whitespace-pre-line">
              {item.task.description}
            </p>
          )}
          {prompt && (
            <PromptInput
              key={`${item.task.id}-${prompt}`}
              kind={prompt}
              onSubmit={submitPrompt}
              onCancel={() => setPrompt(null)}
            />
          )}
          <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap gap-2">
            {ACTIONS.filter((a) => available(a.key, item.task, item.reason)).map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => run(a.key)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <kbd className={KBD_CLASS}>{a.key === ' ' ? 'Space' : a.key.toUpperCase()}</kbd>
                {a.label}
              </button>
            ))}
          </div>
          <div className="text-xs text-zinc-400">
            <kbd className={KBD_CLASS}>J</kbd> skip · <kbd className={KBD_CLASS}>K</kbd> back ·{' '}
            <kbd className={KBD_CLASS}>Ctrl+Z</kbd> undo the last action
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel title={total ? 'Review done' : 'Nothing to review'}>
            {total > 0 ? (
              <OutcomeSummary outcomes={Object.values(outcomes)} skipped={total - handled} />
            ) : (
              <p className="text-sm text-zinc-500">
                No overdue, chase-due or stale tasks. Stale means untouched for {plural(staleDays, 'day')}.
              </p>
            )}
          </Panel>
          <Panel title="Work in progress">
            <WipCheck tasks={tasks} cap={planSize} actions={actions} />
          </Panel>
          <Panel title="Daily plan size">
            <PlanSizeCheck tasks={tasks} planSize={planSize} onSetPlanSize={actions.onSetPlanSize} />
          </Panel>
          {total > 0 && (
            <button
              type="button"
              onClick={restart}
              className="self-start text-sm text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
            >
              Start again
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const ACTIONS: { key: string; label: string }[] = [
  { key: ' ', label: 'Keep' },
  { key: 'r', label: 'Reschedule' },
  { key: 's', label: 'Start' },
  { key: 'p', label: 'Plan today' },
  { key: 'h', label: 'Hold' },
  { key: 'd', label: 'Draft chase' },
  { key: 'x', label: 'Complete' },
  { key: 'a', label: 'Archive' },
  { key: 'o', label: 'Open' },
];

const PROMPTS: Record<PromptKind, { placeholder: string; hint: string }> = {
  keep: { placeholder: 'Status note (optional)', hint: 'Enter keeps it as it is' },
  hold: { placeholder: 'Waiting on… (optional)', hint: 'Enter puts it on hold' },
  reschedule: { placeholder: 'tomorrow, fri, next-week, +3d, 2026-12-01', hint: '' },
};

const PromptInput: React.FC<{ kind: PromptKind; onSubmit: (value: string) => void; onCancel: () => void }> = ({
  kind,
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState('');
  const date = kind === 'reschedule' ? resolveDateToken(value.trim().replace(/^@/, '')) : null;
  const hint =
    kind === 'reschedule' ? (date ? `→ ${formatShortDate(date)}` : value.trim() ? 'Not a date' : '') : PROMPTS[kind].hint;
  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        value={value}
        maxLength={280}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value.trim());
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
        placeholder={PROMPTS[kind].placeholder}
        aria-label={PROMPTS[kind].placeholder}
        className="flex-1 min-w-0 rounded-md border border-primary-400 dark:border-primary-600 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 outline-none"
      />
      <span className="text-xs text-zinc-500 shrink-0">{hint} · Esc cancels</span>
    </div>
  );
};

const ReasonPill: React.FC<{ reason: ReviewReason }> = ({ reason }) => (
  <span
    className={`${LABEL_CLASS} px-1.5 py-0.5 rounded ${
      reason === 'overdue'
        ? 'bg-red-500/12 text-red-700 dark:text-red-300'
        : reason === 'chase'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'
    }`}
  >
    {REVIEW_REASON_LABELS[reason]}
  </span>
);

const OutcomeChip: React.FC<{ label: string }> = ({ label }) => (
  <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
    {label}
  </span>
);

const ReasonCounts: React.FC<{ reasons: ReviewReason[] }> = ({ reasons }) => (
  <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
    {(Object.keys(REVIEW_REASON_LABELS) as ReviewReason[]).map((reason) => {
      const n = reasons.filter((r) => r === reason).length;
      return n ? (
        <span key={reason}>
          {REVIEW_REASON_LABELS[reason]} {n}
        </span>
      ) : null;
    })}
  </div>
);

const TaskMeta: React.FC<{ task: Task; projects: Project[] }> = ({ task, projects }) => {
  const project = projects.find((p) => p.id === task.projectId);
  const doneSubtasks = task.subtasks.filter((s) => s.isCompleted).length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
      <span className="inline-flex items-center gap-1.5">
        <Dot color={project?.color} />
        {project?.name ?? 'No project'}
      </span>
      {task.priority > 0 && <span className={PRIORITY_CONFIG[task.priority].textClass}>{PRIORITY_CONFIG[task.priority].label}</span>}
      <span>{STATUS_LABELS[task.status]}</span>
      {task.dueDate && <span>Due {formatShortDate(task.dueDate)}</span>}
      <span>Updated {daysSince(task.updatedAt)}d ago</span>
      {task.subtasks.length > 0 && (
        <span>
          Subtasks {doneSubtasks}/{task.subtasks.length}
        </span>
      )}
    </div>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col gap-2.5">
    <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
    {children}
  </section>
);

const OutcomeSummary: React.FC<{ outcomes: string[]; skipped: number }> = ({ outcomes, skipped }) => {
  const counts = new Map<string, number>();
  // "Moved to 12 Nov" counts as Rescheduled
  for (const o of outcomes) {
    const label = o.startsWith('Moved to') ? 'Rescheduled' : o;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {[...counts].map(([label, n]) => (
        <span key={label} className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
          {label} {n}
        </span>
      ))}
      {skipped > 0 && <span className="px-2 py-0.5 text-zinc-500">Skipped {skipped}</span>}
    </div>
  );
};

/** In progress over the plan size: offer the oldest back to To Do or on hold. */
const WipCheck: React.FC<{ tasks: Task[]; cap: number; actions: WeeklyReviewActions }> = ({ tasks, cap, actions }) => {
  const inProgress = tasks.filter((t) => t.status === 'in_progress').sort((a, b) => a.updatedAt - b.updatedAt);
  const over = inProgress.length - cap;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        <span className={over > 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-zinc-700 dark:text-zinc-300'}>
          {inProgress.length} in progress
        </span>
        <span className="text-zinc-500">
          {' '}
          · cap {cap} (plan size){over > 0 ? `. Move the ${over === 1 ? 'oldest' : `${over} oldest`} back?` : ', within it'}
        </span>
      </p>
      {inProgress.slice(0, Math.max(0, over)).map((t) => (
        <div key={t.id} className="flex items-center gap-3 text-sm">
          <button
            type="button"
            onClick={() => actions.onOpen(t.id)}
            className="flex-1 min-w-0 truncate text-left text-zinc-700 dark:text-zinc-200 hover:underline cursor-pointer"
            title={t.title}
          >
            {t.title}
          </button>
          <span className="text-xs text-zinc-400 shrink-0">{daysSince(t.updatedAt)}d</span>
          <button
            type="button"
            onClick={() => actions.onSetStatus(t, 'todo')}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
          >
            To Do
          </button>
          <button
            type="button"
            onClick={() => actions.onUpdate(t.id, { status: 'on_hold' })}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
          >
            Hold
          </button>
        </div>
      ))}
    </div>
  );
};

/** Completions per day for 14 days, and the working-day median offered as the plan size. */
const PlanSizeCheck: React.FC<{ tasks: Task[]; planSize: number; onSetPlanSize: (size: number) => void }> = ({
  tasks,
  planSize,
  onSetPlanSize,
}) => {
  const days = completionsByDay(tasks, 14);
  const suggested = suggestedPlanSize(tasks);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end gap-1 h-16" aria-hidden>
        {days.map((d) => {
          const weekend = [0, 6].includes(parseIsoDate(d.date).getDay());
          return (
            <div
              key={d.date}
              title={`${formatShortDate(d.date)}: ${d.count}`}
              className="flex-1 h-full flex flex-col justify-end items-stretch"
            >
              {d.count > 0 && (
                <span className="text-[10px] leading-3 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
                  {d.count}
                </span>
              )}
              <div
                className={`rounded-sm ${weekend ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-primary-500/70'}`}
                style={{ height: `max(6px, calc((100% - 0.75rem) * ${d.count / max}))` }}
              />
            </div>
          );
        })}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        You complete a median of <b>{suggested}</b> a working day over the last 14 days. Plan size is <b>{planSize}</b>.
      </p>
      {suggested !== planSize && (
        <button
          type="button"
          onClick={() => onSetPlanSize(suggested)}
          className="self-start px-2.5 py-1 rounded-md bg-primary-600 hover:bg-primary-700 text-white text-sm cursor-pointer"
        >
          Use {suggested}
        </button>
      )}
    </div>
  );
};
