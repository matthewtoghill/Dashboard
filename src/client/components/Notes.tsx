import React, { useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useQuery, useQueryClient, QueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  Edit3,
  Eye,
  Grid2x2,
  PaintBucket,
  PanelTop,
  LayoutDashboard,
  List,
  Pin,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { Note, UpdateNoteInput } from '../../shared/types.ts';
import { createNote, fetchNotes, updateNote } from '../api.ts';
import { PROJECT_COLORS, cleanTag, errorMessage, formatRelativeTime, formatTimestamp, plural } from '../utils/taskUtils.ts';
import { MarkdownNotes } from './MarkdownNotes.tsx';
import { toolbarButtonClass } from './TaskListToolbar.tsx';
import { DockedPanel } from './ui.tsx';

type NotesLayout = 'grid' | 'masonry' | 'list';
const LAYOUT_KEY = 'dashboard_notes_layout';
/** How a card shows its note's colour: a top edge, or a tinted background and border. */
type ColorStyle = 'border' | 'tint';
const COLOR_STYLE_KEY = 'dashboard_notes_color_style';
export const NOTE_TAG_LIST_ID = 'note-tag-suggestions';
const TAG_CLASS =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300';

export const useNotes = () => useQuery({ queryKey: ['notes'], queryFn: fetchNotes });

/** Puts a saved note into the cached list, so the grid updates without a refetch. */
export const upsertNote = (queryClient: QueryClient, note: Note) =>
  queryClient.setQueryData<Note[]>(['notes'], (old = []) => [note, ...old.filter((n) => n.id !== note.id)]);

/** Every tag used on a note, sorted. */
export const noteTags = (notes: Note[]) => [...new Set(notes.flatMap((n) => n.tags))].sort();

/** Pinned first, then most recently updated. */
const byPinnedThenUpdated = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt;

/** Matches every word of the query against the title, body and tags; `#tag` must be a tag. */
function matchesSearch(note: Note, query: string): boolean {
  const haystack = `${note.title}\n${note.body}`.toLowerCase();
  const tags = note.tags.map((t) => t.toLowerCase());
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) =>
      word.startsWith('#') && word.length > 1
        ? tags.includes(word.slice(1))
        : haystack.includes(word) || tags.some((t) => t.includes(word))
    );
}

/** What "copy" copies: the body, or the title when there is no body. */
const noteText = (note: Pick<Note, 'title' | 'body'>) => (note.body.trim() ? note.body : note.title);

/** Copies the note as markdown, or as rendered HTML with the markdown as the plain-text fallback. */
export async function copyNote(note: Pick<Note, 'title' | 'body'>, rich: boolean): Promise<void> {
  const text = noteText(note);
  if (!rich) return navigator.clipboard.writeText(text);
  const html = renderToStaticMarkup(<MarkdownNotes text={text} />);
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    }),
  ]);
}

