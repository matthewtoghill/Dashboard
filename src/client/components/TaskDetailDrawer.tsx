import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
  GripVertical,
  Plus,
  Trash2,
  Calendar,
  Flag,
  Folder,
  Tag,
  AlignLeft,
  CheckSquare,
  Clock,
  Eye,
  Edit3,
  Repeat,
  Bot,
  ExternalLink,
} from 'lucide-react';
import {
  Task,
  Project,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
  UpdateSubtaskInput,
  ClaudeSession,
} from '../../shared/types.ts';
import { formatDayDate, formatTimestamp, getTodayIso, cleanTag } from '../utils/taskUtils.ts';
import { Recurrence, describeRecurrence, nextOccurrence } from '../../shared/recurrence.ts';
import { toggleMarkdownCheckbox } from '../utils/markdown.ts';
import { MarkdownNotes } from './MarkdownNotes.tsx';
import { externalLinkLabel } from './AdoImport.tsx';
import { ClaudeSessionActions, ClaudeSessionItem } from './ClaudeSessions.tsx';

const REPEAT_PRESETS: { key: string; label: string; rule: Recurrence | null }[] = [
  { key: 'none', label: 'Does not repeat', rule: null },
  { key: 'daily', label: 'Daily', rule: { every: 1, unit: 'day', from: 'due' } },
  { key: 'weekdays', label: 'Every weekday', rule: { every: 1, unit: 'weekday', from: 'due' } },
  { key: 'weekly', label: 'Weekly', rule: { every: 1, unit: 'week', from: 'due' } },
  { key: 'monthly', label: 'Monthly', rule: { every: 1, unit: 'month', from: 'due' } },
];

const DRAWER_WIDTH_KEY = 'dashboard_drawer_width';
const DRAWER_MIN_WIDTH = 360;
const clampDrawerWidth = (w: number) =>
  Math.round(Math.min(Math.max(w, DRAWER_MIN_WIDTH), window.innerWidth - 80));

const presetKey = (rule: Recurrence | null) =>
  REPEAT_PRESETS.find(
    (p) =>
      p.rule === rule ||
      (p.rule &&
        rule &&
        p.rule.every === rule.every &&
        p.rule.unit === rule.unit &&
        p.rule.from === rule.from)
  )?.key ?? 'custom';

/** Repeat picker: common presets, or "Custom" for every N days/weeks/months/weekdays. */
const RecurrenceEditor: React.FC<{
  rule: Recurrence | null;
  dueDate: string | null;
  onChange: (rule: Recurrence | null) => void;
}> = ({ rule, dueDate, onChange }) => {
  const [customOpen, setCustomOpen] = useState(presetKey(rule) === 'custom');
  const [everyDraft, setEveryDraft] = useState(String(rule?.every ?? 2));
  const custom: Recurrence = rule ?? { every: 2, unit: 'week', from: 'due' };
  const selectClass =
    'text-xs px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none cursor-pointer';

  const commitEvery = () => {
    const every = Math.min(Math.max(Math.round(Number(everyDraft)) || 1, 1), 365);
    setEveryDraft(String(every));
    if (every !== custom.every) onChange({ ...custom, every });
  };

  return (
    <div className="space-y-2">
      <select
        aria-label="Repeat"
        value={customOpen ? 'custom' : presetKey(rule)}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustomOpen(true);
            setEveryDraft(String(custom.every));
            onChange(custom);
            return;
          }
          setCustomOpen(false);
          onChange(REPEAT_PRESETS.find((p) => p.key === e.target.value)!.rule);
        }}
        className={`w-full ${selectClass}`}
      >
        {REPEAT_PRESETS.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>

      {customOpen && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
          <span>Every</span>
          <input
            type="number"
            min={1}
            max={365}
            aria-label="Repeat interval"
            value={everyDraft}
            onChange={(e) => setEveryDraft(e.target.value)}
            onBlur={commitEvery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            className="w-14 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
          />
          <select
            aria-label="Repeat unit"
            value={custom.unit}
            onChange={(e) => onChange({ ...custom, unit: e.target.value as Recurrence['unit'] })}
            className={selectClass}
          >
            <option value="day">days</option>
            <option value="weekday">weekdays</option>
            <option value="week">weeks</option>
            <option value="month">months</option>
          </select>
          <span>from</span>
          <select
            aria-label="Repeat from"
            value={custom.from}
            onChange={(e) => onChange({ ...custom, from: e.target.value as Recurrence['from'] })}
            className={selectClass}
          >
            <option value="due">the due date</option>
            <option value="completion">completion</option>
          </select>
        </div>
      )}

      {rule && (
        <p className="text-[11px] text-zinc-400">
          {describeRecurrence(rule)}. Completing it today creates the next one, due{' '}
          {formatDayDate(nextOccurrence(rule, dueDate, getTodayIso()))}.
        </p>
      )}
    </div>
  );
};

