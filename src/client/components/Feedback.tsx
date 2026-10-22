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
}

export const Toast: React.FC<{ toast: ToastState | null; onDismiss: () => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
      {toast && (
        <div className="flex items-center gap-3 pl-4 pr-2 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 text-sm shadow-xl">
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
