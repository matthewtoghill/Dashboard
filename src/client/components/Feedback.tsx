import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { UNDO_WINDOW_MS } from '../utils/useDeferredDelete.ts';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

/** Modal confirmation built on native <dialog>: focus trap, Esc and backdrop inertness for free. */
export const ConfirmDialog: React.FC<{
  request: ConfirmRequest | null;
  onClose: () => void;
}> = ({ request, onClose }) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="confirm-dialog-title"
      className="m-auto w-full max-w-sm rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      {request && (
        <form method="dialog" className="p-5 space-y-4">
          <h2 id="confirm-dialog-title" className="text-base font-semibold">
            {request.title}
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300 whitespace-pre-line">
            {request.message}
          </p>
          <div className="flex justify-end gap-2">
            {/* Cancel is focused first so Enter never destroys data by accident */}
            <button
              value="cancel"
              autoFocus
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              value="confirm"
              onClick={request.onConfirm}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-500 cursor-pointer"
            >
              {request.confirmLabel}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
};

export interface ToastState {
  message: string;
  onUndo?: () => void;
  /** Called while the toast is hovered or focused, so a pending action waits for the user. */
  onPause?: () => void;
  onResume?: () => void;
}

// Close a little before the deferred commit fires, so Undo is never offered after it has run.
const TOAST_MS = UNDO_WINDOW_MS - 250;

/**
 * Single toast with optional Undo. Its timer pauses while hovered or focused (WCAG 2.2.1).
 * A new toast replaces the current one: the replaced action can no longer be undone, but
 * anything it paused is resumed, so a held delete still commits on time.
 */
export const Toast: React.FC<{ toast: ToastState | null; onDismiss: () => void }> = ({
  toast,
  onDismiss,
}) => {
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);
  const remaining = useRef(TOAST_MS);
  const hovered = useRef(false);
  const focused = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const start = () => {
    startedAt.current = Date.now();
    timer.current = window.setTimeout(() => onDismissRef.current(), remaining.current);
  };

  useEffect(() => {
    if (!toast) return;
    remaining.current = TOAST_MS;
    hovered.current = focused.current = false;
    start();
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      toast.onResume?.();
    };
  }, [toast]);

  const syncPause = () => {
    const shouldPause = hovered.current || focused.current;
    if (shouldPause && timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      remaining.current -= Date.now() - startedAt.current;
      toast?.onPause?.();
    } else if (!shouldPause && timer.current === null && toast) {
      start();
      toast.onResume?.();
    }
  };

  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
      {toast && (
        <div
          onMouseEnter={() => {
            hovered.current = true;
            syncPause();
          }}
          onMouseLeave={() => {
            hovered.current = false;
            syncPause();
          }}
          onFocus={() => {
            focused.current = true;
            syncPause();
          }}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            focused.current = false;
            syncPause();
          }}
          className="flex items-center gap-3 pl-4 pr-2 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 text-sm shadow-xl"
        >
          <span>{toast.message}</span>
          {toast.onUndo && (
            <button
              type="button"
              onClick={() => {
                toast.onUndo?.();
                onDismiss();
              }}
              className="px-2 py-1 rounded-md font-semibold text-indigo-300 dark:text-indigo-600 hover:bg-white/10 dark:hover:bg-black/10 cursor-pointer"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notification"
            className="p-1 rounded-md opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

const SHORTCUTS: [string, string][] = [
  ['J / \u2193', 'Next task'],
  ['K / \u2191', 'Previous task'],
  ['X / Space', 'Cycle status (To Do \u2192 In Progress \u2192 Done)'],
  ['Enter', 'Open details'],
  ['E', 'Rename'],
  ['A', 'Archive or restore'],
  ['Delete', 'Delete'],
  ['1 \u2013 4, 0', 'Priority Low \u2013 Urgent, None'],
  ['Alt + \u2191 / \u2193', 'Move (Manual sort)'],
  ['Alt + Arrows', 'Move to another day (Calendar)'],
  ['Menu / Shift + F10', 'Task or project menu'],
  ['Esc', 'Leave the list / close'],
  ['N', 'New task'],
  ['/', 'Search'],
  ['Ctrl + K', 'Command palette'],
  ['Ctrl + Z', 'Undo last action'],
  ['?', 'This help'],
];

/** Keyboard shortcut reference, on native <dialog> like ConfirmDialog. */
export const ShortcutsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="shortcuts-dialog-title"
      className="m-auto w-full max-w-md rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      <form method="dialog" className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-dialog-title" className="text-base font-semibold">
            Keyboard shortcuts
          </h2>
          <button
            value="close"
            aria-label="Close keyboard shortcuts"
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {SHORTCUTS.map(([keys, action]) => (
            <React.Fragment key={keys}>
              <dt>
                <kbd className="px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 font-mono text-xs">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-zinc-600 dark:text-zinc-300">{action}</dd>
            </React.Fragment>
          ))}
        </dl>
        <p className="text-xs text-zinc-400">
          List shortcuts work when a task row has focus; press J to start.
        </p>
      </form>
    </dialog>
  );
};
