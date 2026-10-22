import React, { useState, useRef, useEffect } from 'react';
import {
  Check,
  Trash2,
  Pencil,
  X,
  Flag,
  Calendar,
  Folder,
  Tag,
  Plus,
  CheckSquare,
  AlignLeft,
  PanelRightOpen,
  Archive,
  ArchiveRestore,
  Repeat,
} from 'lucide-react';
import {
  Task,
  Project,
  TaskPriority,
  UpdateTaskInput,
} from '../../shared/types.ts';
import { describeRecurrence } from '../../shared/recurrence.ts';
import {
  PRIORITY_CONFIG,
  getDueDateInfo,
  getTodayIso,
  getTomorrowIso,
} from '../utils/taskUtils.ts';

interface TaskRowProps {
  task: Task;
  projects: Project[];
  isSelected?: boolean;
  onSelect?: (task: Task) => void;
  onToggle: (task: Task) => void;
  onUpdate: (id: string, payload: UpdateTaskInput) => void;
  onDelete: (id: string) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  /** Drag handle supplied by ReorderableTaskList when manual sorting is active. */
  dragHandle?: React.ReactNode;
  /** Inline title editing, controlled by App so the `e` shortcut can start it. */
  isEditing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Roving tabindex: exactly one row in the list is reachable with Tab. */
  isTabStop: boolean;
  onFocusRow: (taskId: string) => void;
}