/** Copy button with a menu for the rich-text variant. */
const CopyButton: React.FC<{
  note: Pick<Note, 'title' | 'body'>;
  onCopied: (message: string) => void;
  className?: string;
}> = ({ note, onCopied, className = '' }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = (rich: boolean) => {
    setMenuOpen(false);
    copyNote(note, rich).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        onCopied(rich ? 'Copied as rich text' : 'Copied markdown');
      },
      () => onCopied('Copying failed')
    );
  };
  const buttonClass =
    'p-1 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';

  return (
    <div
      className={`relative inline-flex rounded-md ${className}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setMenuOpen(false);
      }}
    >
      <button
        type="button"
        disabled={!noteText(note).trim()}
        onClick={() => run(false)}
        aria-label="Copy markdown"
        title="Copy markdown"
        className={`${buttonClass} rounded-l-md`}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        disabled={!noteText(note).trim()}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="More copy options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className={`${buttonClass} px-0.5 rounded-r-md`}
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-40 p-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-lg text-xs"
        >
          {(
            [
              ['Copy markdown', false],
              ['Copy as rich text', true],
            ] as const
          ).map(([label, rich]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              onClick={() => run(rich)}
              className="w-full text-left px-2.5 py-1.5 rounded-md text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PinButton: React.FC<{ pinned: boolean; onToggle: () => void; className?: string }> = ({
  pinned,
  onToggle,
  className = '',
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={pinned}
    aria-label={pinned ? 'Unpin note' : 'Pin note'}
    title={pinned ? 'Unpin' : 'Pin to top'}
    className={`p-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer ${
      pinned ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
    } ${className}`}
  >
    <Pin className={`w-3.5 h-3.5 ${pinned ? 'fill-current' : ''}`} />
  </button>
);

/** Clicks on links, checkboxes and buttons inside a card act on their own instead of opening it. */
const isInnerControl = (target: EventTarget) => (target as HTMLElement).closest('a, button, input') !== null;

/** Masonry cards grow with their content up to this height; longer notes fade out. */
const MASONRY_BODY_LIMIT = 440;

interface NoteItemProps {
  note: Note;
  selected: boolean;
  onOpen: (id: string) => void;
  onTogglePin: (note: Note) => void;
  onCopied: (message: string) => void;
}

const NoteCard: React.FC<NoteItemProps & { layout: 'grid' | 'masonry'; colorStyle: ColorStyle }> = ({
  note,
  layout,
  colorStyle,
  selected,
  onOpen,
  onTogglePin,
  onCopied,
}) => {
  const grid = layout === 'grid';
  const tint = note.color !== null && colorStyle === 'tint';
  return (
    <article
      tabIndex={0}
      data-menu-note={note.id}
      aria-label={`Note: ${note.title || 'Untitled'}`}
      onClick={(e) => !isInnerControl(e.target) && onOpen(note.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(note.id)}
      style={note.color ? ({ '--note': note.color } as React.CSSProperties) : undefined}
      className={`group relative flex flex-col gap-2 p-3.5 rounded-xl bg-(--card-bg) border cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        tint
          ? // Like the Claude session cards: a wash of the colour, with a border in the same hue
            '[--card-bg:color-mix(in_srgb,var(--note)_9%,var(--color-white))] dark:[--card-bg:color-mix(in_srgb,var(--note)_12%,var(--color-zinc-900))] border-[color:color-mix(in_srgb,var(--note)_35%,transparent)] hover:border-[color:color-mix(in_srgb,var(--note)_60%,transparent)]'
          : `[--card-bg:var(--color-white)] dark:[--card-bg:var(--color-zinc-900)] border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 ${
              note.color ? 'border-t-[3px] border-t-(color:--note)! ' : ''
            }`
      } ${selected ? 'ring-2 ring-indigo-500' : ''} ${grid ? 'h-64' : 'mb-3 break-inside-avoid'}`}
    >
      <div className="flex items-start gap-2 min-h-6">
        <h3 className="flex-1 min-w-0 text-sm font-semibold text-zinc-900 dark:text-zinc-100 break-words">
          {note.title}
        </h3>
        <div
          className={`flex items-center gap-0.5 -mr-1 -mt-0.5 ${
            note.pinned ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
          }`}
        >
          <PinButton pinned={note.pinned} onToggle={() => onTogglePin(note)} />
          <CopyButton
            note={note}
            onCopied={onCopied}
            className={note.pinned ? 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : ''}
          />
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden" style={grid ? undefined : { maxHeight: MASONRY_BODY_LIMIT }}>
        {note.body.trim() ? (
          <div className="text-[13px] [&_.text-sm]:text-[13px]">
            <MarkdownNotes text={note.body} />
          </div>
        ) : (
          !note.title && <p className="text-xs italic text-zinc-400">Empty note</p>
        )}
        {/* Fades text running past the bottom; over empty space it is invisible */}
        <div
          aria-hidden
          className={`absolute inset-x-0 h-10 bg-linear-to-b from-transparent to-(--card-bg) pointer-events-none ${grid ? 'bottom-0' : ''}`}
          style={grid ? undefined : { top: MASONRY_BODY_LIMIT - 40 }}
        />
      </div>

      <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-zinc-400">
        <div className="flex-1 min-w-0 flex flex-wrap gap-1 overflow-hidden max-h-5">
          {note.tags.map((tag) => (
            <span key={tag} className={TAG_CLASS}>
              #{tag}
            </span>
          ))}
        </div>
        <span className="shrink-0" title={`Updated ${formatTimestamp(note.updatedAt)}`}>
          {formatRelativeTime(note.updatedAt)}
        </span>
      </div>
    </article>
  );
};

/** One-line summary of the body for list rows. */
const excerpt = (body: string) =>
  body
    .replace(/[#>*_`~]|\[[ xX]\]|^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

