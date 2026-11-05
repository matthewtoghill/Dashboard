import { RESTORE_SECTIONS, RestoreDiff, RestoreRequest, RestoreResult, RestoreSection } from '../../shared/types.ts';
import { formatTimestamp } from './taskUtils.ts';

/** Selective restore helpers for RestoreDialog (see docs/PLAN-RESTORE.md). */

export const SECTION_LABELS: Record<RestoreSection, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  notes: 'Notes',
  quickLinks: 'Quick links',
  savedViews: 'Saved views',
  claudeSessions: 'Claude sessions',
  claudeFolderLinks: 'Claude folder links',
  adoProjectLinks: 'ADO project mappings',
  adoDismissed: 'Dismissed ADO items',
};

/** Key of a ticked item. Sections never contain '/', so the first one splits it. */
export const itemKey = (section: RestoreSection, id: string) => `${section}/${id}`;

/** "updatedAt" -> "Updated at" */
export function fieldLabel(field: string): string {
  const words = field.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A diff value as short text: dates for timestamps, titles for lists of records. */
export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number' && /(At|Since)$/.test(field)) return formatTimestamp(value);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return value
      .map((v) => {
        if (typeof v !== 'object' || v === null) return String(v);
        const record = v as Record<string, unknown>;
        return String(record.title ?? record.externalId ?? record.name ?? JSON.stringify(v));
      })
      .join(', ');
  }
  return JSON.stringify(value);
}

export interface RestoreSelection {
  /** itemKey()s */
  items: Set<string>;
  settings: Set<string>;
  scratchpad: boolean;
}

/** Ticked items go to `add` or `overwrite` by their state in the diff. */
export function buildRestoreRequest(diff: RestoreDiff, selection: RestoreSelection): RestoreRequest {
  const add: Partial<Record<RestoreSection, string[]>> = {};
  const overwrite: Partial<Record<RestoreSection, string[]>> = {};
  for (const section of RESTORE_SECTIONS) {
    for (const item of diff.sections[section]) {
      if (!selection.items.has(itemKey(section, item.id))) continue;
      const target = item.state === 'missing' ? add : overwrite;
      (target[section] ??= []).push(item.id);
    }
  }
  return { add, overwrite, settings: [...selection.settings], scratchpad: selection.scratchpad };
}

export const selectionCount = (selection: RestoreSelection) =>
  selection.items.size + selection.settings.size + (selection.scratchpad ? 1 : 0);

/** One line per section touched, e.g. "Tasks: 2 added, 1 overwritten". */
export function summarizeResult(result: RestoreResult): string[] {
  const lines = RESTORE_SECTIONS.flatMap((section) => {
    const parts = [
      result.restored[section] ? `${result.restored[section]} added` : '',
      result.overwritten[section] ? `${result.overwritten[section]} overwritten` : '',
    ].filter(Boolean);
    return parts.length ? [`${SECTION_LABELS[section]}: ${parts.join(', ')}`] : [];
  });
  if (result.settings) lines.push(`Settings: ${result.settings} restored`);
  if (result.scratchpad) lines.push('Scratchpad: replaced');
  return lines;
}
