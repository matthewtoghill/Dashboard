import React, { useState } from 'react';
import { BookmarkPlus, Check, X } from 'lucide-react';
import { SavedView } from '../../shared/types.ts';

const buttonClass =
  'inline-flex items-center gap-1.5 px-[9px] py-1 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors duration-150 cursor-pointer';

/** Inline name input used to save and rename views. Enter saves, Escape cancels. */
export const ViewNameInput: React.FC<{
  initial: string;
  label: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}> = ({ initial, label, onSubmit, onCancel }) => {
  const [name, setName] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim().slice(0, 60);
        if (trimmed) onSubmit(trimmed);
      }}
      className="inline-flex items-center gap-1"
    >
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        aria-label={label}
        maxLength={60}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        className="w-36 text-xs px-2 py-1 rounded-lg border border-indigo-400 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none"
      />
      <button type="submit" aria-label="Save" className="p-1 text-indigo-600 dark:text-indigo-400 cursor-pointer">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel" className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer">
        <X className="w-3.5 h-3.5" />
      </button>
    </form>
  );
};

/** Toolbar: "Save view", or for a changed saved view a modified dot with "Update view" and "Save as new". */
export const SavedViewControls: React.FC<{
  appliedView: SavedView | null;
  isModified: boolean;
  defaultName: string;
  onSaveNew: (name: string) => void;
  onUpdate: () => void;
}> = ({ appliedView, isModified, defaultName, onSaveNew, onUpdate }) => {
  const [naming, setNaming] = useState(false);

  if (naming) {
    return (
      <ViewNameInput
        initial={appliedView ? `${appliedView.name} (copy)` : defaultName}
        label="Saved view name"
        onSubmit={(name) => {
          onSaveNew(name);
          setNaming(false);
        }}
        onCancel={() => setNaming(false)}
      />
    );
  }

  if (appliedView && isModified) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
          <span>
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{appliedView.name}</span> modified
          </span>
        </span>
        <button type="button" onClick={onUpdate} className={buttonClass}>
          Update view
        </button>
        <button type="button" onClick={() => setNaming(true)} className={buttonClass}>
          Save as new
        </button>
      </span>
    );
  }

  if (appliedView) return null;

  return (
    <button type="button" onClick={() => setNaming(true)} className={buttonClass}>
      <BookmarkPlus className="w-[13px] h-[13px]" />
      <span>Save view</span>
    </button>
  );
};
