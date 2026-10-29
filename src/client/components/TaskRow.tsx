import React, { useState, useRef, useEffect } from 'react';
import {
  Check,
  Trash2,
  Pencil,
  X,
  Plus,
  SquareCheck,
  AlignLeft,
  Archive,
  ArchiveRestore,
  Repeat,
  Bot,
  ExternalLink,
  GitPullRequest,
  Pause,
  MessageSquare,
} from 'lucide-react';
import {
  Task,
  Project,
  TaskPriority,
  UpdateTaskInput,
  ClaudeSession,
} from '../../shared/types.ts';
import { describeRecurrence } from '../../shared/recurrence.ts';
import { checklistProgress } from '../utils/markdown.ts';
import {
  PRIORITY_CONFIG,
  formatShortDate,
  getDueDateInfo,
  cleanTag,
  heldDays,
  needsChase,
  formatRelativeTime,
} from '../utils/taskUtils.ts';
import { externalLinkLabel } from './AdoImport.tsx';
import { DatePopover } from './DatePicker.tsx';
import { STATE_STYLES, primaryClaudeSession } from './ClaudeSessions.tsx';
import { BADGE_CLASS, Dot, LABEL_CLASS, NEUTRAL_BADGE_CLASS } from './ui.tsx';

/**
 * Column grid shared by TaskRow and TaskListHeader: Task · Tags · Project · Due · Priority.
 * Project views drop the Project column. Narrow windows drop Tags (<1200px), then Project (<1000px).
 */
export const taskGridClass = (showProject: boolean) =>
  showProject
    ? 'grid grid-cols-[minmax(0,1fr)_140px_130px_130px_84px] max-[1200px]:grid-cols-[minmax(0,1fr)_130px_130px_84px] max-[1000px]:grid-cols-[minmax(0,1fr)_130px_84px]'
    : 'grid grid-cols-[minmax(0,1fr)_140px_130px_84px] max-[1200px]:grid-cols-[minmax(0,1fr)_130px_84px]';

/** Column labels for a task list. */
export const TaskListHeader: React.FC<{ showProject?: boolean }> = ({ showProject = true }) => (
  <div
    aria-hidden
    className={`${taskGridClass(showProject)} gap-3 px-2 pt-1.5 ${LABEL_CLASS} text-zinc-400 dark:text-zinc-600`}
  >
    <span>Task</span>
    <span className="max-[1200px]:hidden">Tags</span>
    {showProject && <span className="max-[1000px]:hidden">Project</span>}
    <span>Due</span>
    <span>Priority</span>
  </div>
);

/** Cycles To Do → In Progress → Completed → To Do through `onToggle`; On Hold resumes as In Progress. */
export const TaskStatusCheckbox: React.FC<{ task: Task; onToggle: (task: Task) => void }> = ({
  task,
  onToggle,
}) => {
  const isArchived = task.status === 'archived';
  const isInProgress = task.status === 'in_progress';
  const isOnHold = task.status === 'on_hold';
  const isDone = task.status === 'done' || (isArchived && task.completedAt !== null);
  return (
    <button
      type="button"
      onClick={() => onToggle(task)}
      disabled={isArchived}
      aria-label={
        isArchived
          ? `"${task.title}" is archived`
          : isDone
          ? `Mark "${task.title}" as incomplete`
          : isInProgress
          ? `Mark "${task.title}" as complete`
          : isOnHold
          ? `Resume "${task.title}"`
          : `Mark "${task.title}" as in progress`
      }
      title={
        isArchived
          ? 'Archived'
          : isDone
          ? 'Completed (click to reopen as To Do)'
          : isInProgress
          ? 'In Progress (click to mark Completed)'
          : isOnHold
          ? `On Hold${task.holdReason ? `: ${task.holdReason}` : ''} (click to resume)`
          : 'To Do (click to mark In Progress)'
      }
      className={`shrink-0 w-[18px] h-[18px] rounded-md border flex items-center justify-center transition-colors duration-150 cursor-pointer disabled:cursor-default disabled:opacity-60 ${
        isDone
          ? 'bg-primary-600 border-primary-600 text-white'
          : isInProgress
          ? 'border-(--in-progress) bg-(--in-progress)/15 hover:bg-(--in-progress)/25'
          : isOnHold
          ? 'border-slate-400 text-slate-500 dark:text-slate-400 hover:border-primary-500'
          : 'border-zinc-300 dark:border-zinc-600 hover:border-primary-500 dark:hover:border-primary-400'
      }`}
    >
      {isDone && <Check className="w-[12px] h-[12px] stroke-[3]" />}
      {isInProgress && <span className="w-[8px] h-[8px] rounded-sm bg-(--in-progress)" />}
      {isOnHold && <Pause className="w-[10px] h-[10px] fill-current" />}
    </button>
  );
};