const NoteRow: React.FC<NoteItemProps> = ({ note, selected, onOpen, onTogglePin, onCopied }) => {
  const summary = excerpt(note.body);
  return (
    <div
      role="listitem"
      tabIndex={0}
      data-menu-note={note.id}
      aria-label={`Note: ${note.title || 'Untitled'}`}
      onClick={(e) => !isInnerControl(e.target) && onOpen(note.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen(note.id)}
      className={`group flex items-center gap-3 px-3 py-2 border-b border-zinc-200/70 dark:border-zinc-800/50 cursor-pointer hover:bg-zinc-100/70 dark:hover:bg-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
        selected ? 'bg-indigo-500/10' : ''
      }`}
    >
      <span
        aria-hidden
        className="w-[3px] self-stretch rounded-full shrink-0"
        style={{ backgroundColor: note.color ?? 'transparent' }}
      />
      <div className="flex-1 min-w-0 flex items-baseline gap-2 text-[13px]">
        <span className="shrink-0 max-w-[45%] truncate font-medium text-zinc-900 dark:text-zinc-100">
          {note.title || summary.slice(0, 80) || 'Empty note'}
        </span>
        {note.title && <span className="truncate text-zinc-500">{summary}</span>}
      </div>
      <div className="hidden sm:flex gap-1 shrink-0">
        {note.tags.slice(0, 3).map((tag) => (
          <span key={tag} className={TAG_CLASS}>
            #{tag}
          </span>
        ))}
      </div>
      <span className="w-20 shrink-0 text-right text-[11px] text-zinc-400" title={`Updated ${formatTimestamp(note.updatedAt)}`}>
        {formatRelativeTime(note.updatedAt)}
      </span>
      <div className="flex items-center gap-0.5">
        <PinButton
          pinned={note.pinned}
          onToggle={() => onTogglePin(note)}
          className={note.pinned ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}
        />
        <CopyButton note={note} onCopied={onCopied} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
      </div>
    </div>
  );
};

/** Toolbar button group with one option pressed, styled like the task list's layout switch. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string, React.FC<{ className?: string }>, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex p-0.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
    >
      {options.map(([option, text, Icon, title]) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          title={title}
          className={`inline-flex items-center gap-[5px] px-2 py-[3px] rounded-md transition-colors duration-150 cursor-pointer ${
            value === option
              ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'hover:text-zinc-800 dark:hover:text-zinc-200'
          }`}
        >
          <Icon className="w-[13px] h-[13px]" />
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}

/** The Notes page: a read-only grid of notes; clicking one opens it in the side panel. */
export const NotesView: React.FC<{
  search: string;
  /** Notes awaiting a deferred delete. */
  hiddenIds: ReadonlySet<string>;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  showToast: (message: string) => void;
}> = ({ search, hiddenIds, selectedId, onOpen, onNew, showToast }) => {
  const queryClient = useQueryClient();
  const { data = [], isLoading, isError, error } = useNotes();
  const [layout, setLayout] = useState<NotesLayout>(() => {
    const saved = localStorage.getItem(LAYOUT_KEY);
    return saved === 'masonry' || saved === 'list' ? saved : 'grid';
  });
  const [colorStyle, setColorStyle] = useState<ColorStyle>(() =>
    localStorage.getItem(COLOR_STYLE_KEY) === 'tint' ? 'tint' : 'border'
  );

  const all = useMemo(() => data.filter((n) => !hiddenIds.has(n.id)), [data, hiddenIds]);
  const shown = useMemo(
    () => all.filter((n) => matchesSearch(n, search)).sort(byPinnedThenUpdated),
    [all, search]
  );

  const togglePin = (note: Note) =>
    updateNote(note.id, { pinned: !note.pinned }).then(
      (saved) => upsertNote(queryClient, saved),
      (err) => showToast(errorMessage(err, 'Saving note failed'))
    );
  const itemProps = { onOpen, onTogglePin: togglePin, onCopied: showToast };
  // Tag suggestions for the side panel and the right-click menu, which only exist on this page
  const allTags = useMemo(() => noteTags(data), [data]);

  return (
    <>
      <datalist id={NOTE_TAG_LIST_ID}>
        {allTags.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.015em] truncate">Notes</h2>
          <span className="text-[13px] text-zinc-500 whitespace-nowrap">
            {search.trim() ? `${shown.length} of ${plural(all.length, 'note')}` : plural(all.length, 'note')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          {layout !== 'list' && (
            <Segmented
              label="Note colour style"
              value={colorStyle}
              options={[
                ['border', 'Edge', PanelTop, 'Colour as the top edge'],
                ['tint', 'Tint', PaintBucket, 'Colour as a tinted background'],
              ]}
              onChange={(value) => {
                setColorStyle(value);
                localStorage.setItem(COLOR_STYLE_KEY, value);
              }}
            />
          )}
          <Segmented
            label="Layout"
            value={layout}
            options={[
              ['grid', 'Grid', Grid2x2, 'Same-size cards'],
              ['masonry', 'Masonry', LayoutDashboard, 'Cards sized to fit'],
              ['list', 'List', List, 'List'],
            ]}
            onChange={(value) => {
              setLayout(value);
              localStorage.setItem(LAYOUT_KEY, value);
            }}
          />
          <button
            type="button"
            onClick={onNew}
            className={`${toolbarButtonClass} bg-indigo-600! hover:bg-indigo-500! text-white!`}
          >
            <Plus className="w-[13px] h-[13px]" />
            <span>New note</span>
          </button>
        </div>
      </div>

      {isError ? (
        <p className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm">
          {errorMessage(error, 'Failed to load notes')}
        </p>
      ) : isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-40 rounded-xl bg-zinc-200/60 dark:bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-zinc-500">
          {all.length === 0 ? 'No notes yet. Use New note to write one.' : 'No notes match this search.'}
        </p>
      ) : layout === 'list' ? (
        <div role="list" className="border-t border-zinc-200/70 dark:border-zinc-800/50">
          {shown.map((note) => (
            <NoteRow key={note.id} note={note} selected={note.id === selectedId} {...itemProps} />
          ))}
        </div>
      ) : (
        <div
          className={
            layout === 'grid'
              ? 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3'
              : 'columns-[260px] gap-3'
          }
        >
          {shown.map((note) => (
            <NoteCard key={note.id} note={note} layout={layout} colorStyle={colorStyle} selected={note.id === selectedId} {...itemProps} />
          ))}
        </div>
      )}
    </>
  );
};

const TEXT_SAVE_DELAY_MS = 600;

/**
 * Editor for one note, docked on the right. `noteId` null starts a new note, created on the
 * first change with content. Title and body save after a pause in typing, and on blur and close.
 */
export const NotePanel: React.FC<{
  noteId: string | null;
  onCreated: (id: string) => void;
  onDelete: (note: Note) => void;
  onClose: () => void;
  showToast: (message: string) => void;
}> = ({ noteId, onCreated, onDelete, onClose, showToast }) => {
  const queryClient = useQueryClient();
  const { data: notes = [] } = useNotes();
  const note = notes.find((n) => n.id === noteId) ?? null;

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [preview, setPreview] = useState(Boolean(note?.body.trim()));
  const [tagInput, setTagInput] = useState('');

  // Refs so the debounced and unmount saves see the latest values
  const idRef = useRef(noteId);
  const text = useRef({ title, body });
  text.current = { title, body };
  const saved = useRef({ title, body });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onCreated, showToast });
  callbacks.current = { onCreated, showToast };

  /** Saves in order; the first save of a new note creates it. */
  const persist = (patch: UpdateNoteInput) => {
    queue.current = queue.current
      .then(async () => {
        const id = idRef.current;
        const result = id ? await updateNote(id, patch) : await createNote(patch);
        if (!id) {
          idRef.current = result.id;
          callbacks.current.onCreated(result.id);
        }
        upsertNote(queryClient, result);
      })
      .catch((err) => callbacks.current.showToast(errorMessage(err, 'Saving note failed')));
  };

  const saveText = () => {
    const current = text.current;
    const patch: UpdateNoteInput = {};
    if (current.title !== saved.current.title) patch.title = current.title;
    if (current.body !== saved.current.body) patch.body = current.body;
    if (Object.keys(patch).length === 0) return;
    // Don't create a note until it has something in it
    if (!idRef.current && !current.title.trim() && !current.body.trim()) return;
    saved.current = current;
    persist(idRef.current ? patch : current);
  };

  /** Pin, colour and tags save straight away. */
  const change = (patch: UpdateNoteInput) => {
    if (!idRef.current) saved.current = text.current;
    persist(idRef.current ? patch : { ...text.current, ...patch });
  };

  useEffect(() => {
    const timer = setTimeout(saveText, TEXT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, body]);
  useEffect(() => saveText, []);
  // Pick up a rename made elsewhere (the right-click menu) unless the title has unsaved edits.
  // Compared trimmed, since the server trims what this panel saves.
  useEffect(() => {
    if (!note || text.current.title !== saved.current.title || note.title === saved.current.title.trim()) return;
    saved.current = { ...saved.current, title: note.title };
    setTitle(note.title);
  }, [note?.title]);

  const tags = note?.tags ?? [];
  const addTag = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = cleanTag(tagInput);
    if (tag && !tags.includes(tag)) change({ tags: [...tags, tag] });
    setTagInput('');
  };

  return (
    <DockedPanel
      title={note ? 'Note' : 'New note'}
      icon={<StickyNote className="w-4 h-4 text-amber-500 dark:text-amber-400" />}
      widthKey="dashboard_note_panel_width"
      onClose={onClose}
    >
      <div className="flex-1 min-h-0 flex flex-col gap-3 p-4 overflow-y-auto">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveText}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="Title (optional)"
          aria-label="Note title"
          maxLength={200}
          autoFocus={!note}
          className="w-full text-lg font-semibold bg-transparent border-b border-transparent focus:border-indigo-500 pb-1 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PinButton pinned={note?.pinned ?? false} onToggle={() => change({ pinned: !note?.pinned })} />
          <div role="group" aria-label="Note colour" className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => change({ color: null })}
              aria-label="No colour"
              aria-pressed={!note?.color}
              className={`w-4 h-4 rounded-full border border-zinc-300 dark:border-zinc-600 flex items-center justify-center cursor-pointer ${
                note?.color ? '' : 'ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-zinc-900'
              }`}
            >
              <X className="w-2.5 h-2.5 text-zinc-400" />
            </button>
            {PROJECT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => change({ color })}
                aria-label={`Colour ${color}`}
                aria-pressed={note?.color === color}
                className={`w-4 h-4 rounded-full cursor-pointer ${
                  note?.color === color ? 'ring-2 ring-offset-1 ring-indigo-500 dark:ring-offset-zinc-900' : ''
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <CopyButton note={{ title, body }} onCopied={showToast} />
            {note && (
              <button
                type="button"
                onClick={() => onDelete(note)}
                aria-label="Delete note"
                title="Delete note"
                className="p-1 rounded-md text-zinc-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className={TAG_CLASS}>
              #{tag}
              <button
                type="button"
                onClick={() => change({ tags: tags.filter((t) => t !== tag) })}
                aria-label={`Remove tag ${tag}`}
                className="hover:text-red-500 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <form onSubmit={addTag}>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              placeholder="+ Add tag"
              list={NOTE_TAG_LIST_ID}
              aria-label="Add tag"
              maxLength={50}
              className="text-xs px-2.5 py-0.5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 bg-transparent text-zinc-700 dark:text-zinc-200 focus:outline-none focus:border-indigo-500 w-24"
            />
          </form>
        </div>

        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              if (!preview) saveText();
              setPreview((p) => !p);
            }}
            className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
          >
            {preview ? <Edit3 className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{preview ? 'Edit' : 'Preview'}</span>
          </button>
        </div>

        {preview ? (
          <div
            onClick={(e) => !(e.target as HTMLElement).closest('a, input') && setPreview(false)}
            className="flex-1 min-h-[200px] p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 cursor-text"
          >
            {body.trim() ? (
              <MarkdownNotes text={body} />
            ) : (
              <p className="text-zinc-400 dark:text-zinc-500 italic text-xs">Nothing written yet. Click to edit.</p>
            )}
          </div>
        ) : (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={saveText}
            placeholder="Write in markdown…"
            aria-label="Note body"
            autoFocus={Boolean(note)}
            className="flex-1 min-h-[240px] w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 font-mono text-[13px] leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 resize-none"
          />
        )}
      </div>

      {note && (
        <div className="px-4 py-2.5 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Created {formatTimestamp(note.createdAt)}
          </span>
          <span>Updated {formatRelativeTime(note.updatedAt)}</span>
        </div>
      )}
    </DockedPanel>
  );
};
