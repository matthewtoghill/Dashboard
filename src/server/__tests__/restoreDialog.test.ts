import { describe, it, expect } from 'vitest';
import { RESTORE_SECTIONS, RestoreDiff, RestoreResult } from '../../shared/types.ts';
import { buildRestoreRequest, fieldLabel, formatValue, itemKey, summarizeResult } from '../../client/utils/restore.ts';

const none = Object.fromEntries(RESTORE_SECTIONS.map((s) => [s, 0])) as RestoreResult['restored'];
const noSections = Object.fromEntries(RESTORE_SECTIONS.map((s) => [s, []])) as unknown as RestoreDiff['sections'];

describe('restore dialog helpers', () => {
  it('sends ticked items to add or overwrite by their state in the diff', () => {
    const diff: RestoreDiff = {
      sections: {
        ...noSections,
        tasks: [
          { id: 't1', label: 'Gone', state: 'missing', changes: [] },
          { id: 't2', label: 'Edited', state: 'changed', changes: [] },
          { id: 't3', label: 'Not ticked', state: 'missing', changes: [] },
        ],
        claudeFolderLinks: [{ id: 'C:/repo/x', label: 'C:/repo/x', state: 'changed', changes: [] }],
      },
      settings: [],
      scratchpad: null,
    };
    const request = buildRestoreRequest(diff, {
      items: new Set([itemKey('tasks', 't1'), itemKey('tasks', 't2'), itemKey('claudeFolderLinks', 'C:/repo/x')]),
      settings: new Set(['planSize']),
      scratchpad: true,
    });
    expect(request).toEqual({
      add: { tasks: ['t1'] },
      overwrite: { tasks: ['t2'], claudeFolderLinks: ['C:/repo/x'] },
      settings: ['planSize'],
      scratchpad: true,
    });
  });

  it('formats diff values for display', () => {
    expect(fieldLabel('updatedAt')).toBe('Updated at');
    expect(formatValue('projectId', null)).toBe('—');
    expect(formatValue('pinned', true)).toBe('Yes');
    expect(formatValue('priority', 2)).toBe('2');
    expect(formatValue('updatedAt', 0)).toMatch(/1970/);
    expect(formatValue('tags', ['a', 'b'])).toBe('a, b');
    expect(formatValue('subtasks', [{ title: 'Step 1' }, { title: 'Step 2' }])).toBe('Step 1, Step 2');
    expect(formatValue('adoLinks', [{ externalId: 'workitem/1', url: 'https://x' }])).toBe('workitem/1');
    expect(formatValue('recurrence', { every: 1 })).toBe('{"every":1}');
  });

  it('summarises a result per section', () => {
    expect(
      summarizeResult({
        restored: { ...none, tasks: 2 },
        overwritten: { ...none, tasks: 1, notes: 1 },
        settings: 3,
        scratchpad: true,
        warnings: [],
      })
    ).toEqual(['Tasks: 2 added, 1 overwritten', 'Notes: 1 overwritten', 'Settings: 3 restored', 'Scratchpad: replaced']);
  });
});