/** Bot badge: amber when the most urgent linked session needs attention, else primary. */
export const ClaudeSessionBadge: React.FC<{
  sessions: ClaudeSession[];
  onOpenSession?: (sessionId: string) => void;
}> = ({ sessions, onOpenSession }) => {
  const primarySession = primaryClaudeSession(sessions);
  if (!primarySession) return null;
  const label = `Claude session (${STATE_STYLES[primarySession.state].label}): ${
    primarySession.title || 'Untitled session'
  }`;
  return (
    <button
      type="button"
      onClick={() => onOpenSession?.(primarySession.sessionId)}
      aria-label={`${label}${sessions.length > 1 ? ` (${sessions.length} sessions)` : ''}`}
      title={`${label}${sessions.length > 1 ? ` (+${sessions.length - 1} more)` : ''}`}
      className={`${BADGE_CLASS} cursor-pointer transition-colors duration-150 ${
        primarySession.state === 'needs_attention'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25'
          : primarySession.state === 'ended'
          ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
          : 'bg-primary-500/15 text-primary-700 dark:text-primary-300 hover:bg-primary-500/25'
      }`}
    >
      <Bot className="w-[11px] h-[11px]" />
      {sessions.length > 1 && <span>{sessions.length}</span>}
    </button>
  );
};

/** "PR 482" or "#3127" for the first linked item, with the matching icon, and "+2" for more. */
export const AdoBadge: React.FC<{ task: Task }> = ({ task }) => {
  const [first, ...more] = task.adoLinks;
  if (!first) return null;
  const [kind, id] = first.externalId.split('/');
  const Icon = kind === 'pr' ? GitPullRequest : ExternalLink;
  return (
    <a
      href={first.url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`Open ${externalLinkLabel(first.externalId)}`}
      title={[first, ...more].map((l) => externalLinkLabel(l.externalId)).join('\n')}
      className={`${NEUTRAL_BADGE_CLASS} hover:text-primary-600 dark:hover:text-primary-400 transition-colors duration-150`}
    >
      <Icon className="w-[11px] h-[11px]" />
      <span>{kind === 'pr' ? `PR ${id}` : `#${id}`}</span>
      {more.length > 0 && <span className="text-zinc-400">+{more.length}</span>}
    </a>
  );
};