export const TaskRow: React.FC<TaskRowProps> = ({
  task,
  projects,
  isSelected = false,
  onSelect,
  onToggle,
  onUpdate,
  onDelete,
  onArchive,
  onRestore,
  dragHandle,
  isEditing,
  onEditingChange: setIsEditing,
  isTabStop,
  onFocusRow,
}) => {
  const isArchived = task.status === 'archived';
  const isDone = task.status === 'done' || (isArchived && task.completedAt !== null);
  const [draftTitle, setDraftTitle] = useState(task.title);

  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagText, setNewTagText] = useState('');

  const [showDateMenu, setShowDateMenu] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const dateMenuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!showDateMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dateMenuRef.current && !dateMenuRef.current.contains(e.target as Node)) {
        setShowDateMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDateMenu]);

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
    const cleaned = newTagText.trim().replace(/^#/, '');
    if (cleaned && !task.tags.includes(cleaned)) {
      onUpdate(task.id, { tags: [...task.tags, cleaned] });
    }
    setNewTagText('');
    setIsAddingTag(false);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdate(task.id, { tags: task.tags.filter((t) => t !== tagToRemove) });
  };

  const priorityInfo = PRIORITY_CONFIG[task.priority];
  const dueInfo = getDueDateInfo(task.dueDate);
  const project = projects.find((p) => p.id === task.projectId);

  const subtasks = task.subtasks ?? [];
  const completedSubtasks = subtasks.filter((s) => s.isCompleted).length;
  const hasNotes = Boolean(task.description && task.description.trim().length > 0);

  return (
    <div
      data-testid={`task-row-${task.id}`}
      data-task-row={task.id}
      tabIndex={isTabStop ? 0 : -1}
      role="group"
      aria-label={`${task.title}${isDone ? ', completed' : ''}${isArchived ? ', archived' : ''}`}
      onFocus={() => onFocusRow(task.id)}
      className={`group outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-3.5 py-2.5 rounded-lg border transition-all duration-150 ${
        isSelected
          ? 'border-indigo-500 dark:border-indigo-500 ring-1 ring-indigo-500/20 bg-indigo-50/20 dark:bg-indigo-950/20'
          : isDone
          ? 'bg-zinc-100/60 dark:bg-zinc-900/40 border-zinc-200/60 dark:border-zinc-800/50 text-zinc-400 dark:text-zinc-500'
          : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 shadow-2xs'
      }`}
    >
      {/* Left: Checkbox + Title + Subtask/Note Badges + Tags */}
      <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
        {dragHandle}
        <button
          type="button"
          onClick={() => onToggle(task)}
          disabled={isArchived}
          aria-label={
            isArchived
              ? `"${task.title}" is archived`
              : isDone
              ? `Mark "${task.title}" as incomplete`
              : `Mark "${task.title}" as complete`
          }
          className={`mt-0.5 sm:mt-0 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60 ${
            isDone
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-500 dark:hover:border-indigo-400 bg-transparent'
          }`}
        >
          {isDone && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
        </button>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={handleSaveTitle}
              onKeyDown={handleTitleKeyDown}
              aria-label="Edit task title"
              className="w-full bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm px-2 py-0.5 rounded border border-indigo-500 focus:outline-none"
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelect?.(task)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className={`text-left text-sm truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors ${
                  isDone
                    ? 'line-through text-zinc-400 dark:text-zinc-500'
                    : 'text-zinc-800 dark:text-zinc-100 font-medium'
                }`}
                title="Click to open details, double-click to edit title"
              >
                {task.title}
              </button>

              {/* Subtasks Progress Badge */}
              {subtasks.length > 0 && (
                <button
                  type="button"
                  onClick={() => onSelect?.(task)}
                  aria-label={`Subtasks ${completedSubtasks} of ${subtasks.length}`}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-pointer ${
                    completedSubtasks === subtasks.length
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border-zinc-200/70 dark:border-zinc-700/70'
                  }`}
                >
                  <CheckSquare className="w-2.5 h-2.5" />
                  <span>
                    {completedSubtasks}/{subtasks.length}
                  </span>
                </button>
              )}

              {/* Notes Indicator */}
              {hasNotes && (
                <button
                  type="button"
                  onClick={() => onSelect?.(task)}
                  aria-label={`View notes for "${task.title}"`}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-indigo-600 cursor-pointer"
                  title="Has markdown notes"
                >
                  <AlignLeft className="w-2.5 h-2.5" />
                </button>
              )}

              {/* Repeat Indicator */}
              {task.recurrence && (
                <span
                  role="img"
                  aria-label={`Repeats: ${describeRecurrence(task.recurrence)}`}
                  title={describeRecurrence(task.recurrence)}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                >
                  <Repeat className="w-2.5 h-2.5" />
                </span>
              )}

              {/* Tag Pills */}
              {task.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200/70 dark:border-zinc-700/70"
                >
                  <Tag className="w-2.5 h-2.5 opacity-60" />
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="hover:text-red-500 cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}

              {/* Add Tag inline button / input */}
              {isAddingTag ? (
                <form onSubmit={handleAddTag} className="inline-flex items-center">
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
                    aria-label="New tag name"
                    className="w-20 text-[11px] px-1.5 py-0.5 rounded border border-indigo-500 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsAddingTag(true)}
                  aria-label={`Add tag to "${task.title}"`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-opacity cursor-pointer"
                  title="Add tag"
                >
                  <Plus className="w-2.5 h-2.5" />
                  <span>Tag</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Right: Metadata Controls & Row Actions */}
      <div className="flex items-center justify-end gap-1.5 flex-wrap sm:flex-nowrap pl-8 sm:pl-0">
        {/* Project Selector Badge */}
        {projects.length > 0 && (
          <div className="relative inline-flex items-center">
            {project && (
              <span
                className="w-2 h-2 rounded-full absolute left-2 pointer-events-none"
                style={{ backgroundColor: project.color }}
              />
            )}
            {!project && (
              <Folder className="w-3 h-3 text-zinc-400 absolute left-2 pointer-events-none" />
            )}
            <select
              aria-label={`Project for "${task.title}"`}
              value={task.projectId ?? ''}
              onChange={(e) =>
                onUpdate(task.id, { projectId: e.target.value ? e.target.value : null })
              }
              className={`text-xs rounded-md border py-1 pl-6 pr-2 appearance-none cursor-pointer transition-colors focus:outline-none focus:border-indigo-500 ${
                project
                  ? 'bg-zinc-50 dark:bg-zinc-800/90 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium'
                  : 'bg-transparent border-transparent text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 opacity-0 group-hover:opacity-100 focus:opacity-100'
              }`}
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

        {/* Due Date Selector */}
        <div className="relative" ref={dateMenuRef}>
          <button
            type="button"
            onClick={() => setShowDateMenu((v) => !v)}
            aria-label={`Due date for "${task.title}"`}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors cursor-pointer ${
              dueInfo.state === 'none'
                ? 'opacity-0 group-hover:opacity-100 focus:opacity-100 ' + dueInfo.badgeClass
                : dueInfo.badgeClass
            }`}
          >
            <Calendar className="w-3 h-3 flex-shrink-0" />
            <span>{dueInfo.label}</span>
          </button>

          {showDateMenu && (
            <div className="absolute right-0 mt-1 w-48 p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg z-20 space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 px-1">
                Due Date
              </div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    onUpdate(task.id, { dueDate: getTodayIso() });
                    setShowDateMenu(false);
                  }}
                  className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-zinc-700 dark:text-zinc-200 text-left cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdate(task.id, { dueDate: getTomorrowIso() });
                    setShowDateMenu(false);
                  }}
                  className="text-xs px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-zinc-700 dark:text-zinc-200 text-left cursor-pointer"
                >
                  Tomorrow
                </button>
              </div>
              <input
                type="date"
                aria-label="Custom due date"
                value={task.dueDate ?? ''}
                onChange={(e) => {
                  onUpdate(task.id, { dueDate: e.target.value || null });
                  setShowDateMenu(false);
                }}
                className="w-full text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
              />
              {task.dueDate && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdate(task.id, { dueDate: null });
                    setShowDateMenu(false);
                  }}
                  className="w-full text-xs px-2 py-1 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-center cursor-pointer"
                >
                  Clear date
                </button>
              )}
            </div>
          )}
        </div>

        {/* Priority Selector */}
        <div className="relative inline-flex items-center">
          <Flag className="w-3 h-3 absolute left-2 pointer-events-none opacity-75" />
          <select
            aria-label={`Priority for "${task.title}"`}
            value={task.priority}
            onChange={(e) =>
              onUpdate(task.id, { priority: Number(e.target.value) as TaskPriority })
            }
            className={`text-xs rounded-md border py-1 pl-6 pr-2 appearance-none cursor-pointer transition-colors focus:outline-none ${
              task.priority === 0
                ? 'opacity-0 group-hover:opacity-100 focus:opacity-100 bg-transparent border-transparent text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                : `${priorityInfo.badgeClass} font-medium`
            }`}
          >
            <option value={0}>No Priority</option>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
            <option value={4}>Urgent</option>
          </select>
        </div>

        {/* Inspect / Edit / Delete Buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => onSelect?.(task)}
            aria-label={`Open details for "${task.title}"`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            title="Open task details"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
          </button>

          {isEditing ? (
            <button
              type="button"
              onClick={() => {
                setDraftTitle(task.title);
                setIsEditing(false);
              }}
              aria-label="Cancel editing"
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              aria-label={`Edit "${task.title}"`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              title="Rename title"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}

          {isArchived ? (
            <button
              type="button"
              onClick={() => onRestore(task)}
              aria-label={`Restore "${task.title}"`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              title="Restore from archive"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onArchive(task)}
              aria-label={`Archive "${task.title}"`}
              className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              title="Archive task"
            >
              <Archive className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => onDelete(task.id)}
            aria-label={`Delete "${task.title}"`}
            className="p-1.5 rounded-md text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
