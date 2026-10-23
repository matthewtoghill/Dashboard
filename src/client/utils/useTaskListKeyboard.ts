import { useEffect, useRef, useState } from 'react';
import { Task, TaskPriority, UpdateTaskInput } from '../../shared/types.ts';
import { isTextInput } from './useGlobalShortcuts.ts';

interface TaskListKeyboardOptions {
  tasks: Task[];
  /** Task ids exactly as rendered, top to bottom. */
  visibleOrder: string[];
  /** False while a dialog, palette or drawer has the keyboard. */
  enabled: boolean;
  /** False when no task list is shown (Overview, calendar). */
  listShown: boolean;
  onShowShortcuts: () => void;
  onOpen: (id: string) => void;
  onToggle: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (tasks: Task[]) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, payload: UpdateTaskInput) => void;
}

/**
 * Keyboard navigation of the task list: roving focus (j/k, arrows), row actions on the focused
 * row, inline rename, and `?` for the shortcuts dialog.
 */
export function useTaskListKeyboard({
  tasks,
  visibleOrder,
  enabled,
  listShown,
  onShowShortcuts,
  onOpen,
  onToggle,
  onArchive,
  onRestore,
  onDelete,
  onUpdate,
}: TaskListKeyboardOptions) {
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const lastFocusIndex = useRef(0);

  const focusTask = (id: string) => {
    setFocusedTaskId(id);
    const row = document.querySelector<HTMLElement>(`[data-task-row="${CSS.escape(id)}"]`);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'nearest' });
  };

  // When the focused row leaves the list (deleted, archived, view changed), hand focus to the
  // row now at its position. Only take DOM focus if it was lost with the row.
  useEffect(() => {
    if (!focusedTaskId) return;
    const index = visibleOrder.indexOf(focusedTaskId);
    if (index !== -1) {
      lastFocusIndex.current = index;
      return;
    }
    const next = visibleOrder[Math.min(lastFocusIndex.current, visibleOrder.length - 1)];
    if (next && (!document.activeElement || document.activeElement === document.body)) {
      focusTask(next);
    } else {
      setFocusedTaskId(next ?? null);
    }
  }, [visibleOrder, focusedTaskId]);

  const tabStopId =
    focusedTaskId && visibleOrder.includes(focusedTaskId) ? focusedTaskId : visibleOrder[0];

  // Actions apply to the row that has DOM focus. Re-subscribed every render so the handler
  // always sees current state.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextInput(e.target)) return;
      const target = e.target as HTMLElement;

      if (e.key === '?') {
        e.preventDefault();
        onShowShortcuts();
        return;
      }
      // The reorder handle uses the arrow keys itself
      if (!listShown || target.closest('[data-reorder-handle]')) return;

      const rowId = target.closest<HTMLElement>('[data-task-row]')?.dataset.taskRow;
      const index = rowId ? visibleOrder.indexOf(rowId) : -1;
      const last = visibleOrder.length - 1;

      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        const down = e.key === 'j' || e.key === 'ArrowDown';
        const nextIndex =
          index === -1 ? (down ? 0 : last) : Math.min(Math.max(index + (down ? 1 : -1), 0), last);
        if (visibleOrder[nextIndex]) {
          e.preventDefault();
          focusTask(visibleOrder[nextIndex]);
        }
        return;
      }

      const task = index === -1 ? undefined : tasks.find((t) => t.id === rowId);
      if (!task) return;
      const onRowItself = target.hasAttribute('data-task-row');
      const neighbour = visibleOrder[index + 1] ?? visibleOrder[index - 1];

      switch (e.key) {
        case ' ':
        case 'x':
          // Space on a focused button inside the row activates that button instead
          if ((e.key === ' ' && !onRowItself) || task.status === 'archived') return;
          e.preventDefault();
          if (task.status === 'in_progress' && neighbour) focusTask(neighbour);
          onToggle(task);
          return;
        case 'Enter':
          if (!onRowItself) return;
          e.preventDefault();
          onOpen(task.id);
          return;
        case 'e':
          e.preventDefault();
          setEditingTaskId(task.id);
          return;
        case 'a':
          e.preventDefault();
          if (neighbour) focusTask(neighbour);
          if (task.status === 'archived') onRestore([task]);
          else onArchive(task);
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          onDelete(task.id);
          return;
        case 'Escape':
          target.blur();
          return;
        default:
          if (/^[0-4]$/.test(e.key)) {
            e.preventDefault();
            onUpdate(task.id, { priority: Number(e.key) as TaskPriority });
          }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  /** Props shared by every TaskRow for focus and inline editing. */
  const rowFocusProps = (task: Task) => ({
    isTabStop: task.id === tabStopId,
    onFocusRow: setFocusedTaskId,
    isEditing: editingTaskId === task.id,
    onEditingChange: (editing: boolean) => {
      setEditingTaskId(editing ? task.id : null);
      // After a rename, return focus to the row unless the user clicked somewhere else
      if (!editing) {
        requestAnimationFrame(() => {
          if (document.activeElement === document.body) focusTask(task.id);
        });
      }
    },
  });

  return { rowFocusProps };
}
