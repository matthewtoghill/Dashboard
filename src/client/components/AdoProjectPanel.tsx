import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Download, GitPullRequest, Link2Off, RefreshCw } from 'lucide-react';
import { AdoItem, Project, Task } from '../../shared/types.ts';
import { fetchAdoProjectLinks } from '../api.ts';
import { formatRelativeTime } from '../utils/taskUtils.ts';
import {
  AdoClosedList,
  buttonClass,
  externalLinkLabel,
  externalShortLabel,
  inputClass,
  TypeLabel,
  useAdoSync,
  useImportAdoItems,
  useSaveAdoLinks,
  WorkItemFieldPicker,
} from './AdoImport.tsx';

type PanelItem = AdoItem & { taskId: string | null };
type GroupBy = 'none' | 'type' | 'state' | 'adoProject';
type SortBy = 'id' | 'title' | 'type' | 'state';

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

/**
 * The project settings dialog's Azure DevOps mappings: link and unlink ADO projects, and set their
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

const ADO_ROW_GRID = 'grid grid-cols-[18px_90px_70px_minmax(0,1fr)_136px_70px] gap-3 items-center';

/**
 * A project view's Azure DevOps inbox: items from the last check for the ADO projects mapped to
 * this project and not yet imported. New work items start ticked; Import brings in the ticked ones.
 * Hidden when the project has none or has Azure DevOps off.
 */
export const AdoProjectPanel: React.FC<{
  project: Project;
  tasks: Task[];
  onImported: (count: number) => void;
}> = ({ project, tasks, onImported }) => {
  const openKey = `${OPEN_KEY}_${project.id}`;
  const [open, setOpen] = useState(() => (localStorage.getItem(openKey) ?? localStorage.getItem(OPEN_KEY)) !== '0');
  // Ticks the user changed, for the check they were made against; a new check starts over
  const [picked, setPicked] = useState<{ checkedAt: number | null; ids: Set<string> } | null>(null);

  const { data, refresh } = useAdoSync();
  const { data: links = [] } = useQuery({ queryKey: ['adoProjectLinks'], queryFn: fetchAdoProjectLinks });
  const importItems = useImportAdoItems((count) => {
    setPicked(null);
    onImported(count);
  });

  const mine = links.filter((l) => l.projectId === project.id);
  const names = new Set(mine.map((l) => l.adoProject.toLowerCase()));
  const items = (data?.items ?? []).filter((i) => names.has(i.adoProject.toLowerCase()));
  const projectTaskIds = new Set(tasks.filter((t) => t.projectId === project.id).map((t) => t.id));
  const closed = (data?.closed ?? []).filter((c) => projectTaskIds.has(c.taskId));
  const [[, shown]] = arrangeAdoItems(items, {
    search: '',
    type: '',
    state: '',
    showImported: false,
    sortBy: 'id',
    groupBy: 'none',
  });
  const checkedAt = data?.checkedAt ?? null;
  const selected = picked && picked.checkedAt === checkedAt ? picked.ids : new Set<string>();
  const toImport = shown.filter((i) => selected.has(i.externalId));
  const newCount = shown.filter((i) => i.role !== 'reviewer').length;
  const reviewCount = shown.length - newCount;

  // Linking happens in the project settings dialog
  if (!project.adoEnabled || mine.length === 0) return null;

  const toggleOpen = () => {
    localStorage.setItem(openKey, open ? '0' : '1');
    setOpen(!open);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked({ checkedAt, ids: next });
  };

  return (
    <section className="rounded-[10px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0f0f12] text-[13px]">
      <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          className="inline-flex items-center gap-2.5 cursor-pointer"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-zinc-500 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
          />
          <GitPullRequest className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">Azure DevOps</span>
        </button>
        <span className="text-xs text-zinc-500">
          {mine.map((l) => l.adoProject).join(', ')} ·{' '}
          {refresh.isPending
            ? 'checking…'
            : checkedAt
            ? `checked ${formatRelativeTime(checkedAt)}`
            : 'not checked yet'}
        </span>
        {newCount > 0 && (
          <span className="px-[7px] py-px rounded-full text-[11px] bg-sky-500/15 text-sky-700 dark:text-sky-300">
            {newCount} new
          </span>
        )}
        {reviewCount > 0 && (
          <span className="px-[7px] py-px rounded-full text-[11px] bg-violet-500/15 text-violet-700 dark:text-violet-300">
            {reviewCount} review
          </span>
        )}
        {closed.length > 0 && (
          <span className="px-[7px] py-px rounded-full text-[11px] bg-amber-500/15 text-amber-700 dark:text-amber-300">
            {closed.length} closed
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-label="Check Azure DevOps now"
          title="Check Azure DevOps now"
          className="p-1 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-[13px] h-[13px] ${refresh.isPending ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          disabled={toImport.length === 0 || importItems.isPending}
          onClick={() => importItems.mutate(toImport)}
          className="inline-flex items-center gap-1.5 px-2.5 py-[5px] rounded-[7px] bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default disabled:hover:bg-indigo-600"
        >
          <Download className="w-3 h-3" />
          Import {toImport.length}
        </button>
      </div>

      {open && (
        <div className="border-t border-zinc-200 dark:border-[#1f1f23]">
          {[refresh.error, importItems.error].map(
            (err) =>
              err && (
                <p key={err.message} role="alert" className="px-3.5 pt-2 text-xs text-red-600 dark:text-red-400">
                  {err.message}
                </p>
              )
          )}
          {data?.error && !refresh.isPending && (
            <p className="px-3.5 pt-2 text-xs text-amber-700 dark:text-amber-300 truncate" title={data.error}>
              Last check failed: {data.error}
            </p>
          )}
          {data?.warnings.map((w) => (
            <p key={w} className="px-3.5 pt-2 text-xs text-amber-700 dark:text-amber-300">
              {w}
            </p>
          ))}
          {closed.length > 0 && (
            <div className="px-3.5 pt-2.5">
              <AdoClosedList closed={closed} />
            </div>
          )}

          {shown.length === 0 ? (
            <p className="px-3.5 py-2.5 text-xs text-zinc-500">
              {items.length === 0 ? 'Nothing open is assigned to you in these projects.' : 'Everything here is imported.'}
            </p>
          ) : (
            <ul>
              {shown.map((item, index) => {
                const checked = selected.has(item.externalId);
                const [kind, id] = item.externalId.split('/');
                return (
                  <li
                    key={item.externalId}
                    className={`${ADO_ROW_GRID} px-3.5 py-2 ${index > 0 ? 'border-t border-zinc-100 dark:border-zinc-900' : ''}`}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Import ${item.title}`}
                      onClick={() => toggle(item.externalId)}
                      className={`w-[15px] h-[15px] rounded border flex items-center justify-center cursor-pointer transition-colors duration-150 ${
                        checked ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-500'
                      }`}
                    >
                      {checked && <Check className="w-[10px] h-[10px] stroke-[3]" />}
                    </button>
                    <TypeLabel item={item} />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      title={externalLinkLabel(item.externalId)}
                      className="font-mono text-xs text-zinc-500 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                    >
                      {kind === 'pr' ? `PR ${id}` : id}
                    </a>
                    <span className="truncate text-zinc-800 dark:text-zinc-200" title={item.title}>
                      {item.title}
                    </span>
                    <span className="truncate text-xs text-zinc-400" title={item.repo ?? undefined}>
                      {item.repo}
                    </span>
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-400" title={item.state}>
                      {item.state}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
