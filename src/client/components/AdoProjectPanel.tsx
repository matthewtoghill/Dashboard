import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ExternalLink, GitPullRequest, Link2Off, RefreshCw, Settings2 } from 'lucide-react';
import { AdoItem, Project, Task } from '../../shared/types.ts';
import { fetchAdoProjectLinks } from '../api.ts';
import {
  AdoClosedList,
  AdoSyncStatus,
  buttonClass,
  externalLinkLabel,
  externalShortLabel,
  inputClass,
  useAdoSync,
  useImportAdoItems,
  useSaveAdoLinks,
  WorkItemFieldPicker,
} from './AdoImport.tsx';

type PanelItem = AdoItem & { taskId: string | null };
type GroupBy = 'none' | 'type' | 'state' | 'adoProject';
type SortBy = 'id' | 'title' | 'type' | 'state';

const GROUP_LABELS: Record<GroupBy, string> = { none: 'No grouping', type: 'Type', state: 'State', adoProject: 'Project' };
const SORT_LABELS: Record<SortBy, string> = { id: 'Newest', title: 'Title', type: 'Type', state: 'State' };
const OPEN_KEY = 'dashboard_ado_panel_open';

const itemNumber = (item: PanelItem) => Number(item.externalId.split('/')[1]);
const itemType = (item: PanelItem) => (item.role === 'reviewer' ? 'PR (review)' : item.type);

/** Filters, sorts and groups panel items. Pure, so it is tested directly. */
export function arrangeAdoItems(
  items: PanelItem[],
  options: { search: string; type: string; state: string; showImported: boolean; sortBy: SortBy; groupBy: GroupBy }
): [string, PanelItem[]][] {
  const search = options.search.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (options.showImported || !i.taskId) &&
      (!options.type || itemType(i) === options.type) &&
      (!options.state || i.state === options.state) &&
      (!search || i.title.toLowerCase().includes(search) || externalShortLabel(i.externalId).includes(search))
  );
  const key: Record<SortBy, (i: PanelItem) => string> = {
    id: () => '',
    title: (i) => i.title,
    type: itemType,
    state: (i) => i.state,
  };
  shown.sort((a, b) => key[options.sortBy](a).localeCompare(key[options.sortBy](b)) || itemNumber(b) - itemNumber(a));
  if (options.groupBy === 'none') return [['', shown]];
  const groups = new Map<string, PanelItem[]>();
  for (const item of shown) {
    const name = options.groupBy === 'type' ? itemType(item) : item[options.groupBy] || 'Unknown';
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

const selectClass =
  'px-2 py-1 rounded-lg text-xs bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 focus:outline-none focus:border-indigo-400 cursor-pointer';

/**
 * A project's Azure DevOps mappings: link and unlink ADO projects, and set their
 * types and ignored states. A saved change checks again, since it alters what a check returns.
 */
export const AdoProjectLinksEditor: React.FC<{ project: Project }> = ({ project }) => {
  const [newLink, setNewLink] = useState('');
  const { data, refresh } = useAdoSync();
  const { data: links = [] } = useQuery({ queryKey: ['adoProjectLinks'], queryFn: fetchAdoProjectLinks });
  const saveLinks = useSaveAdoLinks();
  const save = (next: typeof links) => saveLinks.mutate(next, { onSuccess: () => refresh.mutate() });

  const mine = links.filter((l) => l.projectId === project.id);
  // Unmapped ADO projects, from Settings or seen in the last check, offered when linking
  const linkable = [
    ...new Set([
      ...links.filter((l) => !l.projectId).map((l) => l.adoProject),
      ...(data?.items ?? []).map((i) => i.adoProject).filter((p) => !links.some((l) => l.adoProject === p)),
    ]),
  ].sort();

  const linkProject = () => {
    const name = newLink.trim();
    if (!name) return;
    const existing = links.find((l) => l.adoProject.toLowerCase() === name.toLowerCase());
    save(
      existing
        ? links.map((l) => (l === existing ? { ...l, projectId: project.id } : l))
        : [...links, { adoProject: name, projectId: project.id, workItemTypes: null, ignoredStates: null }]
    );
    setNewLink('');
  };
  const updateLink = (adoProject: string, change: Partial<(typeof links)[number]>) =>
    save(links.map((l) => (l.adoProject === adoProject ? { ...l, ...change } : l)));

  return (
    <div className="space-y-3">
      {saveLinks.error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {saveLinks.error.message}
        </p>
      )}
      {mine.length === 0 && (
        <p className="text-xs text-zinc-500">
          Link an Azure DevOps project to see its work in {project.name} and import it here.
        </p>
      )}
      {mine.map((link) => (
        <div key={link.adoProject} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 font-medium">{link.adoProject}</span>
            <button
              type="button"
              onClick={() => updateLink(link.adoProject, { projectId: null })}
              className={buttonClass}
              disabled={saveLinks.isPending}
            >
              <Link2Off className="w-3.5 h-3.5" />
              Unlink
            </button>
          </div>
          <WorkItemFieldPicker
            project={link.adoProject}
            value={link.workItemTypes ?? []}
            onChange={(v) => updateLink(link.adoProject, { workItemTypes: v.length ? v : null })}
            placeholder="Default types"
            label={`Work item types for ${link.adoProject}`}
          />
          <WorkItemFieldPicker
            field="states"
            project={link.adoProject}
            value={link.ignoredStates ?? []}
            onChange={(v) => updateLink(link.adoProject, { ignoredStates: v.length ? v : null })}
            placeholder="Default ignored states"
            label={`Ignored states for ${link.adoProject}`}
          />
        </div>
      ))}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          linkProject();
        }}
      >
        <input
          type="text"
          list={`ado-linkable-${project.id}`}
          value={newLink}
          onChange={(e) => setNewLink(e.target.value)}
          placeholder="Azure DevOps project name"
          aria-label="Link an Azure DevOps project"
          className={`${inputClass} flex-1 min-w-0`}
        />
        <datalist id={`ado-linkable-${project.id}`}>
          {linkable.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button type="submit" className={buttonClass} disabled={!newLink.trim() || saveLinks.isPending}>
          Link project
        </button>
      </form>
      <p className="text-xs text-zinc-400">Defaults and the check interval are under Settings &gt; Integrations.</p>
    </div>
  );
};

