// A GFM task-list item: optional blockquote markers, a bullet or number, then [ ], [x] or [X].
const CHECKBOX_LINE = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/** Flips `[ ]` ↔ `[x]` on the given 1-based source line. Lines without a checkbox are left as is. */
export function toggleMarkdownCheckbox(text: string, line: number): string {
  const lines = text.split('\n');
  const index = line - 1;
  const current = lines[index];
  if (current === undefined || !CHECKBOX_LINE.test(current)) return text;
  lines[index] = current.replace(CHECKBOX_LINE, (_, open, mark, close) =>
    `${open}${mark === ' ' ? 'x' : ' '}${close}`
  );
  return lines.join('\n');
}

/** Checked and total task-list items, or null when the text has none. */
// ponytail: line scan also counts checkbox-looking lines inside code blocks; parse with remark if that matters.
export function checklistProgress(text: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of text.split('\n')) {
    const match = CHECKBOX_LINE.exec(line);
    if (!match) continue;
    total++;
    if (match[2] !== ' ') done++;
  }
  return total > 0 ? { done, total } : null;
}

/** Only these link schemes are rendered as clickable. */
export function isSafeLinkHref(href: string | undefined): href is string {
  return href !== undefined && /^(https?:|mailto:)/i.test(href.trim());
}
