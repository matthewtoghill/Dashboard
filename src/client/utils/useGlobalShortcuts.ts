import { Dispatch, SetStateAction, useEffect } from 'react';

interface GlobalShortcutOptions {
  /** A native <dialog> is open; it handles its own keys (Esc cancels). */
  dialogOpen: boolean;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  taskDrawerOpen: boolean;
  closeTaskDrawer: () => void;
  /** Undoes the action in the current toast, if it has one. */
  undoToast?: () => void;
  focusQuickAdd: () => void;
  focusSearch: () => void;
  toggleSidebar: () => void;
}

export const isTextInput = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/**
 * App-wide keys: N/C for quick-add, / for search, [ for the sidebar, Ctrl+K for the command palette, Ctrl+Z to undo
 * the toast's action and Escape to close the palette or task drawer.
 * Re-subscribed every render so the handler always sees current state.
 */
export function useGlobalShortcuts(options: GlobalShortcutOptions) {
  useEffect(() => {
    const {
      dialogOpen,
      commandPaletteOpen,
      setCommandPaletteOpen,
      taskDrawerOpen,
      closeTaskDrawer,
      undoToast,
      focusQuickAdd,
      focusSearch,
      toggleSidebar,
    } = options;

    const onKeyDown = (e: KeyboardEvent) => {
      if (dialogOpen) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((open) => !open);
        return;
      }

      const isInputFocused = isTextInput(e.target);

      // Ctrl/Cmd+Z undoes the action in the toast, unless the user is editing text
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'z' &&
        !isInputFocused &&
        undoToast
      ) {
        e.preventDefault();
        undoToast();
        return;
      }

      // Leave browser/OS shortcuts (Ctrl+C, Ctrl+N, ...) alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          setCommandPaletteOpen(false);
          return;
        }
        if (taskDrawerOpen && !isInputFocused) {
          closeTaskDrawer();
          return;
        }
      }

      if (isInputFocused || commandPaletteOpen) return;

      if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'c') {
        e.preventDefault();
        focusQuickAdd();
      } else if (e.key === '/') {
        e.preventDefault();
        focusSearch();
      } else if (e.key === '[') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
}