/**
 * A project view's Azure DevOps section: items from the last check for the ADO projects mapped to
 * this project, with import, refresh, and the mapping's settings. Hidden until Azure DevOps is used.
 */
export const AdoProjectPanel: React.FC<{
  project: Project;
  tasks: Task[];
  onImported: (count: number) => void;
  onOpenTask: (taskId: string) => void;
}> = ({ project, tasks, onImported, onOpenTask }) => {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [showImported, setShowImported] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('id');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');

  const { data, refresh } = useAdoSync();
  const { data: links = [] } = useQuery({ queryKey: ['adoProjectLinks'], queryFn: fetchAdoProjectLinks });
  const importItems = useImportAdoItems((count) => {
    setSelected(new Set());
    onImported(count);
  });

  const mine = links.filter((l) => l.projectId === project.id);
  const names = new Set(mine.map((l) => l.adoProject.toLowerCase()));
  const items = (data?.items ?? []).filter((i) => names.has(i.adoProject.toLowerCase()));
  const projectTaskIds = new Set(tasks.filter((t) => t.projectId === project.id).map((t) => t.id));
  const closed = (data?.closed ?? []).filter((c) => projectTaskIds.has(c.taskId));
  const groups = arrangeAdoItems(items, { search, type, state, showImported, sortBy, groupBy });
  const newItems = items.filter((i) => !i.taskId);
  const shownNew = groups.flatMap(([, list]) => list).filter((i) => !i.taskId);
  const types = [...new Set(items.map(itemType))].sort();
  const states = [...new Set(items.map((i) => i.state))].sort();

  // Only shown once Azure DevOps is in use
  if (links.length === 0 && !data?.checkedAt) return null;

  const toggleOpen = () => {
    localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    setOpen(!open);
  };
  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-2xs text-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="inline-flex items-center gap-2 font-medium cursor-pointer"
        >
          {open ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />}
          <GitPullRequest className="w-4 h-4 text-sky-500" />
          Azure DevOps
          {mine.length > 0 && (
            <span className="text-xs font-normal text-zinc-400">{mine.map((l) => l.adoProject).join(', ')}</span>
          )}
        </button>
        {newItems.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300">
            {newItems.length} new
          </span>
        )}
        {closed.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[11px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
            {closed.length} closed
          </span>
        )}
        <span className="flex-1" />
        <AdoSyncStatus data={data} refreshing={refresh.isPending} />
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-label="Check Azure DevOps now"
          title="Check Azure DevOps now"
          className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(!editing);
            if (!open) toggleOpen();
          }}
          aria-pressed={editing}
          aria-label="Azure DevOps settings for this project"
          title="Azure DevOps settings for this project"
          className={`p-1.5 rounded-lg cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            editing ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-500'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
          {refresh.error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {refresh.error.message}
            </p>
          )}
          {importItems.error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {importItems.error.message}
            </p>
          )}

          {(editing || mine.length === 0) && (
            <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/40">
              <AdoProjectLinksEditor project={project} />
            </div>
          )}

          <AdoClosedList closed={closed} />

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter"
              aria-label="Filter Azure DevOps items"
              className="px-2 py-1 rounded-lg text-xs bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-400 w-36"
            />
            <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className={selectClass}>
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className={selectClass}>
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              aria-label="Group by"
              className={selectClass}
            >
              {Object.entries(GROUP_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              aria-label="Sort by"
              className={selectClass}
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  Sort: {label}
                </option>
              ))}
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={showImported}
                onChange={(e) => setShowImported(e.target.checked)}
                className="rounded text-indigo-600"
              />
              Show imported
            </label>
            <span className="flex-1" />
            <button
              type="button"
              className={buttonClass}
              disabled={shownNew.length === 0}
              onClick={() =>
                toggle(
                  shownNew.map((i) => i.externalId),
                  !shownNew.every((i) => selected.has(i.externalId))
                )
              }
            >
              {shownNew.length > 0 && shownNew.every((i) => selected.has(i.externalId)) ? 'Select none' : 'Select all'}
            </button>
            <button
              type="button"
              disabled={selected.size === 0 || importItems.isPending}
              onClick={() => importItems.mutate(newItems.filter((i) => selected.has(i.externalId)))}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              Import {selected.size || ''}
            </button>
          </div>

          {data?.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
          {groups.every(([, list]) => list.length === 0) ? (
            <p className="text-xs text-zinc-500">
              {items.length === 0
                ? 'Nothing open is assigned to you in these projects.'
                : 'No items match these filters.'}
            </p>
          ) : (
            groups.map(([name, list]) => (
              <div key={name} className="space-y-1">
                {name && (
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    {name} <span className="font-normal">({list.length})</span>
                  </h4>
                )}
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((item) => (
                    <li key={item.externalId} className="flex items-center gap-2 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Import ${item.title}`}
                        checked={!!item.taskId || selected.has(item.externalId)}
                        disabled={!!item.taskId}
                        onChange={(e) => toggle([item.externalId], e.target.checked)}
                      />
                      <span className="shrink-0 w-14 text-xs text-zinc-400 tabular-nums">
                        {externalShortLabel(item.externalId)}
                      </span>
                      <span className="shrink-0 w-24 truncate text-xs text-zinc-500" title={itemType(item)}>
                        {itemType(item)}
                      </span>
                      <span className={`flex-1 truncate ${item.taskId ? 'text-zinc-400' : ''}`} title={item.title}>
                        {item.title}
                      </span>
                      <span className="shrink-0 text-xs text-zinc-400">{item.state}</span>
                      {item.taskId && (
                        <button
                          type="button"
                          onClick={() => onOpenTask(item.taskId!)}
                          className="shrink-0 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          Open task
                        </button>
                      )}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${externalLinkLabel(item.externalId)}`}
                        title={externalLinkLabel(item.externalId)}
                        className="p-1 text-zinc-400 hover:text-indigo-600"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
