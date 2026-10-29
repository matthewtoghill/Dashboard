import React, { useEffect, useState } from 'react';
import { Calendar, Flag, Folder, Plus, Repeat, Tag, X } from 'lucide-react';
import { CreateTaskInput, Project, TaskPriority } from '../../shared/types.ts';
import { describeRecurrence } from '../../shared/recurrence.ts';
import { ActiveNavigation } from '../utils/taskView.ts';
import { DatePopover } from './DatePicker.tsx';
import { BADGE_CLASS, Dot, KBD_CLASS, NEUTRAL_BADGE_CLASS } from './ui.tsx';
import {
  PRIORITY_CONFIG,
  cleanTag,
  formatDayDate,
  getTodayIso,
  parseQuickAddSyntax,
  sourceKind,
} from '../utils/taskUtils.ts';
import { SOURCE_ICONS } from './TaskRow.tsx';

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
  const [dateOpen, setDateOpen] = useState(false);
  const [tagInputOpen, setTagInputOpen] = useState(false);

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
      sourceUrls: parsed.sourceUrls,
    });

    setNewTitle('');
    setNewTagInput('');
    setNewTags([]);
  };

  const isProjectView = activeNav.type === 'project';
  const viewProject = isProjectView ? projects.find((p) => p.id === activeNav.id) : undefined;
  const pickedProject = projects.find((p) => p.id === newProjectId);
  const pickerButtonClass = (active: boolean) =>
    `relative p-[5px] rounded-md transition-colors duration-150 cursor-pointer ${
      active ? 'text-primary-600 dark:text-primary-400' : 'text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
    }`;
  // A native select laid invisibly over an icon, so the icon opens the usual picker
  const overlaySelectClass = 'absolute inset-0 opacity-0 cursor-pointer';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="h-10 px-3 flex items-center gap-2.5 rounded-[10px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus-within:border-primary-500/60 focus-within:ring-2 focus-within:ring-primary-500/15 text-[13px] transition-colors duration-150">
        <Plus className="w-4 h-4 shrink-0 text-primary-500 dark:text-primary-400" />
        <div className="relative flex-1 min-w-0 flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label="New task title"
            className="w-full bg-transparent text-zinc-900 dark:text-zinc-100 focus:outline-none"
          />
          {!newTitle && (
            <span aria-hidden className="absolute inset-0 flex items-center gap-1.5 pointer-events-none truncate">
              <span className="text-zinc-500">{viewProject ? `Add to ${viewProject.name}…` : 'Add a task…'}</span>
              <span className="text-zinc-400 dark:text-zinc-600">
                {viewProject ? '!high #backend @fri' : 'e.g. Call Sam !high #work @fri ~weekly'}
              </span>
            </span>
          )}
        </div>

        {/* Pickers: priority, project (not in project views), due date, tag */}
        <div className="flex items-center gap-0.5 shrink-0">
          <span className={pickerButtonClass(newPriority > 0)} title={`Priority: ${PRIORITY_CONFIG[newPriority].label}`}>
            <Flag className="w-3.5 h-3.5" />
            <select
              aria-label="New task priority"
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value) as TaskPriority)}
              className={overlaySelectClass}
            >
              <option value={0}>No Priority</option>
              <option value={1}>Low</option>
              <option value={2}>Medium</option>
              <option value={3}>High</option>
              <option value={4}>Urgent</option>
            </select>
          </span>

          {!isProjectView && (
            <span
              className={pickerButtonClass(Boolean(pickedProject))}
              title={`Project: ${pickedProject?.name ?? 'None'}`}
            >
              <Folder className="w-3.5 h-3.5" />
              {pickedProject && (
                <span
                  aria-hidden
                  className="absolute right-0.5 bottom-0.5 w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: pickedProject.color }}
                />
              )}
              <select
                aria-label="New task project"
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className={overlaySelectClass}
              >
                <option value="">No Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          )}

          <DatePopover
            value={newDueDate || null}
            onChange={(date) => setNewDueDate(date ?? '')}
            open={dateOpen}
            onOpenChange={setDateOpen}
            align="right"
            trigger={
              <button
                type="button"
                onClick={() => setDateOpen((v) => !v)}
                aria-label="New task due date"
                aria-haspopup="dialog"
                aria-expanded={dateOpen}
                title={newDueDate ? `Due ${formatDayDate(newDueDate)}` : 'Due date'}
                className={pickerButtonClass(Boolean(newDueDate))}
              >
                <Calendar className="w-3.5 h-3.5" />
              </button>
            }
          />

          {tagInputOpen ? (
            <input
              type="text"
              autoFocus
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  handleAddQuickTag();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTagInputOpen(false);
                }
              }}
              onBlur={() => {
                handleAddQuickTag();
                setTagInputOpen(false);
              }}
              placeholder="tag"
              list="tag-suggestions"
              aria-label="New task tag"
              className="w-20 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent text-xs text-zinc-800 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-primary-500"
            />
          ) : (
            <button
              type="button"
              onClick={() => setTagInputOpen(true)}
              aria-label="Add tag to new task"
              title="Tag"
              className={pickerButtonClass(newTags.length > 0)}
            >
              <Tag className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {newTitle.trim() ? (
          <button
            type="submit"
            disabled={isCreating}
            className="shrink-0 px-2.5 py-1 rounded-md bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50"
          >
            Add
          </button>
        ) : (
          <kbd className={KBD_CLASS} title="Shortcut: N">
            N
          </kbd>
        )}
      </div>

      {/* Live preview of what the typed syntax resolves to */}
      {newTaskPreview ? (
        <div className="flex flex-wrap items-center gap-1.5 px-3 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>Creates</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-200 truncate max-w-xs">{newTaskPreview.title}</span>
          {newTaskPreview.dueDate && (
            <span className={NEUTRAL_BADGE_CLASS}>
              <Calendar className="w-[11px] h-[11px]" />
              Due {formatDayDate(newTaskPreview.dueDate)}
            </span>
          )}
          {newTaskPreview.priority > 0 && (
            <span className={`${NEUTRAL_BADGE_CLASS} ${PRIORITY_CONFIG[newTaskPreview.priority].textClass}`}>
              {PRIORITY_CONFIG[newTaskPreview.priority].label}
            </span>
          )}
          {newTaskPreview.projectId && (
            <span className={NEUTRAL_BADGE_CLASS}>
              <Dot color={projects.find((p) => p.id === newTaskPreview.projectId)?.color} size={6} />
              {projects.find((p) => p.id === newTaskPreview.projectId)?.name}
            </span>
          )}
          {newTaskPreview.tags.map((tag) => (
            <span key={tag} className={`${BADGE_CLASS} bg-primary-500/10 text-primary-700 dark:text-primary-300`}>
              #{tag}
            </span>
          ))}
          {newTaskPreview.recurrence && (
            <span className={NEUTRAL_BADGE_CLASS}>
              <Repeat className="w-[11px] h-[11px]" />
              {describeRecurrence(newTaskPreview.recurrence)}
            </span>
          )}
          {newTaskPreview.sourceUrls.map((url) => {
            const Icon = SOURCE_ICONS[sourceKind(url)];
            return (
              <span key={url} title={url} className={NEUTRAL_BADGE_CLASS}>
                <Icon className="w-[11px] h-[11px]" />
                {sourceKind(url)}
              </span>
            );
          })}
        </div>
      ) : (
        (newPriority > 0 || newDueDate || newTags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            {newPriority > 0 && (
              <PickedChip label="Clear priority" onClear={() => setNewPriority(0)}>
                <span className={PRIORITY_CONFIG[newPriority].textClass}>{PRIORITY_CONFIG[newPriority].label}</span>
              </PickedChip>
            )}
            {newDueDate && (
              <PickedChip label="Clear due date" onClear={() => setNewDueDate('')}>
                Due {formatDayDate(newDueDate)}
              </PickedChip>
            )}
            {newTags.map((t) => (
              <PickedChip key={t} label={`Remove tag ${t}`} onClear={() => setNewTags((prev) => prev.filter((item) => item !== t))}>
                #{t}
              </PickedChip>
            ))}
          </div>
        )
      )}
    </form>
  );
};

/** A picker value under the quick-add bar, with an X that clears it. */
const PickedChip: React.FC<{ label: string; onClear: () => void; children: React.ReactNode }> = ({
  label,
  onClear,
  children,
}) => (
  <span className={NEUTRAL_BADGE_CLASS}>
    {children}
    <button type="button" onClick={onClear} aria-label={label} className="hover:text-red-500 cursor-pointer">
      <X className="w-[11px] h-[11px]" />
    </button>
  </span>
);
