import React, { useState } from 'react';
import { GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { Task } from '../../shared/types.ts';

interface ReorderableTaskListProps {
  /** Tasks in their current manual order (ascending sortOrder). */
  tasks: Task[];
  /** When false, rows render without handles or drop targets. */
  enabled: boolean;
  /** Move `taskId` so it ends up at `targetIndex` among the other tasks. */
  onMove: (taskId: string, targetIndex: number) => void;
  renderRow: (task: Task, dragHandle: React.ReactNode) => React.ReactNode;
}

/** Native HTML5 drag-and-drop list with an Alt+Up/Down keyboard alternative. */
export const ReorderableTaskList: React.FC<ReorderableTaskListProps> = ({
  tasks,
  enabled,
  onMove,
  renderRow,
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  // Insertion point in the full list (0..tasks.length), shown as a line
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  if (!enabled) {
    return (
      <div>
        {tasks.map((task) => (
          <React.Fragment key={task.id}>{renderRow(task, null)}</React.Fragment>
        ))}
      </div>
    );
  }

  const reset = () => {
    setDragId(null);
    setDropIndex(null);
  };

  const commitDrop = () => {
    if (dragId === null || dropIndex === null) return reset();
    const from = tasks.findIndex((t) => t.id === dragId);
    // Convert the insertion point into an index among the *other* tasks
    const target = dropIndex > from ? dropIndex - 1 : dropIndex;
    if (from !== -1 && target !== from) onMove(dragId, target);
    reset();
  };

  // Alt+Up/Down anywhere in the row; plain Up/Down while the handle itself is focused
  const moveByKeyboard = (e: React.KeyboardEvent, index: number, task: Task) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const target = e.target as HTMLElement;
    if (!e.altKey && !target.closest('[data-reorder-handle]')) return;
    // Alt+Down opens native selects; leave form controls alone
    if (target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
    const next = e.key === 'ArrowUp' ? index - 1 : index + 1;
    if (next >= 0 && next < tasks.length) onMove(task.id, next);
  };

  return (
    <div onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
    }}>
      {tasks.map((task, index) => {
        const moveButtonClass =
          'p-0.5 rounded text-zinc-400 active:bg-zinc-200 dark:active:bg-zinc-700 disabled:opacity-30';
        const handle = (
          <>
            {/* Touch screens: native drag-and-drop is unreliable, so offer explicit moves */}
            <span className="hidden pointer-coarse:flex flex-col -my-1 -ml-1.5">
              <button
                type="button"
                onClick={() => onMove(task.id, index - 1)}
                disabled={index === 0}
                aria-label={`Move "${task.title}" up`}
                className={moveButtonClass}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onMove(task.id, index + 1)}
                disabled={index === tasks.length - 1}
                aria-label={`Move "${task.title}" down`}
                className={moveButtonClass}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </span>
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', task.id);
                const row = e.currentTarget.closest('[data-reorder-row]');
                if (row) e.dataTransfer.setDragImage(row, 16, 16);
                setDragId(task.id);
              }}
              onDragEnd={reset}
              data-reorder-handle
              aria-label={`Reorder "${task.title}" (drag, or Alt+Up/Down)`}
              title="Drag to reorder (Alt+Up/Down)"
              className="pointer-coarse:hidden -ml-1.5 p-0.5 rounded text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </>
        );

        return (
          <div
            key={task.id}
            data-reorder-row
            onKeyDown={(e) => moveByKeyboard(e, index, task)}
            onDragOver={(e) => {
              if (dragId === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > rect.top + rect.height / 2;
              setDropIndex(after ? index + 1 : index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              commitDrop();
            }}
            className={`relative ${dragId === task.id ? 'opacity-40' : ''}`}
          >
            {dropIndex === index && <DropLine position="top" />}
            {renderRow(task, handle)}
            {dropIndex === tasks.length && index === tasks.length - 1 && (
              <DropLine position="bottom" />
            )}
          </div>
        );
      })}
    </div>
  );
};

const DropLine: React.FC<{ position: 'top' | 'bottom' }> = ({ position }) => (
  <div
    aria-hidden
    className={`absolute inset-x-0 h-0.5 rounded-full bg-indigo-500 pointer-events-none ${
      position === 'top' ? '-top-1' : '-bottom-1'
    }`}
  />
);