interface TaskDetailDrawerProps {
  task: Task | null;
  projects: Project[];
  onClose: () => void;
  onUpdateTask: (id: string, payload: UpdateTaskInput) => void;
  onDeleteTask: (id: string) => void;
  onCreateSubtask: (taskId: string, title: string) => void;
  onUpdateSubtask: (subtaskId: string, input: UpdateSubtaskInput) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  /** Sessions linked to this task. */
  claudeSessions: ClaudeSession[];
  claudeSessionActions: ClaudeSessionActions;
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  projects,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onCreateSubtask,
  onUpdateSubtask,
  onDeleteSubtask,
  claudeSessions,
  claudeSessionActions,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPreviewingNotes, setIsPreviewingNotes] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [dragSubtaskId, setDragSubtaskId] = useState<string | null>(null);
  // Insertion point in the full list (0..subtasks.length), shown as a line
  const [subtaskDropIndex, setSubtaskDropIndex] = useState<number | null>(null);
  const [width, setWidth] = useState(
    () => Number(localStorage.getItem(DRAWER_WIDTH_KEY)) || 512
  );
  const asideRef = useRef<HTMLElement>(null);
  const isOpen = task !== null;

  // Move focus into the drawer on open and hand it back on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
  }, [task?.id, task?.title, task?.description]);

  // Open notes rendered when there are any, so links and checkboxes work straight away.
  useEffect(() => {
    setIsPreviewingNotes(Boolean(task?.description.trim()));
  }, [task?.id]);

  const saveWidth = (w: number) => localStorage.setItem(DRAWER_WIDTH_KEY, String(w));

  if (!task) return null;

  const subtasks = task.subtasks ?? [];
  const completedSubtasks = subtasks.filter((s) => s.isCompleted).length;
  const progressPercent =
    subtasks.length > 0 ? Math.round((completedSubtasks / subtasks.length) * 100) : 0;

  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      onUpdateTask(task.id, { title: trimmed });
    } else {
      setTitle(task.title);
    }
  };

  const handleDescriptionBlur = () => {
    if (description !== task.description) {
      onUpdateTask(task.id, { description });
    }
  };

  const handleToggleCheckbox = (line: number) => {
    const next = toggleMarkdownCheckbox(description, line);
    if (next === description) return;
    setDescription(next);
    onUpdateTask(task.id, { description: next });
  };

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    onCreateSubtask(task.id, trimmed);
    setNewSubtaskTitle('');
  };

  const saveSubtaskTitle = (id: string, current: string, value: string) => {
    setEditingSubtaskId(null);
    const trimmed = value.trim();
    if (trimmed && trimmed !== current) onUpdateSubtask(id, { title: trimmed });
  };

  const resetSubtaskDrag = () => {
    setDragSubtaskId(null);
    setSubtaskDropIndex(null);
  };

  const commitSubtaskDrop = () => {
    const from = subtasks.findIndex((s) => s.id === dragSubtaskId);
    if (from !== -1 && subtaskDropIndex !== null) {
      const target = subtaskDropIndex > from ? subtaskDropIndex - 1 : subtaskDropIndex;
      if (target !== from) {
        // Slot between the neighbours' sortOrder values (floats are fine; column is a plain number)
        const others = subtasks.filter((s) => s.id !== dragSubtaskId);
        const prev = others[target - 1]?.sortOrder;
        const next = others[target]?.sortOrder;
        const sortOrder =
          prev !== undefined && next !== undefined
            ? (prev + next) / 2
            : prev !== undefined
              ? prev + 1
              : next! - 1;
        onUpdateSubtask(subtasks[from].id, { sortOrder });
      }
    }
    resetSubtaskDrag();
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanTag(newTagInput);
    if (cleaned && !task.tags.includes(cleaned)) {
      onUpdateTask(task.id, { tags: [...task.tags, cleaned] });
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdateTask(task.id, {
      tags: task.tags.filter((t) => t !== tagToRemove),
    });
  };

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/25 dark:bg-black/50 backdrop-blur-[1px] transition-opacity"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Task details: ${task.title}`}
        tabIndex={-1}
        style={{ width }}
        className="relative focus:outline-none max-w-full bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Resize handle: drag, or focus and use Left/Right arrows */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize task details"
          aria-valuenow={width}
          aria-valuemin={DRAWER_MIN_WIDTH}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              setWidth(clampDrawerWidth(window.innerWidth - e.clientX));
            }
          }}
          onPointerUp={() => saveWidth(width)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const next = clampDrawerWidth(width + (e.key === 'ArrowLeft' ? 32 : -32));
            setWidth(next);
            saveWidth(next);
          }}
          className="absolute inset-y-0 left-0 w-1.5 z-10 cursor-col-resize touch-none focus:outline-none group/resize"
        >
          <div className="mx-auto h-full w-0.5 bg-transparent group-hover/resize:bg-indigo-500/60 group-focus-visible/resize:bg-indigo-500 group-active/resize:bg-indigo-500 transition-colors" />
        </div>

        {/* Drawer Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <select
              aria-label="Task status"
              value={task.status}
              onChange={(e) =>
                onUpdateTask(task.id, { status: e.target.value as TaskStatus })
              }
              className="text-xs font-medium px-2.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDeleteTask(task.id)}
              aria-label="Delete task from drawer"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
              title="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close task details"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Task Title */}
          <div>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              aria-label="Detail task title"
              className={`w-full text-lg font-semibold bg-transparent border-b border-transparent focus:border-indigo-500 pb-1 focus:outline-none ${
                task.status === 'done'
                  ? 'line-through text-zinc-400 dark:text-zinc-500'
                  : 'text-zinc-900 dark:text-zinc-100'
              }`}
            />
            {task.externalUrl && task.externalId && (
              <a
                href={task.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                {externalLinkLabel(task.externalId)}
              </a>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-800">
            {/* Repeat (full width) */}
            <div className="space-y-1 sm:col-span-3 sm:order-last">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Repeat className="w-3 h-3" />
                <span>Repeat</span>
              </label>
              <RecurrenceEditor
                key={task.id}
                rule={task.recurrence}
                dueDate={task.dueDate}
                onChange={(recurrence) => onUpdateTask(task.id, { recurrence })}
              />
            </div>

            {/* Priority */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Flag className="w-3 h-3" />
                <span>Priority</span>
              </label>
              <select
                aria-label="Detail task priority"
                value={task.priority}
                onChange={(e) =>
                  onUpdateTask(task.id, {
                    priority: Number(e.target.value) as TaskPriority,
                  })
                }
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none cursor-pointer"
              >
                <option value={0}>No Priority</option>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
                <option value={4}>Urgent</option>
              </select>
            </div>

            {/* Project */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Folder className="w-3 h-3" />
                <span>Project</span>
              </label>
              <select
                aria-label="Detail task project"
                value={task.projectId ?? ''}
                onChange={(e) =>
                  onUpdateTask(task.id, {
                    projectId: e.target.value ? e.target.value : null,
                  })
                }
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none cursor-pointer"
              >
                <option value="">No Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Due Date */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <Calendar className="w-3 h-3" />
                <span>Due Date</span>
              </label>
              <input
                type="date"
                aria-label="Detail task due date"
                value={task.dueDate ?? ''}
                onChange={(e) =>
                  onUpdateTask(task.id, { dueDate: e.target.value || null })
                }
                className="w-full text-xs px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none cursor-pointer"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Tag className="w-3.5 h-3.5" />
              <span>Tags</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70"
                >
                  <span>#{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag} in drawer`}
                    className="hover:text-red-500 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <form onSubmit={handleAddTag} className="inline-flex items-center">
                <input
                  type="text"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  placeholder="+ Add tag"
                  list="tag-suggestions"
                  aria-label="Add tag in drawer"
                  className="text-xs px-2.5 py-1 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 w-24"
                />
              </form>
            </div>
          </div>

          {/* Subtasks / Checklist Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <CheckSquare className="w-3.5 h-3.5" />
                <span>
                  Subtasks ({completedSubtasks}/{subtasks.length})
                </span>
              </label>
              {subtasks.length > 0 && (
                <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  {progressPercent}%
                </span>
              )}
            </div>

            {subtasks.length > 0 && (
              <div className="w-full h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-600 transition-all duration-200"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            {/* Subtask List */}
            <div
              className="space-y-1.5"
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setSubtaskDropIndex(null);
                }
              }}
            >
              {subtasks.map((sub, index) => (
                <div
                  key={sub.id}
                  onDragOver={(e) => {
                    if (dragSubtaskId === null) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setSubtaskDropIndex(e.clientY > rect.top + rect.height / 2 ? index + 1 : index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    commitSubtaskDrop();
                  }}
                  className={`group relative flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30 ${
                    dragSubtaskId === sub.id ? 'opacity-40' : ''
                  }`}
                >
                  {subtaskDropIndex === index && <SubtaskDropLine position="top" />}
                  {subtaskDropIndex === subtasks.length && index === subtasks.length - 1 && (
                    <SubtaskDropLine position="bottom" />
                  )}
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', sub.id);
                      const row = e.currentTarget.parentElement;
                      if (row) e.dataTransfer.setDragImage(row, 16, 16);
                      setDragSubtaskId(sub.id);
                    }}
                    onDragEnd={resetSubtaskDrag}
                    aria-label={`Reorder subtask "${sub.title}" (drag)`}
                    title="Drag to reorder"
                    className="-ml-1.5 p-0.5 rounded text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing flex-shrink-0"
                  >
                    <GripVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSubtask(sub.id, { isCompleted: !sub.isCompleted })}
                    aria-label={
                      sub.isCompleted
                        ? `Mark subtask "${sub.title}" incomplete`
                        : `Mark subtask "${sub.title}" complete`
                    }
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${
                      sub.isCompleted
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-500'
                    }`}
                  >
                    {sub.isCompleted && <Check className="w-3 h-3 stroke-[2.5]" />}
                  </button>
                  {editingSubtaskId === sub.id ? (
                    <input
                      autoFocus
                      defaultValue={sub.title}
                      aria-label={`Edit subtask "${sub.title}"`}
                      onBlur={(e) => saveSubtaskTitle(sub.id, sub.title, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          e.currentTarget.value = sub.title; // revert so the blur save is a no-op
                          setEditingSubtaskId(null);
                        }
                      }}
                      className="flex-1 min-w-0 text-xs sm:text-sm bg-transparent border-b border-indigo-500 outline-none text-zinc-800 dark:text-zinc-200"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingSubtaskId(sub.id)}
                      title="Click to edit"
                      className={`flex-1 min-w-0 text-left text-xs sm:text-sm truncate cursor-text ${
                        sub.isCompleted
                          ? 'line-through text-zinc-400 dark:text-zinc-500'
                          : 'text-zinc-800 dark:text-zinc-200'
                      }`}
                    >
                      {sub.title}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteSubtask(sub.id)}
                    aria-label={`Delete subtask "${sub.title}"`}
                    className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-opacity cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Subtask Input */}
            <form onSubmit={handleAddSubtask} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Plus className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={newSubtaskTitle}
                  onChange={(e) => setNewSubtaskTitle(e.target.value)}
                  placeholder="Add a subtask..."
                  aria-label="New subtask title"
                  className="w-full pl-8 pr-3 py-1.5 text-xs sm:text-sm rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              {newSubtaskTitle.trim() && (
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                >
                  Add
                </button>
              )}
            </form>
          </div>

          {claudeSessions.length > 0 && (
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Bot className="w-3.5 h-3.5" />
                <span>Claude sessions</span>
              </label>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {claudeSessions.map((s) => (
                  <ClaudeSessionItem key={s.sessionId} session={s} {...claudeSessionActions} />
                ))}
              </ul>
            </div>
          )}

          {/* Markdown Notes / Description Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <AlignLeft className="w-3.5 h-3.5" />
                <span>Notes (Markdown)</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!isPreviewingNotes) handleDescriptionBlur();
                  setIsPreviewingNotes((v) => !v);
                }}
                className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                {isPreviewingNotes ? (
                  <>
                    <Edit3 className="w-3 h-3" />
                    <span>Edit</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3 h-3" />
                    <span>Preview</span>
                  </>
                )}
              </button>
            </div>

            {isPreviewingNotes ? (
              <div
                onClick={(e) => {
                  // Links and checkboxes act on their own; clicking anywhere else edits.
                  if (!(e.target as HTMLElement).closest('a, input')) setIsPreviewingNotes(false);
                }}
                className="min-h-[120px] p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 cursor-text"
              >
                {description.trim() ? (
                  <MarkdownNotes text={description} onToggleCheckbox={handleToggleCheckbox} />
                ) : (
                  <p className="text-zinc-400 dark:text-zinc-500 italic text-xs">
                    No description provided. Click Edit to add markdown notes.
                  </p>
                )}
              </div>
            ) : (
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={handleDescriptionBlur}
                placeholder="Write notes, links, or markdown lists..."
                aria-label="Task notes"
                className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 resize-y"
              />
            )}
          </div>
        </div>

        {/* Drawer Footer: Activity Timestamps */}
        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 text-[11px] text-zinc-400 dark:text-zinc-500 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Created {formatTimestamp(task.createdAt)}
          </span>
          {task.completedAt ? (
            <span>Completed {formatTimestamp(task.completedAt)}</span>
          ) : (
            <span>Updated {formatTimestamp(task.updatedAt)}</span>
          )}
        </div>
      </aside>
    </div>
  );
};

const SubtaskDropLine: React.FC<{ position: 'top' | 'bottom' }> = ({ position }) => (
  <div
    aria-hidden
    className={`absolute inset-x-0 h-0.5 rounded-full bg-indigo-500 pointer-events-none ${
      position === 'top' ? '-top-1' : '-bottom-1'
    }`}
  />
);
