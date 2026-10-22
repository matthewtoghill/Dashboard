import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checklistProgress, toggleMarkdownCheckbox } from '../../client/utils/markdown.ts';
import { MarkdownNotes } from '../../client/components/MarkdownNotes.tsx';

const render = (text: string) =>
  renderToStaticMarkup(createElement(MarkdownNotes, { text, onToggleCheckbox: () => {} }));

describe('toggleMarkdownCheckbox', () => {
  const text = '- [ ] first\nplain line\n  - [x] indented\n* [X] upper\n1. [ ] last';

  it('checks the first line and unchecks an indented one', () => {
    expect(toggleMarkdownCheckbox(text, 1).split('\n')[0]).toBe('- [x] first');
    expect(toggleMarkdownCheckbox(text, 3).split('\n')[2]).toBe('  - [ ] indented');
  });

  it('treats uppercase [X] as checked', () => {
    expect(toggleMarkdownCheckbox(text, 4).split('\n')[3]).toBe('* [ ] upper');
  });

  it('toggles an ordered item on the last line', () => {
    expect(toggleMarkdownCheckbox(text, 5).split('\n')[4]).toBe('1. [x] last');
  });

  it('leaves lines without a checkbox and out-of-range lines unchanged', () => {
    expect(toggleMarkdownCheckbox(text, 2)).toBe(text);
    expect(toggleMarkdownCheckbox(text, 99)).toBe(text);
    expect(toggleMarkdownCheckbox('- not [ ] a box', 1)).toBe('- not [ ] a box');
  });

  it('keeps CRLF line endings', () => {
    expect(toggleMarkdownCheckbox('- [ ] a\r\n- [ ] b', 2)).toBe('- [ ] a\r\n- [x] b');
  });
});

describe('checklistProgress', () => {
  it('counts checked and total items', () => {
    expect(checklistProgress('- [x] a\n- [ ] b\n  - [X] c\ntext')).toEqual({ done: 2, total: 3 });
  });

  it('returns null without task-list items', () => {
    expect(checklistProgress('- a\n- b')).toBeNull();
  });
});

describe('MarkdownNotes', () => {
  it('renders safe links in a new tab and drops javascript: hrefs', () => {
    const html = render('[ok](https://example.com) [bad](javascript:alert(1)) [mail](mailto:a@b.c)');
    expect(html).toContain('href="https://example.com" target="_blank" rel="noreferrer noopener"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<span>bad</span>');
  });

  it('renders autolinks, emphasis, code and task lists', () => {
    const html = render('**b** _i_ `c` www.example.com\n\n- [x] done\n- [ ] open');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<em>i</em>');
    expect(html).toContain('>c</code>');
    expect(html).toContain('href="http://www.example.com"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-label="done"[^>]*checked=""/);
    expect(html).toContain('aria-label="open"');
  });
});
