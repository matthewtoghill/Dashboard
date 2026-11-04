import type React from 'react';

/** Replace `from`..`to` with `insert`, then select `selStart`..`selEnd`. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
  selStart: number;
  selEnd: number;
}

// Indent and blockquote markers, a bullet or number, its spacing, and an optional checkbox.
const LIST_PREFIX = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;
// Four spaces nests under both "- " and "1. " items.
const INDENT = '    ';
const URL = /^https?:\/\/\S+$/i;

const lineStartOf = (value: string, pos: number) => value.lastIndexOf('\n', pos - 1) + 1;
const lineEndOf = (value: string, pos: number) => {
  const end = value.indexOf('\n', pos);
  return end === -1 ? value.length : end;
};

/** Enter in a list item starts the next item; Enter on an empty item ends the list. */
export function continueList(value: string, start: number, end: number): TextEdit | null {
  if (start !== end) return null;
  const lineStart = lineStartOf(value, start);
  const lineEnd = lineEndOf(value, start);
  const match = LIST_PREFIX.exec(value.slice(lineStart, lineEnd));
  if (!match || start - lineStart < match[0].length) return null;

  if (value.slice(lineStart + match[0].length, lineEnd).trim() === '') {
    return { from: lineStart, to: lineEnd, insert: '', selStart: lineStart, selEnd: lineStart };
  }
  const [, lead, marker, gap, box] = match;
  const number = /^(\d+)(.)$/.exec(marker);
  const next = number ? `${Number(number[1]) + 1}${number[2]}` : marker;
  const insert = `\n${lead}${next}${gap}${box ? '[ ] ' : ''}`;
  return { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length };
}

/** Tab indents and Shift+Tab outdents the selected lines, when the first one is a list item. */
export function indentLines(value: string, start: number, end: number, outdent: boolean): TextEdit | null {
  const from = lineStartOf(value, start);
  // A selection ending at the start of a line doesn't take that line
  const to = lineEndOf(value, end > start && value[end - 1] === '\n' ? end - 1 : end);
  if (!LIST_LINE.test(value.slice(from, to))) return null;

  let startShift = 0;
  let total = 0;
  const lines = value.slice(from, to).split('\n').map((line, i) => {
    const shift = outdent ? -Math.min(INDENT.length, line.length - line.trimStart().length) : INDENT.length;
    if (i === 0) startShift = shift;
    total += shift;
    return shift < 0 ? line.slice(-shift) : INDENT + line;
  });
  const insert = lines.join('\n');
  return {
    from,
    to,
    insert,
    selStart: Math.max(from, start + startShift),
    selEnd: start === end ? Math.max(from, start + startShift) : end + total,
  };
}

/** Wraps the selection in `marker` (`**` or `_`), or unwraps it when already wrapped. */
export function wrapSelection(value: string, start: number, end: number, marker: string): TextEdit {
  const n = marker.length;
  if (value.slice(start - n, start) === marker && value.slice(end, end + n) === marker) {
    const inner = value.slice(start, end);
    return { from: start - n, to: end + n, insert: inner, selStart: start - n, selEnd: end - n };
  }
  const insert = `${marker}${value.slice(start, end)}${marker}`;
  return { from: start, to: end, insert, selStart: start + n, selEnd: end + n };
}

/** Turns the selection into a link: `url` as its target, or a `url` placeholder to type over. */
export function linkSelection(value: string, start: number, end: number, url?: string): TextEdit | null {
  const selected = value.slice(start, end);
  if (!selected) return null;
  if (!url && URL.test(selected)) {
    // The selection is the address; leave the cursor in the empty text brackets
    return { from: start, to: end, insert: `[](${selected})`, selStart: start + 1, selEnd: start + 1 };
  }
  const target = url ?? 'url';
  const insert = `[${selected}](${target})`;
  const urlStart = start + selected.length + 3;
  return url
    ? { from: start, to: end, insert, selStart: start + insert.length, selEnd: start + insert.length }
    : { from: start, to: end, insert, selStart: urlStart, selEnd: urlStart + target.length };
}

/** Toolbar link: links the selection, or inserts `[text](url)` with `text` selected. */
export function insertLink(value: string, start: number, end: number): TextEdit {
  return (
    linkSelection(value, start, end) ?? { from: start, to: end, insert: '[text](url)', selStart: start + 1, selEnd: start + 5 }
  );
}

/** Inline code for a selection on one line, a fenced block for one spanning lines. */
export function insertCode(value: string, start: number, end: number): TextEdit {
  const selected = value.slice(start, end);
  if (!selected.includes('\n')) return wrapSelection(value, start, end, '`');
  const insert = `\`\`\`\n${selected}\n\`\`\``;
  return { from: start, to: end, insert, selStart: start + 4, selEnd: start + 4 + selected.length };
}

