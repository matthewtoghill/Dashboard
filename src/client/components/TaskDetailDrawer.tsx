import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Check,
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
} from 'lucide-react';
import {
  Task,
  Project,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput,
} from '../../shared/types.ts';
import { formatTimestamp } from '../utils/taskUtils.ts';

interface TaskDetailDrawerProps {
  task: Task | null;
  projects: Project[];
  onClose: () => void;
  onUpdateTask: (id: string, payload: UpdateTaskInput) => void;
  onDeleteTask: (id: string) => void;
  onCreateSubtask: (taskId: string, title: string) => void;
  onToggleSubtask: (subtaskId: string, isCompleted: boolean) => void;
  onDeleteSubtask: (subtaskId: string) => void;
}

/**
 * Simple lightweight Markdown renderer for task notes preview.
 */
function renderMarkdownPreview(text: string): React.ReactNode {
  if (!text.trim()) {
    return (
      <p className="text-zinc-400 dark:text-zinc-500 italic text-xs">
        No description provided. Click Edit to add markdown notes.
      </p>
    );
  }

  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-sm text-zinc-700 dark:text-zinc-200 leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={idx} className="h-2" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 pt-1">
              {trimmed.slice(4)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h3 key={idx} className="font-bold text-base text-zinc-900 dark:text-zinc-100 pt-1">
              {trimmed.slice(3)}
            </h3>
          );
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h2 key={idx} className="font-bold text-lg text-zinc-900 dark:text-zinc-100 pt-1">
              {trimmed.slice(2)}
            </h2>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2">
              <span className="text-indigo-500 mt-1">•</span>
              <span>{trimmed.slice(2)}</span>
            </div>
          );
        }
        return <p key={idx}>{line}</p>;
      })}
    </div>
  );
}

export const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  projects,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onCreateSubtask,
  onToggleSubtask,
  onDeleteSubtask,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPreviewingNotes, setIsPreviewingNotes] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newTagInput, setNewTagInput] = useState('');
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

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    onCreateSubtask(task.id, trimmed);
    setNewSubtaskTitle('');
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = newTagInput.trim().replace(/^#/, '');
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
        className="focus:outline-none w-full max-w-lg bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden"
      >
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
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-800">
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
            <div className="space-y-1.5">
              {subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="group flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/30"
                >
                  <button
                    type="button"
                    onClick={() => onToggleSubtask(sub.id, !sub.isCompleted)}
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
                  <span
                    className={`flex-1 text-xs sm:text-sm truncate ${
                      sub.isCompleted
                        ? 'line-through text-zinc-400 dark:text-zinc-500'
                        : 'text-zinc-800 dark:text-zinc-200'
                    }`}
                  >
                    {sub.title}
                  </span>
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
                onClick={() => setIsPreviewingNotes(false)}
                className="min-h-[120px] p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 cursor-text"
              >
                {renderMarkdownPreview(description)}
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
