import React from 'react';
import { Bold, Code, Heading2, Italic, Link, List, ListChecks, ListOrdered, Quote } from 'lucide-react';
import {
  LineFormat,
  TextEdit,
  applyEdit,
  insertCode,
  insertLink,
  toggleLineFormat,
  wrapSelection,
} from '../utils/markdownEditing.ts';

type Action = [string, React.FC<{ className?: string }>, (value: string, start: number, end: number) => TextEdit];

const line = (format: LineFormat) => (value: string, start: number, end: number) =>
  toggleLineFormat(value, start, end, format);

const GROUPS: Action[][] = [
  [
    ['Heading', Heading2, line('heading')],
    ['Bold (Ctrl+B)', Bold, (v, s, e) => wrapSelection(v, s, e, '**')],
    ['Italic (Ctrl+I)', Italic, (v, s, e) => wrapSelection(v, s, e, '_')],
    ['Code', Code, insertCode],
    ['Link (Ctrl+K)', Link, insertLink],
  ],
  [
    ['Bulleted list', List, line('bullet')],
    ['Numbered list', ListOrdered, line('number')],
    ['Checklist', ListChecks, line('task')],
    ['Quote', Quote, line('quote')],
  ],
];

/** Formatting buttons for a markdown textarea; each acts on its current selection. */
export const MarkdownToolbar: React.FC<{ textareaRef: React.RefObject<HTMLTextAreaElement | null> }> = ({
  textareaRef,
}) => (
  <div role="group" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5">
    {GROUPS.map((group, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span aria-hidden className="w-px h-4 mx-1 bg-zinc-200 dark:bg-zinc-700" />}
        {group.map(([label, Icon, run]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            // Keep focus, and so the selection, in the textarea
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const textarea = textareaRef.current;
              if (!textarea) return;
              applyEdit(textarea, run(textarea.value, textarea.selectionStart, textarea.selectionEnd));
            }}
            className="p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </React.Fragment>
    ))}
  </div>
);
