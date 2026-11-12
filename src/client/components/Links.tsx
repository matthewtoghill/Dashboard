import React, { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppWindow, Check, ExternalLink, EyeOff, FileText, FolderPlus, Globe, Link2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { BROWSER_LABELS, Browser, Link, LinkGroup, isFileUrl } from '../../shared/types.ts';
import {
  addLinks,
  createLinkGroup,
  deleteLinkGroup,
  deleteLinks,
  fetchLinkGroups,
  openLinks,
  renameLinkGroup,
  updateLink,
} from '../api.ts';
import { errorMessage, plural } from '../utils/taskUtils.ts';

const QUERY_KEY = ['link-groups'];
/** The picked browser lasts for this browser tab's session only. */
const BROWSER_KEY = 'dashboard_links_browser';
const PRIVATE_KEY = 'dashboard_links_private';
const DEFAULT_BROWSER: Browser = 'chrome';

const inputClass =
  'px-2 py-1 rounded-md text-xs bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-primary-400';
const buttonClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-primary-400 cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:border-zinc-200 dark:disabled:hover:border-zinc-800';
const primaryButtonClass =
  'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary-600 hover:bg-primary-500 text-white cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-primary-600';
const iconButtonClass = 'p-1 rounded-md text-zinc-400 cursor-pointer';

/** A web link without its scheme, or a file link as a Windows path. */
const displayUrl = (url: string) =>
  isFileUrl(url)
    ? decodeURIComponent(new URL(url).pathname.slice(1)).replace(/\//g, '\\')
    : url.replace(/^https?:\/\//i, '');

/** A link's title, or its address when it has none. */
const linkLabel = (link: Link) => link.title || displayUrl(link.url);

/** Pasted lines, one URL or file path each; paths may contain spaces, so lines aren't split further. */
const splitLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

function matches(group: LinkGroup, link: Link, query: string): boolean {
  const haystack = `${group.name}\n${link.title}\n${link.url}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/** A checkbox that can show "some ticked". */
const Checkbox: React.FC<{
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  id?: string;
}> = ({ checked, indeterminate = false, onChange, label, id }) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      id={id}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={label}
      className="rounded text-primary-600 cursor-pointer shrink-0"
    />
  );
};

interface LinksViewProps {
  search: string;
  /** Links and groups waiting out the undo window of a delete. */
  hiddenIds: ReadonlySet<string>;
  showToast: (message: string) => void;
  /** Hides `ids` at once and runs `commit` after the undo window, with an undo toast. */
  onDelete: (ids: string[], message: string, commit: () => Promise<unknown>) => void;
}

/**
 * Named groups of links. Tick links or whole groups, pick a browser, then open them as tabs or
 * together in a new window. The server starts the browser, so any installed one can be used.
 */
export const LinksView: React.FC<LinksViewProps> = ({ search, hiddenIds, showToast, onDelete }) => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: QUERY_KEY, queryFn: fetchLinkGroups });
  const browsers = data?.browsers ?? [];
  const [picked, setPicked] = useState<Browser>(() => (sessionStorage.getItem(BROWSER_KEY) as Browser) || DEFAULT_BROWSER);
  // Fall back to the first installed browser when the picked one isn't installed here
  const browser = browsers.length && !browsers.includes(picked) ? browsers[0] : picked;
  const [privateWindow, setPrivateWindow] = useState(() => sessionStorage.getItem(PRIVATE_KEY) === '1');
  // Windows can't ask an unknown default browser for a private window
  const isPrivate = privateWindow && browser !== 'default';
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [newGroupName, setNewGroupName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups = (data?.groups ?? [])
    .filter((g) => !hiddenIds.has(g.id))
    .map((g) => ({ ...g, links: g.links.filter((l) => !hiddenIds.has(l.id)) }));
  const query = search.trim();
  const shown = groups
    .map((g) => ({ ...g, links: query ? g.links.filter((l) => matches(g, l, query)) : g.links }))
    .filter((g) => !query || g.links.length > 0);
  const linkCount = groups.reduce((n, g) => n + g.links.length, 0);
  // In page order, so links open in the order they're listed
  const selectedIds = groups.flatMap((g) => g.links.filter((l) => selected.has(l.id)).map((l) => l.id));

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const putGroup = (group: LinkGroup) =>
    queryClient.setQueryData<typeof data>(QUERY_KEY, (old) =>
      old && { ...old, groups: old.groups.some((g) => g.id === group.id) ? old.groups.map((g) => (g.id === group.id ? group : g)) : [...old.groups, group] }
    );
  const fail = (fallback: string) => (err: unknown) => showToast(errorMessage(err, fallback));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const pickBrowser = (value: Browser) => {
    setPicked(value);
    sessionStorage.setItem(BROWSER_KEY, value);
  };

  const open = async (target: 'tab' | 'window') => {
    setBusy(true);
    try {
      const { openedCount } = await openLinks({ ids: selectedIds, browser, target, private: isPrivate });
      showToast(`Opened ${plural(openedCount, 'link')} in ${isPrivate ? 'a private ' : ''}${BROWSER_LABELS[browser]}${isPrivate ? ' window' : ''}`);
    } catch (err) {
      fail('Opening links failed')(err);
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = () => {
    const ids = selectedIds;
    toggle(ids, false);
    onDelete(ids, `Removed ${plural(ids.length, 'link')}`, () => deleteLinks(ids));
  };

  const removeGroup = (group: LinkGroup) => {
    toggle(group.links.map((l) => l.id), false);
    onDelete([group.id], `Deleted group "${group.name}"`, () => deleteLinkGroup(group.id));
  };

  const submitNewGroup = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newGroupName?.trim();
    if (!name) return;
    setNewGroupName(null);
    createLinkGroup(name).then(({ group }) => putGroup(group), fail('Creating group failed'));
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="text-[22px] font-semibold tracking-[-0.015em] truncate">Links</h2>
          <span className="text-[13px] text-zinc-500 whitespace-nowrap">
            {plural(groups.length, 'group')}, {plural(linkCount, 'link')}
          </span>
        </div>
        <button type="button" className={buttonClass} onClick={() => setNewGroupName('')}>
          <FolderPlus className="w-3.5 h-3.5" />
          New group
        </button>
      </div>

      {/* Open bar: what's ticked, which browser, and how */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur text-xs">
        <span className="text-zinc-600 dark:text-zinc-300 font-medium min-w-[88px]">
          {selectedIds.length ? `${plural(selectedIds.length, 'link')} selected` : 'Select links to open'}
        </span>
        {selectedIds.length > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer">
            Clear
          </button>
        )}
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-zinc-500">
          Browser
          <select
            value={browser}
            onChange={(e) => pickBrowser(e.target.value as Browser)}
            disabled={browsers.length === 0}
            className={inputClass}
          >
            {(browsers.length ? browsers : [browser]).map((b) => (
              <option key={b} value={b}>
                {BROWSER_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
        <label
          className={`inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 ${browser === 'default' ? 'opacity-50' : 'cursor-pointer'}`}
          title={browser === 'default' ? "The system default browser can't open private windows; pick a named browser" : 'Open in an incognito / InPrivate window'}
        >
          <input
            type="checkbox"
            checked={isPrivate}
            disabled={browser === 'default'}
            onChange={(e) => {
              setPrivateWindow(e.target.checked);
              sessionStorage.setItem(PRIVATE_KEY, e.target.checked ? '1' : '0');
            }}
            className="rounded text-primary-600"
          />
          <EyeOff className="w-3.5 h-3.5" />
          Private
        </label>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!selectedIds.length || busy || browsers.length === 0}
          onClick={() => void open('tab')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open in new tabs
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={!selectedIds.length || busy || browsers.length === 0 || browser === 'default'}
          title={browser === 'default' ? 'The system default browser can only open tabs; pick a named browser' : undefined}
          onClick={() => void open('window')}
        >
          <AppWindow className="w-3.5 h-3.5" />
          Open in new window
        </button>
        <button type="button" className={buttonClass} disabled={!selectedIds.length} onClick={removeSelected}>
          <Trash2 className="w-3.5 h-3.5 text-red-500" />
          Remove
        </button>
      </div>
      {data && browsers.length === 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Opening links needs the Dashboard server to run on Windows with a supported browser installed.
        </p>
      )}

      {newGroupName !== null && (
        <form onSubmit={submitNewGroup} className="flex items-center gap-2">
          <input
            autoFocus
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setNewGroupName(null)}
            placeholder="Group name, e.g. Start of day"
            maxLength={100}
            className={`${inputClass} w-64 text-sm`}
          />
          <button type="submit" className={primaryButtonClass} disabled={!newGroupName.trim()}>
            Create
          </button>
          <button type="button" className={buttonClass} onClick={() => setNewGroupName(null)}>
            Cancel
          </button>
        </form>
      )}

      {!isLoading && groups.length === 0 && newGroupName === null && (
        <div className="flex flex-col items-center gap-2 py-16 text-sm text-zinc-500">
          <Link2 className="w-6 h-6 text-zinc-400" />
          No link groups yet.
          <button type="button" className={buttonClass} onClick={() => setNewGroupName('')}>
            <FolderPlus className="w-3.5 h-3.5" />
            Create your first group
          </button>
        </div>
      )}
      {query && groups.length > 0 && shown.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">No links match "{query}".</p>
      )}

      <div className="grid grid-cols-1 min-[1200px]:grid-cols-2 gap-3 items-start">
        {shown.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            selected={selected}
            onToggle={toggle}
            onRename={(name) => renameLinkGroup(group.id, name).then(({ group: g }) => putGroup(g), fail('Renaming group failed'))}
            onDelete={() => removeGroup(group)}
            onAdd={(links) =>
              addLinks(group.id, links).then(
                ({ group: g }) => !!putGroup(g),
                (err) => {
                  fail('Adding links failed')(err);
                  return false;
                }
              )
            }
            onUpdateLink={(id, link) => updateLink(id, link).then(refresh, fail('Saving link failed'))}
            onRemoveLink={(link) => {
              toggle([link.id], false);
              onDelete([link.id], `Removed "${linkLabel(link)}"`, () => deleteLinks([link.id]));
            }}
          />
        ))}
      </div>
    </>
  );
};

const GroupCard: React.FC<{
  group: LinkGroup;
  selected: ReadonlySet<string>;
  onToggle: (ids: string[], on: boolean) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** Resolves true once the links are saved. */
  onAdd: (links: { url: string; title?: string }[]) => Promise<boolean>;
  onUpdateLink: (id: string, link: { url: string; title: string }) => void;
  onRemoveLink: (link: Link) => void;
}> = ({ group, selected, onToggle, onRename, onDelete, onAdd, onUpdateLink, onRemoveLink }) => {
  const ids = group.links.map((l) => l.id);
  const tickedCount = ids.filter((id) => selected.has(id)).length;
  const checkboxId = useId();
  const allTicked = ids.length > 0 && tickedCount === ids.length;
  const [renaming, setRenaming] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  const submitAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    void onAdd([{ url: url.trim(), title: title.trim() }]).then((saved) => {
      if (!saved) return; // keep what was typed so it can be fixed
      setUrl('');
      setTitle('');
    });
  };

  return (
    <section className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
      <header className="group/header flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
        <Checkbox
          id={checkboxId}
          checked={allTicked}
          indeterminate={tickedCount > 0 && !allTicked}
          onChange={() => onToggle(ids, !allTicked)}
          label={`Select all links in ${group.name}`}
        />
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get('name')?.toString().trim();
              if (name && name !== group.name) onRename(name);
              setRenaming(false);
            }}
          >
            <input
              name="name"
              autoFocus
              defaultValue={group.name}
              maxLength={100}
              onBlur={(e) => e.currentTarget.form?.requestSubmit()}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              className={`${inputClass} w-full text-sm font-semibold`}
            />
          </form>
        ) : (
          // The title ticks or unticks the whole group, like the checkbox beside it
          <h3 className="flex-1 min-w-0 truncate text-sm font-semibold">
            <label htmlFor={checkboxId} className="cursor-pointer select-none">
              {group.name}
            </label>
          </h3>
        )}
        <span className="text-[11px] text-zinc-500">{plural(group.links.length, 'link')}</span>
        <button
          type="button"
          onClick={() => setRenaming(true)}
          aria-label={`Rename ${group.name}`}
          title="Rename group"
          className={`${iconButtonClass} hover:text-primary-600`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${group.name}`}
          title="Delete group and its links"
          className={`${iconButtonClass} hover:text-red-500`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </header>

      <ul className="flex flex-col py-1">
        {group.links.map((link) =>
          editingId === link.id ? (
            <LinkEditor
              key={link.id}
              link={link}
              onSave={(next) => {
                onUpdateLink(link.id, next);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <li key={link.id} className="group/link flex items-center gap-2 px-3 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
              <label className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer" title={link.url}>
                <Checkbox
                  checked={selected.has(link.id)}
                  onChange={() => onToggle([link.id], !selected.has(link.id))}
                  label={`Select ${linkLabel(link)}`}
                />
                {isFileUrl(link.url) ? (
                  <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-label="Local file" />
                ) : (
                  <Globe className="w-3.5 h-3.5 shrink-0 text-zinc-400" aria-label="Web link" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{linkLabel(link)}</span>
                  {link.title && <span className="block truncate text-[11px] text-zinc-500">{displayUrl(link.url)}</span>}
                </span>
              </label>
              <span className="flex opacity-0 group-hover/link:opacity-100 group-focus-within/link:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditingId(link.id)}
                  aria-label={`Edit ${linkLabel(link)}`}
                  className={`${iconButtonClass} hover:text-primary-600`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveLink(link)}
                  aria-label={`Remove ${linkLabel(link)}`}
                  className={`${iconButtonClass} hover:text-red-500`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          )
        )}
      </ul>

      <form onSubmit={submitAdd} className="flex items-center gap-1.5 px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          // A text input drops line breaks, so a multi-line paste is added straight away, one link per line
          onPaste={(e) => {
            const lines = splitLines(e.clipboardData.getData('text'));
            if (lines.length < 2) return;
            e.preventDefault();
            void onAdd(lines.map((line) => ({ url: line })));
          }}
          placeholder="Add a URL or file path, like C:\Docs\spec.pdf (paste several lines to add them all)"
          aria-label={`Add links to ${group.name}`}
          className={`${inputClass} flex-1 min-w-0`}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          aria-label="Link title"
          maxLength={200}
          className={`${inputClass} w-36`}
        />
        <button type="submit" disabled={!url.trim()} aria-label="Add link" className={`${buttonClass} px-2`}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </form>
    </section>
  );
};

const LinkEditor: React.FC<{
  link: Link;
  onSave: (link: { url: string; title: string }) => void;
  onCancel: () => void;
}> = ({ link, onSave, onCancel }) => {
  const [url, setUrl] = useState(() => (isFileUrl(link.url) ? displayUrl(link.url) : link.url));
  const [title, setTitle] = useState(link.title);
  return (
    <li className="px-3 py-1">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onSave({ url: url.trim(), title: title.trim() });
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" maxLength={200} autoFocus className={`${inputClass} w-36`} />
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL or file path" aria-label="URL or file path" className={`${inputClass} flex-1 min-w-0`} />
        <button type="submit" aria-label="Save link" className={`${iconButtonClass} hover:text-emerald-600`}>
          <Check className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={onCancel} aria-label="Cancel" className={`${iconButtonClass} hover:text-zinc-700`}>
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    </li>
  );
};
