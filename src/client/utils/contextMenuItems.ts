import {
  Archive,
  ArchiveRestore,
  Calendar,
  ClipboardCopy,
  Copy,
  CopyPlus,
  ExternalLink,
  Flag,
  Folder,
  Palette,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Settings,
  Tag,
  Trash2,
} from 'lucide-react';
import { Note, Project, Task, TaskPriority, TaskStatus, UpdateNoteInput, UpdateTaskInput } from '../../shared/types.ts';
import type { MenuItem } from '../components/ContextMenu.tsx';
import {
  PRIORITY_CONFIG,
  PROJECT_COLORS,
  STATUS_LABELS,
  cleanTag,
  getTodayIso,
  getTomorrowIso,
  resolveDateToken,
} from './taskUtils.ts';

export interface TaskMenuActions {
  projects: Project[];
  onOpen: (taskId: string) => void;
  onRename: (taskId: string) => void;
  onSetStatus: (task: Task, status: TaskStatus) => void;
  onUpdate: (id: string, payload: UpdateTaskInput) => void;
  onReschedule: (task: Task, dueDate: string) => void;
  onCopyTitle: (task: Task) => void;
  onArchive: (task: Task) => void;
  onRestore: (task: Task) => void;
  onDelete: (id: string) => void;
}

/** Right-click menu for a task. A ghost (future recurring occurrence) only offers "Open task". */
export function taskMenuItems(task: Task, ghost: boolean, a: TaskMenuActions): MenuItem[] {
  const open: MenuItem = { label: 'Open task', icon: PanelRightOpen, onSelect: () => a.onOpen(task.id) };
  if (ghost) return [open];

  const isArchived = task.status === 'archived';
  const reschedule = (dueDate: string) => {
    if (dueDate !== task.dueDate) a.onReschedule(task, dueDate);
  };
  const items: MenuItem[] = [
    open,
    { label: 'Edit title', icon: Pencil, onSelect: () => a.onRename(task.id) },
  ];

  if (!isArchived) {
    items.push(
      ...(['todo', 'in_progress', 'done'] as const).map((status, i) => ({
        label: STATUS_LABELS[status],
        checked: task.status === status,
        separatorBefore: i === 0,
        onSelect: () => a.onSetStatus(task, status),
      }))
    );
  }

  items.push(
    {
      label: 'Priority',
      icon: Flag,
      separatorBefore: true,
      submenu: ([4, 3, 2, 1, 0] as TaskPriority[]).map((priority) => ({
        label: PRIORITY_CONFIG[priority].label,
        checked: task.priority === priority,
        onSelect: () => a.onUpdate(task.id, { priority }),
      })),
    },
    {
      label: 'Due date',
      icon: Calendar,
      submenu: [
        { label: 'Today', onSelect: () => reschedule(getTodayIso()) },
        { label: 'Tomorrow', onSelect: () => reschedule(getTomorrowIso()) },
        { label: 'Next week', onSelect: () => reschedule(resolveDateToken('next-week')!) },
        ...(task.dueDate
          ? [{ label: 'Clear date', danger: true, onSelect: () => a.onUpdate(task.id, { dueDate: null }) }]
          : []),
        {
          label: 'Pick a date',
          separatorBefore: true,
          input: { type: 'date', initial: task.dueDate ?? '', onSubmit: reschedule },
        },
      ],
    }
  );

  if (a.projects.length > 0) {
    items.push({
      label: 'Move to project',
      icon: Folder,
      submenu: [
        { id: null, name: 'No project', color: undefined },
        ...a.projects.map((p) => ({ id: p.id as string | null, name: p.name, color: p.color })),
      ].map((p) => ({
        label: p.name,
        swatch: p.color,
        checked: task.projectId === p.id,
        onSelect: () => a.onUpdate(task.id, { projectId: p.id }),
      })),
    });
  }

  items.push(
    {
      label: 'Add tag',
      icon: Tag,
      submenu: [
        {
          label: 'Tag name',
          input: {
            type: 'text',
            list: 'tag-suggestions',
            onSubmit: (text) => {
              const tag = cleanTag(text);
              if (tag && !task.tags.includes(tag)) a.onUpdate(task.id, { tags: [...task.tags, tag] });
            },
          },
        },
      ],
    },
    { label: 'Copy title', icon: Copy, separatorBefore: true, onSelect: () => a.onCopyTitle(task) }
  );

  if (task.adoLinks.length > 0) {
    const open = (url: string) => () => window.open(url, '_blank', 'noreferrer');
    items.push(
      task.adoLinks.length === 1
        ? { label: 'Open in Azure DevOps', icon: ExternalLink, onSelect: open(task.adoLinks[0].url) }
        : {
            label: 'Open in Azure DevOps',
            icon: ExternalLink,
            submenu: task.adoLinks.map((l) => ({ label: l.title || l.externalId, onSelect: open(l.url) })),
          }
    );
  }

  items.push(
    isArchived
      ? { label: 'Restore', icon: ArchiveRestore, separatorBefore: true, onSelect: () => a.onRestore(task) }
      : { label: 'Archive', icon: Archive, separatorBefore: true, onSelect: () => a.onArchive(task) },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => a.onDelete(task.id) }
  );
  return items;
}

