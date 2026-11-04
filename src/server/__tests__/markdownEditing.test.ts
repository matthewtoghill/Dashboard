import { describe, it, expect } from 'vitest';
import {
  TextEdit,
  continueList,
  indentLines,
  insertCode,
  insertLink,
  toggleLineFormat,
  linkSelection,
  wrapSelection,
} from '../../client/utils/markdownEditing.ts';

/** Applies an edit and marks the new selection with | (or [ ] around a range). */
const run = (value: string, edit: TextEdit | null) => {
  if (!edit) return null;
  const text = value.slice(0, edit.from) + edit.insert + value.slice(edit.to);
  return edit.selStart === edit.selEnd
    ? text.slice(0, edit.selStart) + '|' + text.slice(edit.selStart)
    : text.slice(0, edit.selStart) + '[' + text.slice(edit.selStart, edit.selEnd) + ']' + text.slice(edit.selEnd);
};
const at = (value: string, fn: (v: string, s: number, e: number) => TextEdit | null) => {
  const start = value.indexOf('|');
  const v = value.replace('|', '');
  return run(v, fn(v, start, start));
};

describe('continueList', () => {
  it('continues bullets, numbers and checkboxes', () => {
    expect(at('- a|', continueList)).toBe('- a\n- |');
    expect(at('  * a|', continueList)).toBe('  * a\n  * |');
    expect(at('9. a|', continueList)).toBe('9. a\n10. |');
    expect(at('1) a|', continueList)).toBe('1) a\n2) |');
    expect(at('- [x] done|', continueList)).toBe('- [x] done\n- [ ] |');
    expect(at('> - quoted|', continueList)).toBe('> - quoted\n> - |');
  });

  it('splits an item when the cursor is mid-text', () => {
    expect(at('- ab|cd', continueList)).toBe('- ab\n- |cd');
  });

  it('ends the list on an empty item', () => {
    expect(at('- a\n- |', continueList)).toBe('- a\n|');
    expect(at('- a\n- [ ] |', continueList)).toBe('- a\n|');
  });

  it('leaves plain lines and cursors inside the marker alone', () => {
    expect(at('plain|', continueList)).toBeNull();
    expect(at('-| a', continueList)).toBeNull();
  });
});

describe('indentLines', () => {
  it('indents and outdents a list line, keeping the cursor on its text', () => {
    expect(at('- a\n- b|', (v, s, e) => indentLines(v, s, e, false))).toBe('- a\n    - b|');
    expect(at('- a\n    - b|', (v, s, e) => indentLines(v, s, e, true))).toBe('- a\n- b|');
    expect(at('  - |b', (v, s, e) => indentLines(v, s, e, true))).toBe('- |b');
  });

  it('indents every selected line', () => {
    const v = '- a\n- b\n- c';
    expect(run(v, indentLines(v, 0, 7, false))).toBe('    [- a\n    - b]\n- c');
  });

  it('ignores non-list lines so Tab still moves focus', () => {
    expect(at('text|', (v, s, e) => indentLines(v, s, e, false))).toBeNull();
  });
});

describe('wrapSelection', () => {
  it('wraps and unwraps the selection', () => {
    expect(run('a word b', wrapSelection('a word b', 2, 6, '**'))).toBe('a **[word]** b');
    expect(run('a **word** b', wrapSelection('a **word** b', 4, 8, '**'))).toBe('a [word] b');
  });

  it('puts the cursor between markers with nothing selected', () => {
    expect(run('ab', wrapSelection('ab', 1, 1, '_'))).toBe('a_|_b');
  });
});

describe('linkSelection', () => {
  it('links text with a url placeholder selected', () => {
    expect(run('see docs', linkSelection('see docs', 4, 8))).toBe('see [docs]([url])');
  });

  it('links a selected address with the cursor in the text brackets', () => {
    expect(run('https://x.io', linkSelection('https://x.io', 0, 12))).toBe('[|](https://x.io)');
  });

  it('uses a pasted url', () => {
    expect(run('see docs', linkSelection('see docs', 4, 8, 'https://x.io'))).toBe('see [docs](https://x.io)|');
  });

  it('needs a selection', () => {
    expect(linkSelection('abc', 1, 1)).toBeNull();
  });
});

describe('toggleLineFormat', () => {
  const all = (v: string, f: Parameters<typeof toggleLineFormat>[3]) => run(v, toggleLineFormat(v, 0, v.length, f));

  it('adds a marker to an empty line and keeps the cursor on the text', () => {
    expect(at('|', (v, s, e) => toggleLineFormat(v, s, e, 'task'))).toBe('- [ ] |');
    expect(at('ab|c', (v, s, e) => toggleLineFormat(v, s, e, 'bullet'))).toBe('- ab|c');
  });

  it('numbers lines, skips blanks and swaps other list markers', () => {
    expect(all('a\n\n- b\n  - [x] c', 'number')).toBe('[1. a\n\n2. b\n  3. c]');
  });

  it('removes the format when every line has it', () => {
    expect(all('- [ ] a\n- [x] b', 'task')).toBe('[a\nb]');
    expect(all('> a\n> b', 'quote')).toBe('[a\nb]');
    expect(at('## |T', (v, s, e) => toggleLineFormat(v, s, e, 'heading'))).toBe('|T');
  });

  it('turns a checklist into bullets rather than removing it', () => {
    expect(all('- [ ] a', 'bullet')).toBe('[- a]');
  });
});

describe('toolbar inserts', () => {
  it('inserts a link template with nothing selected', () => {
    expect(at('|', insertLink)).toBe('[[text]](url)');
  });

  it('uses inline code on one line and a fence across lines', () => {
    expect(run('ab', insertCode('ab', 0, 2))).toBe('`[ab]`');
    expect(run('a\nb', insertCode('a\nb', 0, 3))).toBe('```\n[a\nb]\n```');
  });
});
