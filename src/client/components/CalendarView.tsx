import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Repeat } from 'lucide-react';
import { Project, Task } from '../../shared/types.ts';
import { addDays, parseIsoDate, toIsoDate } from '../../shared/dates.ts';
import {
  CalendarEntry,
  CalendarLayout,
  WeekStartDay,
  calendarDays,
  calendarEntries,
  calendarTitle,
  shiftAnchor,
} from '../utils/calendar.ts';
import { formatDayDate } from '../utils/taskUtils.ts';

interface CalendarViewProps {
  /** Already filtered by the current view. */
  tasks: Task[];
  projects: Project[];
  layout: CalendarLayout;
  weekStart: WeekStartDay;
  today: string;
  showCompleted: boolean;
  onToggleShowCompleted: () => void;
  onOpenTask: (taskId: string) => void;
  onReschedule: (task: Task, dueDate: string) => void;
  /** Creates a task from quick-add text, due `dueDate` unless the text says otherwise. */
  onQuickAdd: (text: string, dueDate: string) => void;
}

const navButtonClass =
  'p-1.5 rounded-lg text-zinc-600 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer';

/** Month or week grid of tasks by due date. Drag (or Alt+Arrows) moves a task to another day. */
export const CalendarView: React.FC<CalendarViewProps> = ({
  tasks,
  projects,
  layout,
  weekStart,
  today,
  showCompleted,
  onToggleShowCompleted,
  onOpenTask,
  onReschedule,
  onQuickAdd,
}) => {
  const [anchor, setAnchor] = useState(today);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropDay, setDropDay] = useState<string | null>(null);
  const [addingDay, setAddingDay] = useState<string | null>(null);
  const [addText, setAddText] = useState('');
  // A task moved by keyboard remounts in its new day; focus follows it there
  const [refocus, setRefocus] = useState<{ id: string; day: string } | null>(null);

  const days = useMemo(() => calendarDays(layout, anchor, weekStart), [layout, anchor, weekStart]);
  const entries = useMemo(() => calendarEntries(tasks, days, showCompleted), [tasks, days, showCompleted]);
  const month = parseIsoDate(anchor).getMonth();

  // The optimistic update lands a tick after the move, so wait until the task is on its new day
  useEffect(() => {
    if (!refocus) return;
    const chip = document.querySelector<HTMLElement>(
      `[data-calendar-day="${refocus.day}"] [data-calendar-task="${CSS.escape(refocus.id)}"]`
    );
    if (!chip) return;
    chip.focus();
    setRefocus(null);
  }, [entries, refocus]);

  const moveTo = (task: Task, day: string) => {
    if (task.dueDate !== day) onReschedule(task, day);
  };

  const moveByKeyboard = (e: React.KeyboardEvent, task: Task) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!e.altKey || !step || !task.dueDate) return;
    e.preventDefault();
    const day = toIsoDate(addDays(parseIsoDate(task.dueDate), step));
    if (!days.includes(day)) setAnchor(day);
    setRefocus({ id: task.id, day });
    moveTo(task, day);
  };

  const submitAdd = (day: string) => {
    if (addText.trim()) onQuickAdd(addText.trim(), day);
    setAddText('');
    setAddingDay(null);
  };

  const renderEntry = ({ task, ghost }: CalendarEntry, day: string) => {
    const color = projects.find((p) => p.id === task.projectId)?.color ?? '#a1a1aa';
    const done = task.status === 'done';
    const overdue = !done && !ghost && day < today;
    const label = ghost ? `${task.title} (repeats ${formatDayDate(day)})` : task.title;
    return (
      <button
        key={ghost ? `${task.id}:${day}` : task.id}
        type="button"
        data-calendar-task={ghost ? undefined : task.id}
        data-menu-task={task.id}
        data-menu-ghost={ghost || undefined}
        draggable={!ghost}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', task.id);
          setDragId(task.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropDay(null);
        }}
        onKeyDown={ghost ? undefined : (e) => moveByKeyboard(e, task)}
        onClick={(e) => {
          e.stopPropagation();
          onOpenTask(task.id);
        }}
        title={ghost ? `${label}, a future occurrence` : `${label} (drag, or Alt+Arrows to move)`}
        style={{ borderLeftColor: color }}
        className={`w-full flex items-center gap-1 text-left text-xs px-1.5 py-0.5 rounded border-l-[3px] cursor-pointer truncate ${
          ghost
            ? 'border border-dashed border-zinc-300 dark:border-zinc-600 opacity-70 text-zinc-500 dark:text-zinc-400'
            : overdue
            ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700'
        } ${done ? 'line-through opacity-60' : ''} ${dragId === task.id && !ghost ? 'opacity-40' : ''}`}
      >
        {ghost && <Repeat className="w-3 h-3 flex-shrink-0" aria-hidden />}
        <span className="truncate">{task.title}</span>
        {ghost && <span className="sr-only">, future occurrence</span>}
        {overdue && <span className="sr-only">, overdue</span>}
      </button>
    );
  };

  return (
    <section className="space-y-3" aria-label="Calendar">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchor(shiftAnchor(layout, anchor, -1))}
            aria-label={`Previous ${layout}`}
            className={navButtonClass}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor(today)}
            className="px-2.5 py-1 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 cursor-pointer"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setAnchor(shiftAnchor(layout, anchor, 1))}
            aria-label={`Next ${layout}`}
            className={navButtonClass}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h3 className="text-sm font-semibold" aria-live="polite">
            {calendarTitle(layout, days, anchor)}
          </h3>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={showCompleted} onChange={onToggleShowCompleted} />
          Show completed
        </label>
      </div>

      <div className="grid grid-cols-7 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden bg-zinc-200 dark:bg-zinc-800 gap-px">
        {days.slice(0, 7).map((day) => (
          <div
            key={`head-${day}`}
            className="bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
          >
            {parseIsoDate(day).toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
        ))}

        {days.map((day) => {
          const date = parseIsoDate(day);
          const outside = layout === 'month' && date.getMonth() !== month;
          const dayEntries = entries.get(day) ?? [];
          return (
            <div
              key={day}
              data-calendar-day={day}
              onClick={() => setAddingDay(day)}
              onDragOver={(e) => {
                if (dragId === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropDay(day);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const task = tasks.find((t) => t.id === dragId);
                if (task) moveTo(task, day);
                setDragId(null);
                setDropDay(null);
              }}
              className={`group flex flex-col gap-1 p-1.5 cursor-pointer ${
                layout === 'week' ? 'min-h-96' : 'min-h-28'
              } ${
                dropDay === day
                  ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-2 ring-inset ring-indigo-500'
                  : outside
                  ? 'bg-zinc-50 dark:bg-zinc-950'
                  : 'bg-white dark:bg-zinc-900'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs w-6 h-6 inline-flex items-center justify-center rounded-full ${
                    day === today
                      ? 'bg-indigo-600 text-white font-semibold'
                      : outside
                      ? 'text-zinc-400 dark:text-zinc-600'
                      : 'text-zinc-600 dark:text-zinc-300'
                  }`}
                >
                  {date.getDate()}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingDay(day);
                  }}
                  aria-label={`Add task on ${formatDayDate(day)}`}
                  className="p-0.5 rounded text-zinc-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-indigo-600 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className={`space-y-1 ${layout === 'month' ? 'max-h-40 overflow-y-auto' : ''}`}>
                {dayEntries.map((entry) => renderEntry(entry, day))}
              </div>

              {addingDay === day && (
                <input
                  autoFocus
                  value={addText}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitAdd(day);
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setAddText('');
                      setAddingDay(null);
                    }
                  }}
                  onBlur={() => submitAdd(day)}
                  placeholder="New task..."
                  aria-label={`New task due ${formatDayDate(day)}`}
                  className="w-full text-xs px-1.5 py-1 rounded border border-indigo-400 bg-white dark:bg-zinc-900 focus:outline-none"
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