/** Right-click menu for a sidebar project. */
export function projectMenuItems(
  project: Project,
  onUpdate: (id: string, name: string, color: string) => void,
  onDelete: (id: string) => void,
  onOpenSettings: (id: string) => void
): MenuItem[] {
  return [
    { label: 'Project settings', icon: Settings, onSelect: () => onOpenSettings(project.id) },
    {
      label: 'Rename',
      icon: Pencil,
      submenu: [
        {
          label: 'Project name',
          input: { type: 'text', initial: project.name, onSubmit: (name) => onUpdate(project.id, name, project.color) },
        },
      ],
    },
    {
      label: 'Change colour',
      icon: Palette,
      submenu: PROJECT_COLORS.map((color) => ({
        label: color,
        swatch: color,
        checked: project.color === color,
        onSelect: () => onUpdate(project.id, project.name, color),
      })),
    },
    { label: 'Delete project', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => onDelete(project.id) },
  ];
}

export interface NoteMenuActions {
  /** Tags used on any note, offered as tick boxes. */
  allTags: string[];
  /** id of the <datalist> of note tags. */
  tagListId: string;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: UpdateNoteInput) => void;
  onCopy: (note: Note, rich: boolean) => void;
  onDuplicate: (note: Note) => void;
  onDelete: (note: Note) => void;
}

/** Right-click menu for a note card or row. */
export function noteMenuItems(note: Note, a: NoteMenuActions): MenuItem[] {
  const update = (patch: UpdateNoteInput) => a.onUpdate(note.id, patch);
  const toggleTag = (tag: string) =>
    update({ tags: note.tags.includes(tag) ? note.tags.filter((t) => t !== tag) : [...note.tags, tag] });
  return [
    { label: 'Open note', icon: PanelRightOpen, onSelect: () => a.onOpen(note.id) },
    {
      label: note.title ? 'Rename' : 'Add title',
      icon: Pencil,
      submenu: [{ label: 'Title', input: { type: 'text', initial: note.title, onSubmit: (title) => update({ title }) } }],
    },
    { label: 'Copy markdown', icon: Copy, separatorBefore: true, onSelect: () => a.onCopy(note, false) },
    { label: 'Copy as rich text', icon: ClipboardCopy, onSelect: () => a.onCopy(note, true) },
    {
      label: note.pinned ? 'Unpin' : 'Pin to top',
      icon: note.pinned ? PinOff : Pin,
      separatorBefore: true,
      onSelect: () => update({ pinned: !note.pinned }),
    },
    {
      label: 'Colour',
      icon: Palette,
      submenu: [
        { label: 'None', checked: note.color === null, onSelect: () => update({ color: null }) },
        ...PROJECT_COLORS.map((color) => ({
          label: color,
          swatch: color,
          checked: note.color === color,
          onSelect: () => update({ color }),
        })),
      ],
    },
    {
      label: 'Tags',
      icon: Tag,
      submenu: [
        ...a.allTags.map((tag) => ({ label: `#${tag}`, checked: note.tags.includes(tag), onSelect: () => toggleTag(tag) })),
        {
          label: 'New tag',
          separatorBefore: a.allTags.length > 0,
          input: {
            type: 'text',
            list: a.tagListId,
            onSubmit: (text) => {
              const tag = cleanTag(text);
              if (tag && !note.tags.includes(tag)) update({ tags: [...note.tags, tag] });
            },
          },
        },
      ],
    },
    { label: 'Duplicate', icon: CopyPlus, separatorBefore: true, onSelect: () => a.onDuplicate(note) },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => a.onDelete(note) },
  ];
}
