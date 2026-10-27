import { describe, it, expect, vi } from 'vitest';
import { Task } from '../../shared/types.ts';
import { TaskMenuActions, taskMenuItems } from '../../client/utils/contextMenuItems.ts';

const base: Task = {
  id: 't1',
  title: 'Write report',
  description: '',
  status: 'todo',
  priority: 2,
  projectId: null,
  tags: ['work'],
  dueDate: '2026-10-22',
  sortOrder: 0,
  completedAt: null,
  createdAt: 1,
  updatedAt: 1,
  statusBeforeArchive: null,
  recurrence: null,
  recurrenceParentId: null,
  holdReason: null,
  heldSince: null,
  adoLinks: [],
  subtasks: [],
};

const actions = (): TaskMenuActions => ({
  projects: [{ id: 'p1', name: 'Work', color: '#6366f1', sortOrder: 0, createdAt: 1, adoEnabled: true }],
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onSetStatus: vi.fn(),
  onUpdate: vi.fn(),
  onReschedule: vi.fn(),
  onCopyTitle: vi.fn(),
  onArchive: vi.fn(),
  onRestore: vi.fn(),
  onDelete: vi.fn(),
});

const labels = (task: Task, ghost = false) => taskMenuItems(task, ghost, actions()).map((i) => i.label);

describe('taskMenuItems', () => {
  it('offers only "Open task" for a ghost entry', () => {
    expect(labels(base, true)).toEqual(['Open task']);
  });

  it('lists the task actions, ticking the current status', () => {
    const items = taskMenuItems(base, false, actions());
    expect(items.map((i) => i.label)).toEqual([
      'Open task', 'Edit title', 'To Do', 'In Progress', 'On Hold', 'Completed', 'Priority', 'Due date',
      'Move to project', 'Add tag', 'Copy title', 'Archive', 'Delete',
    ]);
    expect(items.find((i) => i.label === 'To Do')?.checked).toBe(true);
  });

  it('swaps status and archive for restore on an archived task', () => {
    const list = labels({ ...base, status: 'archived' });
    expect(list).not.toContain('To Do');
    expect(list).toContain('Restore');
    expect(list).not.toContain('Archive');
  });

  it('shows Azure DevOps only when linked, and skips moving to the same due date', () => {
    expect(labels(base)).not.toContain('Open in Azure DevOps');
    const link = { externalId: 'workitem/1', url: 'https://dev.azure.com/x', title: 'X', type: 'Task', state: 'New', linkedAt: 1 };
    expect(labels({ ...base, adoLinks: [link] })).toContain('Open in Azure DevOps');
    const both = taskMenuItems({ ...base, adoLinks: [link, { ...link, externalId: 'pr/2', title: 'Y' }] }, false, actions());
    expect(both.find((i) => i.label === 'Open in Azure DevOps')!.submenu!.map((i) => i.label)).toEqual(['X', 'Y']);

    const a = actions();
    const due = taskMenuItems(base, false, a).find((i) => i.label === 'Due date')!.submenu!;
    due.find((i) => i.label === 'Pick a date')!.input!.onSubmit('2026-10-22');
    expect(a.onReschedule).not.toHaveBeenCalled();
    due.find((i) => i.label === 'Pick a date')!.input!.onSubmit('2026-10-30');
    expect(a.onReschedule).toHaveBeenCalledWith(base, '2026-10-30');
  });

  it('adds a cleaned tag once', () => {
    const a = actions();
    const tag = taskMenuItems(base, false, a).find((i) => i.label === 'Add tag')!.submenu![0].input!;
    tag.onSubmit('work');
    expect(a.onUpdate).not.toHaveBeenCalled();
    tag.onSubmit('urgent');
    expect(a.onUpdate).toHaveBeenCalledWith('t1', { tags: ['work', 'urgent'] });
  });
});