export type LineFormat = 'bullet' | 'number' | 'task' | 'quote' | 'heading';

const LIST_MARKER = /^(\s*)(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;

const formatOf = (line: string): LineFormat | null =>
  /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s/.test(line)
    ? 'task'
    : /^\s*\d+[.)]\s/.test(line)
    ? 'number'
    : /^\s*[-*+]\s/.test(line)
    ? 'bullet'
    : /^\s*>/.test(line)
    ? 'quote'
    : /^#{1,6}\s/.test(line)
    ? 'heading'
    : null;

/**
 * Turns the selected lines into a list, checklist, quote or heading, swapping any other list
 * marker. When every non-blank line already has that format, removes it instead.
 */
export function toggleLineFormat(value: string, start: number, end: number, format: LineFormat): TextEdit {
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end > start && value[end - 1] === '\n' ? end - 1 : end);
  const lines = value.slice(from, to).split('\n');
  const filled = lines.filter((line) => line.trim());
  const remove = filled.length > 0 && filled.every((line) => formatOf(line) === format);
  let number = 1;

  const next = lines.map((line) => {
    if (filled.length > 0 && !line.trim()) return line;
    if (format === 'quote') return remove ? line.replace(/^(\s*)>\s?/, '$1') : `> ${line}`;
    if (format === 'heading') {
      const text = line.replace(/^#{1,6}\s+/, '');
      return remove ? text : `## ${text}`;
    }
    const [marker, indent] = LIST_MARKER.exec(line) ?? ['', ''];
    const text = line.slice(marker.length);
    if (remove) return indent + text;
    const prefix = format === 'bullet' ? '- ' : format === 'task' ? '- [ ] ' : `${number++}. `;
    return indent + prefix + text;
  });

  const insert = next.join('\n');
  if (start !== end) return { from, to, insert, selStart: from, selEnd: from + insert.length };
  // Keep the cursor on the same text, which moved by however much the first line's prefix changed
  const cursor = Math.max(from, start + next[0].length - lines[0].length);
  return { from, to, insert, selStart: cursor, selEnd: cursor };
}

/** Applies an edit through the browser's own text input, so Ctrl+Z still undoes it. */
export function applyEdit(textarea: HTMLTextAreaElement, edit: TextEdit) {
  textarea.focus();
  textarea.setSelectionRange(edit.from, edit.to);
  const done =
    edit.insert === ''
      ? edit.from === edit.to || document.execCommand('delete')
      : document.execCommand('insertText', false, edit.insert);
  if (!done) {
    // No undo entry this way, but React still sees the input event
    textarea.setRangeText(edit.insert);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  textarea.setSelectionRange(edit.selStart, edit.selEnd);
}

/**
 * Key and paste handlers for a markdown textarea: list continuation, Tab/Shift+Tab on list lines,
 * Ctrl+B/I/K, pasting a URL over a selection, and Ctrl+Enter or Escape to call `onExit`.
 */
export function markdownEditorProps(onExit: () => void) {
  return {
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const { value, selectionStart: start, selectionEnd: end } = textarea;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      let edit: TextEdit | null = null;

      if (e.key === 'Escape' || (mod && e.key === 'Enter')) {
        e.preventDefault();
        e.stopPropagation();
        onExit();
        return;
      }
      if (e.nativeEvent.isComposing || e.altKey) return;
      if (e.key === 'Enter' && !mod && !e.shiftKey) edit = continueList(value, start, end);
      // Tab only acts on list lines, so elsewhere it still moves focus
      else if (e.key === 'Tab' && !mod) edit = indentLines(value, start, end, e.shiftKey);
      else if (mod && !e.shiftKey && key === 'b') edit = wrapSelection(value, start, end, '**');
      else if (mod && !e.shiftKey && key === 'i') edit = wrapSelection(value, start, end, '_');
      // Without a selection Ctrl+K falls through to the command palette
      else if (mod && !e.shiftKey && key === 'k') edit = linkSelection(value, start, end);

      if (!edit) return;
      e.preventDefault();
      e.stopPropagation();
      applyEdit(textarea, edit);
    },
    onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const textarea = e.currentTarget;
      const url = e.clipboardData.getData('text/plain').trim();
      const { value, selectionStart: start, selectionEnd: end } = textarea;
      if (!URL.test(url) || start === end || URL.test(value.slice(start, end))) return;
      const edit = linkSelection(value, start, end, url);
      if (!edit) return;
      e.preventDefault();
      applyEdit(textarea, edit);
    },
  };
}