/** Icon for a task's latest status note; the note shows on hover or focus. */
export const StatusNoteBadge: React.FC<{ note: { text: string; at: number }; onOpen?: () => void }> = ({
  note,
  onOpen,
}) => (
  <span className="relative shrink-0 group/note">
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Status note: ${note.text}`}
      className={`${BADGE_CLASS} bg-primary-500/15 text-primary-700 dark:text-primary-300 cursor-pointer`}
    >
      <MessageSquare className="w-[11px] h-[11px]" />
    </button>
    <span
      role="tooltip"
      className="hidden group-hover/note:block group-focus-within/note:block absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-800 dark:text-zinc-100 shadow-lg whitespace-normal"
    >
      {note.text}
      <span className="block text-zinc-400">{formatRelativeTime(note.at)}</span>
    </span>
  </span>
);

interface TaskRowProps {
  task: Task;
  projects: Project[];
  /** False in project views, which have no Project column. */
  showProject?: boolean;
  claudeSessions?: ClaudeSession[];
  onOpenSession?: (sessionId: string) => void;
  isSelected?: boolean;
  onSelect?: (task: Task) => void;
  onToggle: (task: Task) => void;
  onUpdate: (id: string, payload: UpdateTaskInput) => void;
  onDelete: (id: string) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  /** Days on hold before the row shows "Chase?". */
  chaseHoldDays?: number;
  /** How the latest status note shows: a second line under the title, or an icon. */
  noteStyle?: 'line' | 'icon';
  /** Drag handle supplied by ReorderableTaskList when manual sorting is active. */
  dragHandle?: React.ReactNode;
  /** Inline title editing, controlled by App so the `e` shortcut can start it. */
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Roving tabindex: exactly one row in the list is reachable with Tab. */
  isTabStop: boolean;
  onFocusRow: (taskId: string) => void;
}

const actionButtonClass =
  'p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 cursor-pointer';
const cellSelectClass =
  'max-w-full truncate bg-transparent appearance-none text-xs cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/60';

export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  projects,
  showProject = true,
  claudeSessions = [],
  onOpenSession,
  isSelected = false,
  onSelect,
  onToggle,
  onUpdate,
  onDelete,
  onArchive,
  onRestore,
  chaseHoldDays = 7,
  noteStyle = 'line',
  dragHandle,
  isEditing,
  onEditingChange: setIsEditing,
  isTabStop,
  onFocusRow,
}) => {
  const isArchived = task.status === 'archived';
  const isInProgress = task.status === 'in_progress';
  const isDone = task.status === 'done' || (isArchived && task.completedAt !== null);
  const [draftTitle, setDraftTitle] = useState(task.title);

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagText, setNewTagText] = useState('');

  const [showDateMenu, setShowDateMenu] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(task.title);
  }, [task.title]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (isAddingTag) {
      tagInputRef.current?.focus();
    }
  }, [isAddingTag]);

  const handleSaveTitle = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdate(task.id, { title: trimmed });
    } else {
      setDraftTitle(task.title);
    }
    setIsEditing(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraftTitle(task.title);
      setIsEditing(false);
    }
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanTag(newTagText);
    if (cleaned && !task.tags.includes(cleaned)) {
      onUpdate(task.id, { tags: [...task.tags, cleaned] });
    }
    setNewTagText('');
    setIsAddingTag(false);
  };

  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const baseDueInfo = getDueDateInfo(task.dueDate);
  // A completed task is no longer due: show the original date, muted and struck through.
  const dueInfo =
    isDone && task.dueDate !== null
      ? {
          ...baseDueInfo,
          label: formatShortDate(task.dueDate),
          badgeClass: 'text-zinc-400 dark:text-zinc-500 line-through bg-zinc-100 dark:bg-zinc-800',
        }
      : baseDueInfo;
  const project = projects.find((p) => p.id === task.projectId);

  const subtasks = task.subtasks ?? [];
  const completedSubtasks = subtasks.filter((s) => s.isCompleted).length;
  const hasNotes = Boolean(task.description && task.description.trim().length > 0);
  const notesChecklist = hasNotes ? checklistProgress(task.description) : null;
  const statusNote = task.latestNote;
  // A finished task's note stays in the drawer; the row would only repeat it
  const showNoteLine = noteStyle === 'line' && Boolean(statusNote) && !isDone && !isArchived;

  return (
    <div
      data-testid={`task-row-${task.id}`}
      data-task-row={task.id}
      data-task-status={task.status}
      tabIndex={isTabStop ? 0 : -1}
      role="group"
      aria-label={`${task.title}${isInProgress ? ', in progress' : ''}${isDone ? ', completed' : ''}${isArchived ? ', archived' : ''}`}
      onFocus={() => onFocusRow(task.id)}
      className={`group ${taskGridClass(showProject)} items-center gap-3 p-2 border-t border-zinc-200/70 dark:border-zinc-800/50 outline-none focus-visible:bg-primary-500/10 transition-colors duration-150 ${
        isSelected
          ? 'bg-primary-500/10'
          : isInProgress
          ? 'bg-(--in-progress)/[.04] hover:bg-(--in-progress)/[.08]'
          : 'hover:bg-zinc-100/70 dark:hover:bg-zinc-900/60'
      } ${isInProgress ? 'shadow-[inset_2px_0_0_var(--in-progress)]' : ''}`}
    >
      {/* Task: checkbox, title, badges; row actions appear at the end on hover */}
      <div className="flex items-center gap-2.5 min-w-0">
        {dragHandle}
        <TaskStatusCheckbox task={task} onToggle={onToggle} />

        <div className={`min-w-0 flex flex-col ${isEditing ? 'flex-1' : ''}`}>
        <div className="min-w-0 flex items-center gap-2.5">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={handleTitleKeyDown}
            aria-label="Edit task title"
            className="flex-1 min-w-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 text-sm px-2 py-0.5 rounded border border-primary-500 focus:outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => onSelect?.(task)}
              className={`min-w-0 text-left text-sm truncate cursor-pointer transition-colors duration-150 ${
                isDone
                  ? 'line-through text-zinc-400 dark:text-zinc-500'
                  : 'text-zinc-900 dark:text-zinc-100 hover:text-primary-600 dark:hover:text-primary-400'
              }`}
              title={`${task.title}\n\nClick to open details`}
            >
              {task.title}
            </button>

            {subtasks.length > 0 && (
              <button
                type="button"
                onClick={() => onSelect?.(task)}
                aria-label={`Subtasks ${completedSubtasks} of ${subtasks.length}`}
                className={`${NEUTRAL_BADGE_CLASS} cursor-pointer`}
              >
                <SquareCheck className="w-[11px] h-[11px]" />
                <span>
                  {completedSubtasks}/{subtasks.length}
                </span>
              </button>
            )}

            {hasNotes && (
              <button
                type="button"
                onClick={() => onSelect?.(task)}
                aria-label={
                  notesChecklist
                    ? `View notes for "${task.title}", checklist ${notesChecklist.done} of ${notesChecklist.total} done`
                    : `View notes for "${task.title}"`
                }
                title={notesChecklist ? 'Notes checklist progress' : 'Has markdown notes'}
                className={`${BADGE_CLASS} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 cursor-pointer`}
              >
                <AlignLeft className="w-[11px] h-[11px]" />
                {notesChecklist && (
                  <span>
                    {notesChecklist.done}/{notesChecklist.total}
                  </span>
                )}
              </button>
            )}

            {task.recurrence && (
              <span
                role="img"
                aria-label={`Repeats: ${describeRecurrence(task.recurrence)}`}
                title={describeRecurrence(task.recurrence)}
                className={`${BADGE_CLASS} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400`}
              >
                <Repeat className="w-[11px] h-[11px]" />
              </span>
            )}

            {noteStyle === 'icon' && statusNote && (
              <StatusNoteBadge note={statusNote} onOpen={() => onSelect?.(task)} />
            )}
            <ClaudeSessionBadge sessions={claudeSessions} onOpenSession={onOpenSession} />
            <AdoBadge task={task} />
          </>
        )}
        </div>
        {showNoteLine && statusNote && !isEditing && (
          <button
            type="button"
            onClick={() => onSelect?.(task)}
            title={`${statusNote.text}

Click to open details`}
            className="min-w-0 text-left text-xs truncate text-zinc-500 dark:text-zinc-400 cursor-pointer"
          >
            {statusNote.text}
            <span className="text-zinc-400 dark:text-zinc-500"> · {formatRelativeTime(statusNote.at)}</span>
          </button>
        )}
        </div>

        <div className="ml-auto shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                setDraftTitle(task.title);
                setIsEditing(false);
              }}
              aria-label="Cancel editing"
              className={actionButtonClass}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label={`Edit "${task.title}"`}
              title="Rename title"
              className={actionButtonClass}
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          {isArchived ? (
            <button
              type="button"
              onClick={() => onRestore(task)}
              aria-label={`Restore "${task.title}"`}
              title="Restore from archive"
              className={actionButtonClass}
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onArchive(task)}
              aria-label={`Archive "${task.title}"`}
              title="Archive task"
              className={actionButtonClass}
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(task.id)}
            aria-label={`Delete "${task.title}"`}
            title="Delete task"
            className={`${actionButtonClass} hover:text-red-600! dark:hover:text-red-400!`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tags: plain text; removing tags happens in the task drawer */}
      <div className="flex items-center gap-1 min-w-0 max-[1200px]:hidden">
        {isAddingTag ? (
          <form onSubmit={handleAddTag} className="min-w-0">
            <input
              ref={tagInputRef}
              type="text"
              value={newTagText}
              onChange={(e) => setNewTagText(e.target.value)}
              onBlur={() => {
                setNewTagText('');
                setIsAddingTag(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
              placeholder="tag..."
              list="tag-suggestions"
              aria-label="New tag name"
              className="w-full text-xs px-1.5 py-0.5 rounded border border-primary-500 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </form>
        ) : (
          <>
            {task.tags.length > 0 && (
              <span className="min-w-0 truncate text-xs text-zinc-500 dark:text-zinc-400" title={task.tags.join(', ')}>
                {task.tags.join(' · ')}
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsAddingTag(true)}
              aria-label={`Add tag to "${task.title}"`}
              title="Add tag"
              className="shrink-0 p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {/* Project: dot + name over a native select */}
      {showProject && (
        <div className="relative flex items-center gap-2 min-w-0 max-[1000px]:hidden">
          <Dot color={project?.color} />
          <select
            aria-label={`Project for "${task.title}"`}
            value={task.projectId ?? ''}
            onChange={(e) => onUpdate(task.id, { projectId: e.target.value ? e.target.value : null })}
            className={`${cellSelectClass} ${project ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-400 dark:text-zinc-600'}`}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* On hold: reason and days held replace the due pill; the drawer has the details */}
      {task.status === 'on_hold' ? (
        <button
          type="button"
          onClick={() => onSelect?.(task)}
          aria-label={`On hold${task.holdReason ? `: ${task.holdReason}` : ''}, ${heldDays(task)} days`}
          title={`On hold for ${heldDays(task)}d${task.holdReason ? `: ${task.holdReason}` : ''}${
            task.dueDate ? ` · Due ${formatShortDate(task.dueDate)}` : ''
          }`}
          className={`flex max-w-full min-w-0 justify-self-start items-center gap-1 text-xs px-[7px] py-0.5 rounded-[5px] cursor-pointer ${
            needsChase(task, chaseHoldDays)
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
          }`}
        >
          <span className="truncate">{task.holdReason || 'On hold'}</span>
          <span className="shrink-0">· {heldDays(task)}d</span>
          {needsChase(task, chaseHoldDays) && <span className="shrink-0 font-semibold">· Chase?</span>}
        </button>
      ) : (
        <DatePopover
          value={task.dueDate}
          onChange={(dueDate) => onUpdate(task.id, { dueDate })}
          open={showDateMenu}
          onOpenChange={setShowDateMenu}
          className="relative min-w-0 justify-self-start"
          align="right"
          trigger={
            <button
              type="button"
              onClick={() => setShowDateMenu((v) => !v)}
              aria-label={`Due date for "${task.title}"`}
              title={dueInfo.state === 'overdue' && !isDone ? `Overdue · ${dueInfo.label}` : dueInfo.label}
              className={`max-w-full truncate text-xs px-[7px] py-0.5 rounded-[5px] cursor-pointer transition-colors duration-150 ${dueInfo.badgeClass}`}
            >
              {dueInfo.label}
            </button>
          }
        />
      )}

      {/* Priority: dot + label over a native select */}
      <div className="relative flex items-center gap-1.5 min-w-0">
        <span aria-hidden className={`shrink-0 w-1.5 h-1.5 rounded-full ${priorityInfo.dotClass}`} />
        <select
          aria-label={`Priority for "${task.title}"`}
          value={task.priority}
          onChange={(e) => onUpdate(task.id, { priority: Number(e.target.value) as TaskPriority })}
          className={`${cellSelectClass} ${priorityInfo.textClass}`}
        >
          {([0, 1, 2, 3, 4] as const).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_CONFIG[p].shortLabel === 'Med' ? 'Medium' : PRIORITY_CONFIG[p].shortLabel}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
