import React, { useEffect, useState } from 'react';
import { Calendar, Flag, Folder, Plus, Repeat, Tag, X } from 'lucide-react';
import { CreateTaskInput, Project, TaskPriority } from '../../shared/types.ts';
import { describeRecurrence } from '../../shared/recurrence.ts';
import { ActiveNavigation } from '../utils/taskView.ts';
import { DateInput } from './DatePicker.tsx';
import {
  PRIORITY_CONFIG,
  cleanTag,
  formatDayDate,
  getTodayIso,
  parseQuickAddSyntax,
} from '../utils/taskUtils.ts';

const pickerClass =
  'inline-flex items-center gap-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1';
const pickerFieldClass = 'bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none cursor-pointer';

/** Quick-add bar: a title with inline syntax (!high #tag @fri ~weekly) plus metadata pickers. */
export const QuickAddBar: React.FC<{
  projects: Project[];
  activeNav: ActiveNavigation;
  /** Owned by the caller, which also uses it for calendar quick-add. */
  projectId: string;
  onProjectIdChange: (id: string) => void;
  onCreate: (input: CreateTaskInput) => void;
  isCreating: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}> = ({
  projects,
  activeNav,
  projectId: newProjectId,
  onProjectIdChange: setNewProjectId,
  onCreate,
  isCreating,
  inputRef,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>(0);
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [newTags, setNewTags] = useState<string[]>([]);

  // The due date default follows the current view, and resets when leaving it
  useEffect(() => {
    setNewDueDate(activeNav.type === 'smart' && activeNav.id === 'today' ? getTodayIso() : '');
  }, [activeNav]);

  const handleAddQuickTag = () => {
    const cleaned = cleanTag(newTagInput);
    if (cleaned && !newTags.includes(cleaned)) {
      setNewTags((prev) => [...prev, cleaned]);
    }
    setNewTagInput('');
  };

  /** What the quick-add bar would create: typed tokens applied on top of the pickers. */
  const parseNewTask = (rawTitle: string) => {
    const pendingTag = cleanTag(newTagInput);
    const baseTags =
      pendingTag && !newTags.includes(pendingTag) ? [...newTags, pendingTag] : newTags;
    return parseQuickAddSyntax(rawTitle.trim(), projects, {
      priority: newPriority,
      projectId: newProjectId || null,
      dueDate: newDueDate || null,
      tags: baseTags,
    });
  };
  const newTaskPreview = newTitle.trim() ? parseNewTask(newTitle) : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const parsed = parseNewTask(newTitle);

    onCreate({
      title: parsed.title,
      priority: parsed.priority,
      projectId: parsed.projectId,
      dueDate: parsed.dueDate,
      tags: parsed.tags,
      recurrence: parsed.recurrence,
    });

    setNewTitle('');
    setNewTagInput('');
    setNewTags([]);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs focus-within:border-indigo-500 dark:focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/15 transition-all"
    >
      <div className="flex items-center">
        <div className="pl-3.5 pr-2 text-zinc-400">
          <Plus className="w-5 h-5" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add a task... e.g. Call Sam !high #work @fri ~weekly (Shortcut: N)"
          aria-label="New task title"
          className="w-full py-3 pr-4 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
        />
        {newTitle.trim() && (
          <div className="pr-2.5">
            <button
              type="submit"
              disabled={isCreating}
              className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Live preview of what the typed syntax resolves to */}
      {newTaskPreview && (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 pb-2.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>Creates</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-xs">
            {newTaskPreview.title}
          </span>
          {newTaskPreview.dueDate && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
              <Calendar className="w-3 h-3" />
              Due {formatDayDate(newTaskPreview.dueDate)}
            </span>
          )}
          {newTaskPreview.priority > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-md border ${PRIORITY_CONFIG[newTaskPreview.priority].badgeClass}`}
            >
              {PRIORITY_CONFIG[newTaskPreview.priority].label}
            </span>
          )}
          {newTaskPreview.projectId && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: projects.find(
                    (p) => p.id === newTaskPreview.projectId
                  )?.color,
                }}
              />
              {projects.find((p) => p.id === newTaskPreview.projectId)?.name}
            </span>
          )}
          {newTaskPreview.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300"
            >
              #{tag}
            </span>
          ))}
          {newTaskPreview.recurrence && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-zinc-200 dark:border-zinc-700">
              <Repeat className="w-3 h-3" />
              {describeRecurrence(newTaskPreview.recurrence)}
            </span>
          )}
        </div>
      )}

      {/* Quick-add Metadata Bar */}
      <div className="flex items-center flex-wrap gap-2 px-3.5 py-2 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 rounded-b-xl text-xs">
        {/* Priority Picker */}
        <div className={pickerClass}>
          <Flag className="w-3 h-3 text-zinc-400" />
          <select
            aria-label="New task priority"
            value={newPriority}
            onChange={(e) =>
              setNewPriority(Number(e.target.value) as TaskPriority)
            }
            className={pickerFieldClass}
          >
            <option value={0}>No Priority</option>
            <option value={1}>Low</option>
            <option value={2}>Medium</option>
            <option value={3}>High</option>
            <option value={4}>Urgent</option>
          </select>
        </div>

        {/* Project Picker */}
        <div className={pickerClass}>
          <Folder className="w-3 h-3 text-zinc-400" />
          <select
            aria-label="New task project"
            value={newProjectId}
            onChange={(e) => setNewProjectId(e.target.value)}
            className={pickerFieldClass}
          >
            <option value="">No Project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Due Date Picker */}
        <div className={pickerClass}>
          <Calendar className="w-3 h-3 text-zinc-400" />
          <DateInput
            value={newDueDate || null}
            onChange={(date) => setNewDueDate(date ?? '')}
            ariaLabel="New task due date"
            className={pickerFieldClass}
            clearable
          />
        </div>

        {/* Tag Input */}
        <div className={pickerClass}>
          <Tag className="w-3 h-3 text-zinc-400" />
          <input
            type="text"
            value={newTagInput}
            onChange={(e) => setNewTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                handleAddQuickTag();
              }
            }}
            placeholder="Add tag..."
            list="tag-suggestions"
            aria-label="New task tag"
            className="w-20 bg-transparent text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none"
          />
        </div>

        {/* Added Tags Preview */}
        {newTags.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
          >
            <span>#{t}</span>
            <button
              type="button"
              onClick={() =>
                setNewTags((prev) => prev.filter((item) => item !== t))
              }
              className="hover:text-red-500 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
    </form>
  );
};
