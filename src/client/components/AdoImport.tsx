import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bug,
  CloudDownload,
  Crown,
  ExternalLink,
  GitPullRequest,
  Plus,
  RefreshCw,
  SquareCheck,
  SquareMenu,
  Trash2,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';
import { AdoItem, AdoProjectLink, AdoSyncResult, Project, Settings, UpdateSettingsInput } from '../../shared/types.ts';
import {
  fetchAdoItems,
  fetchAdoProjectLinks,
  fetchAdoWorkItemTypes,
  importAdoItems,
  saveAdoProjectLinks,
  updateTask,
} from '../api.ts';
import { formatRelativeTime } from '../utils/taskUtils.ts';

/** "Azure DevOps work item 123" / "Azure DevOps pull request 45" for an external id. */
export function externalLinkLabel(externalId: string): string {
  const [kind, id] = externalId.split('/');
  return `Azure DevOps ${kind === 'pr' ? 'pull request' : 'work item'} ${id}`;
}

/** Compact badge text ("#123" or "PR #45") for an Azure DevOps external id. */
export function externalShortLabel(externalId: string): string {
  const [kind, id] = externalId.split('/');
  return kind === 'pr' ? `PR #${id}` : `#${id}`;
}

/** Colour, icon and short label for an Azure DevOps item's type. */
function typeStyle(item: AdoItem): { label: string; icon: LucideIcon; className: string } {
  if (item.role === 'reviewer') return { label: 'Review', icon: GitPullRequest, className: 'text-violet-700 dark:text-violet-400' };
  if (item.type === 'Bug') return { label: 'Bug', icon: Bug, className: 'text-red-700 dark:text-red-400' };
  if (item.externalId.startsWith('pr/')) return { label: 'PR', icon: GitPullRequest, className: 'text-blue-700 dark:text-blue-500' };
  if (item.type === 'Epic') return { label: 'Epic', icon: Crown, className: 'text-orange-600 dark:text-orange-300' };
  if (item.type === 'Feature') return { label: 'Feature', icon: Trophy, className: 'text-purple-700 dark:text-purple-400' };
  if (item.type === 'Task') return { label: 'Task', icon: SquareCheck, className: 'text-yellow-600 dark:text-yellow-300' };
  return {
    label: item.type === 'Product Backlog Item' ? 'PBI' : item.type,
    icon: SquareMenu,
    className: 'text-sky-700 dark:text-sky-400',
  };
}

/** An Azure DevOps item's type as a coloured icon and short label. */
export const TypeLabel: React.FC<{ item: AdoItem; className?: string }> = ({ item, className = '' }) => {
  const { label, icon: Icon, className: colour } = typeStyle(item);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs truncate ${colour} ${className}`}
      title={item.role === 'reviewer' ? 'PR (review)' : item.type}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );
};

export const inputClass =
  'px-2.5 py-1.5 rounded-lg text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-400';
export const buttonClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 cursor-pointer disabled:opacity-50 disabled:cursor-default';

/** The last Azure DevOps check. Shared by the Overview card, project panels and import dialog. */
export function useAdoSync() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['adoItems'],
    queryFn: () => fetchAdoItems(),
    refetchInterval: 60_000, // cheap: the server answers from its stored result
    retry: false,
  });
  const refresh = useMutation({
    mutationFn: () => fetchAdoItems(true),
    onSuccess: (data) => queryClient.setQueryData(['adoItems'], data),
    // The server keeps the failure alongside the previous result
    onError: () => queryClient.invalidateQueries({ queryKey: ['adoItems'] }),
  });
  return { ...query, refresh };
}

/** Saves the whole project mapping list. */
export function useSaveAdoLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveAdoProjectLinks,
    onSuccess: (next) => {
      queryClient.setQueryData(['adoProjectLinks'], next);
      // The default type list is the union over mapped projects
      queryClient.invalidateQueries({ queryKey: ['adoWorkItemTypes', ''] });
    },
  });
}

/** Imports items as tasks, then shows them as imported. */
export function useImportAdoItems(onImported: (count: number) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importAdoItems,
    onSuccess: ({ importedCount }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['adoItems'] });
      onImported(importedCount);
    },
  });
}

/** "Checked 5 min ago", plus why the last check failed if it did. */
export const AdoSyncStatus: React.FC<{ data: AdoSyncResult | undefined; refreshing: boolean }> = ({
  data,
  refreshing,
}) => (
  <span className="text-xs text-zinc-400">
    {refreshing
      ? 'Asking Azure DevOps\u2026'
      : data?.checkedAt
        ? `Checked ${formatRelativeTime(data.checkedAt)}`
        : 'Not checked yet'}
    {!refreshing && data?.error && (
      <span className="text-amber-700 dark:text-amber-300">
        {' \u00b7 '}Last check failed{data.lastErrorAt ? ` ${formatRelativeTime(data.lastErrorAt)}` : ''}:{' '}
        {data.error}
      </span>
    )}
  </span>
);

/**
 * Work item types or states as removable chips, picked from those Azure DevOps reports. Free text
 * is only accepted while that list is unavailable (az failing), so a typo can't silently match nothing.
 */
export const WorkItemFieldPicker: React.FC<{
  value: string[];
  onChange: (values: string[]) => void;
  field?: 'types' | 'states';
  /** Values for this project; omit for the default list (all mapped projects). */
  project?: string;
  placeholder: string;
  label: string;
}> = ({ value, onChange, field = 'types', project, placeholder, label }) => {
  const listId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, error: loadError } = useQuery({
    queryKey: ['adoWorkItemTypes', project ?? ''],
    queryFn: () => fetchAdoWorkItemTypes(project),
    staleTime: Infinity, // the server caches them until "Refresh types"
    retry: false,
  });
  // Empty when az gave nothing back: treat as unavailable rather than refusing everything
  const options = data?.[field]?.length ? data[field] : undefined;
  const noun = field === 'states' ? 'state' : 'work item type';

  const where = project ? ` in ${project}` : '';
  const known = (type: string) => options?.find((o) => o.toLowerCase() === type.trim().toLowerCase());
  const add = (raw: string) => {
    const type = raw.trim();
    if (!type) return;
    if (!data && !loadError) {
      setError(`Still loading the ${noun}s\u2026`);
      return;
    }
    const match = options ? known(type) : type;
    if (!match) {
      setError(`"${type}" is not a ${noun}${where}.`);
      return;
    }
    if (!value.some((v) => v.toLowerCase() === match.toLowerCase())) onChange([...value, match]);
    setText('');
    setError(null);
  };

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus-within:border-indigo-400">
        {value.map((type) => {
          const unknown = options !== undefined && !known(type);
          return (
            <span
              key={type}
              title={unknown ? `Not a ${noun}${where}` : undefined}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                unknown
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                  : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70'
              }`}
            >
              {type}
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== type))}
                aria-label={`Remove ${type}`}
                className="hover:text-red-500 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          value={text}
          list={listId}
          aria-label={label}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            // Picking a datalist suggestion replaces the text in one go: add it straight away
            const inputType = (e.nativeEvent as InputEvent).inputType;
            if ((inputType === 'insertReplacementText' || inputType === undefined) && known(e.target.value)) {
              add(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          className="flex-1 min-w-24 bg-transparent text-sm focus:outline-none"
        />
        <datalist id={listId}>
          {options
            ?.filter((o) => !value.some((v) => v.toLowerCase() === o.toLowerCase()))
            .map((o) => <option key={o} value={o} />)}
        </datalist>
      </div>
      {(error || loadError) && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {error ?? `Could not load ${noun}s: ${loadError?.message}`}
        </p>
      )}
    </div>
  );
};

const SYNC_INTERVALS: [number, string][] = [
  [0, 'Off'],
  [15, '15 minutes'],
  [30, '30 minutes'],
  [60, 'Hour'],
  [120, '2 hours'],
];

/** Settings > Integrations: organization, default work item types and project mappings. */
export const AdoSettings: React.FC<{
  settings: Settings;
  projects: Project[];
  onSave: (input: UpdateSettingsInput) => void;
}> = ({ settings, projects, onSave }) => {
  const queryClient = useQueryClient();
  const [newProject, setNewProject] = useState('');
  const { data: links = [] } = useQuery({ queryKey: ['adoProjectLinks'], queryFn: fetchAdoProjectLinks });
  const save = useSaveAdoLinks();
  const sync = useAdoSync();

  // Shares the default picker's query; fetchedAt says how old the server's cached types are
  const { data: defaultTypes } = useQuery({
    queryKey: ['adoWorkItemTypes', ''],
    queryFn: () => fetchAdoWorkItemTypes(),
    staleTime: Infinity,
    retry: false,
  });
  const refreshTypes = useMutation({
    mutationFn: () => fetchAdoWorkItemTypes(undefined, true),
    // Every picker reloads from the server's now-fresh cache
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adoWorkItemTypes'] }),
  });

  const update = (index: number, change: Partial<AdoProjectLink>) =>
    save.mutate(links.map((l, i) => (i === index ? { ...l, ...change } : l)));

  const addProject = () => {
    const name = newProject.trim();
    if (!name) return;
    save.mutate([...links, { adoProject: name, projectId: null, workItemTypes: null, ignoredStates: null }], {
      onSuccess: () => setNewProject(''),
    });
  };

  return (
    <div className="space-y-3">
      <span className="text-zinc-600 dark:text-zinc-300">Azure DevOps</span>
      <label className="flex items-center gap-4">
        <span className="w-32 shrink-0 text-zinc-600 dark:text-zinc-300">Organization</span>
        <input
          key={settings.adoOrganization}
          type="url"
          defaultValue={settings.adoOrganization}
          placeholder="az devops default"
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value !== settings.adoOrganization) onSave({ adoOrganization: value });
          }}
          className={`${inputClass} flex-1 min-w-0`}
        />
      </label>
      <div className="flex items-start gap-4">
        <span className="w-32 shrink-0 pt-1.5 text-zinc-600 dark:text-zinc-300">Work item types</span>
        <WorkItemFieldPicker
          value={settings.adoWorkItemTypes}
          onChange={(types) => onSave({ adoWorkItemTypes: types })}
          placeholder="Choose types"
          label="Default work item types"
        />
      </div>
      <div className="flex items-start gap-4">
        <span className="w-32 shrink-0 pt-1.5 text-zinc-600 dark:text-zinc-300">Ignored states</span>
        <WorkItemFieldPicker
          field="states"
          value={settings.adoIgnoredStates}
          onChange={(states) => onSave({ adoIgnoredStates: states })}
          placeholder="e.g. Ready for QA"
          label="Default ignored states"
        />
      </div>
      <label className="flex items-center gap-4">
        <span className="w-32 shrink-0 text-zinc-600 dark:text-zinc-300">Check every</span>
        <select
          value={settings.adoSyncMinutes}
          onChange={(e) => onSave({ adoSyncMinutes: Number(e.target.value) })}
          className={inputClass}
        >
          {SYNC_INTERVALS.map(([minutes, label]) => (
            <option key={minutes} value={minutes}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={settings.adoLinkedProjectsOnly}
          onChange={(e) => onSave({ adoLinkedProjectsOnly: e.target.checked })}
          className="rounded text-indigo-600"
        />
        Only fetch projects mapped to a Dashboard project
      </label>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <AdoSyncStatus data={sync.data} refreshing={sync.refresh.isPending} />
        <button
          type="button"
          onClick={() => sync.refresh.mutate()}
          disabled={sync.refresh.isPending}
          className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          <RefreshCw className={`w-3 h-3 ${sync.refresh.isPending ? 'animate-spin' : ''}`} />
          Check now
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
        <span>
          {refreshTypes.isPending
            ? 'Asking Azure DevOps for work item types\u2026'
            : defaultTypes?.fetchedAt
              ? `Types updated ${formatRelativeTime(defaultTypes.fetchedAt)}`
              : 'Types not loaded yet'}
        </span>
        <button
          type="button"
          onClick={() => refreshTypes.mutate()}
          disabled={refreshTypes.isPending}
          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          <RefreshCw className={`w-3 h-3 ${refreshTypes.isPending ? 'animate-spin' : ''}`} />
          Refresh types
        </button>
        {refreshTypes.isError && (
          <span className="text-amber-700 dark:text-amber-300">{refreshTypes.error.message}</span>
        )}
      </div>
      <p className="text-xs text-zinc-400">
        Uses your az login. Pull requests are fetched for listed and linked projects only. Changes apply
        from the next check. ADO projects linked to a Dashboard project are set up in that project&apos;s
        settings; the ones below import to the Inbox unless given a project.
      </p>
      {links.some((l) => l.projectId) && (
        <p className="text-xs text-zinc-500">
          Linked:{' '}
          {links
            .filter((l) => l.projectId)
            .map((l) => `${l.adoProject} → ${projects.find((p) => p.id === l.projectId)?.name ?? '?'}`)
            .join(', ')}
        </p>
      )}

      {save.isError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {save.error.message}
        </p>
      )}
      {links.some((l) => !l.projectId) && (
        <ul className="space-y-2">
          {links.map((link, i) => link.projectId ? null : (
            <li
              key={link.adoProject}
              className="space-y-2 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  defaultValue={link.adoProject}
                  aria-label="Azure DevOps project"
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== link.adoProject) update(i, { adoProject: name });
                  }}
                  className={`${inputClass} flex-1 min-w-0`}
                />
                <span aria-hidden="true" className="text-zinc-400">
                  →
                </span>
                <select
                  value={link.projectId ?? ''}
                  aria-label={`Dashboard project for ${link.adoProject}`}
                  onChange={(e) => update(i, { projectId: e.target.value || null })}
                  className={`${inputClass} w-36`}
                >
                  <option value="">Inbox</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove ${link.adoProject}`}
                  onClick={() => save.mutate(links.filter((_, j) => j !== i))}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <WorkItemFieldPicker
                project={link.adoProject}
                value={link.workItemTypes ?? []}
                // No chips means "use the default types"
                onChange={(types) => update(i, { workItemTypes: types.length ? types : null })}
                placeholder="Default types"
                label={`Work item types for ${link.adoProject}`}
              />
              <WorkItemFieldPicker
                field="states"
                project={link.adoProject}
                value={link.ignoredStates ?? []}
                onChange={(states) => update(i, { ignoredStates: states.length ? states : null })}
                placeholder="Default ignored states"
                label={`Ignored states for ${link.adoProject}`}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addProject();
        }}
      >
        <input
          type="text"
          value={newProject}
          onChange={(e) => setNewProject(e.target.value)}
          placeholder="Azure DevOps project name"
          aria-label="New Azure DevOps project"
          className={`${inputClass} flex-1 min-w-0`}
        />
        <button type="submit" className={buttonClass} disabled={!newProject.trim()}>
          <Plus className="w-3.5 h-3.5" />
          Add project
        </button>
      </form>
    </div>
  );
};

/** Unfinished tasks whose source closed (or reached an ignored state), each with a Complete button. */
export const AdoClosedList: React.FC<{ closed: AdoSyncResult['closed'] }> = ({ closed }) => {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: (taskIds: string[]) => Promise.all(taskIds.map((id) => updateTask(id, { status: 'done' }))),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // The server drops completed tasks from the stored list
      queryClient.invalidateQueries({ queryKey: ['adoItems'] });
    },
  });
  if (closed.length === 0) return null;
  return (
    <section className="space-y-2 p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
          Closed in Azure DevOps
        </h3>
        <button
          type="button"
          className={buttonClass}
          disabled={complete.isPending}
          onClick={() => complete.mutate(closed.map((c) => c.taskId))}
        >
          Complete all
        </button>
      </div>
      <ul className="space-y-1">
        {closed.map((c) => (
          <li key={c.taskId} className="flex items-center gap-2">
            <span className="flex-1 truncate">{c.title}</span>
            <span className="text-xs text-zinc-500">{c.state}</span>
            <button
              type="button"
              className={buttonClass}
              disabled={complete.isPending}
              onClick={() => complete.mutate([c.taskId])}
            >
              Complete
            </button>
          </li>
        ))}
      </ul>
      {complete.isError && <p className="text-xs text-red-600 dark:text-red-400">{complete.error.message}</p>}
    </section>
  );
};

/** "Fetch from Azure DevOps": pick open items to import, and complete tasks whose source closed. */
export const AdoImportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onImported: (count: number) => void;
}> = ({ open, onClose, projects, onImported }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (open) setSelected(new Set());
  }, [open]);

  // Shows the last background check; Refresh asks Azure DevOps again
  const { data, error, isLoading, refresh } = useAdoSync();
  const { data: links = [] } = useQuery({
    queryKey: ['adoProjectLinks'],
    queryFn: fetchAdoProjectLinks,
    enabled: open,
  });
  useEffect(() => {
    if (open) queryClient.invalidateQueries({ queryKey: ['adoItems'] });
  }, [open, queryClient]);

  const importMutation = useImportAdoItems((count) => {
    onImported(count);
    onClose();
  });

  const groups = useMemo(() => {
    const byProject = new Map<string, (AdoItem & { taskId: string | null })[]>();
    for (const item of data?.items ?? []) {
      const list = byProject.get(item.adoProject) ?? [];
      list.push(item);
      byProject.set(item.adoProject, list);
    }
    return [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const newItems = (data?.items ?? []).filter((i) => !i.taskId);
  const linkFor = (adoProject: string) =>
    links.find((l) => l.adoProject.toLowerCase() === adoProject.toLowerCase());
  // Changing a destination here saves the mapping in Settings, so later imports use it too
  const saveLinks = useSaveAdoLinks();
  const setDestination = (adoProject: string, projectId: string | null) => {
    const existing = linkFor(adoProject);
    if (!existing && !projectId) return; // unmapped already goes to the Inbox
    saveLinks.mutate(
      existing
        ? links.map((l) => (l === existing ? { ...l, projectId } : l))
        : [...links, { adoProject, projectId, workItemTypes: null, ignoredStates: null }]
    );
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
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="ado-dialog-title"
      className="m-auto w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      {open && (
        <div className="flex flex-col max-h-[85vh] text-sm">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <h2 id="ado-dialog-title" className="flex items-center gap-2 text-base font-semibold">
              <CloudDownload className="w-4 h-4 text-indigo-500" />
              Fetch from Azure DevOps
            </h2>
            <div className="flex items-center gap-1">
              <AdoSyncStatus data={data} refreshing={refresh.isPending} />
              <button
                type="button"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
                aria-label="Refresh"
                title="Check Azure DevOps now"
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${refresh.isPending ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {isLoading && <p className="text-zinc-500">{'Asking Azure DevOps\u2026'}</p>}
            {(refresh.error ?? error) && (
              <p role="alert" className="text-red-600 dark:text-red-400">
                {(refresh.error ?? error)?.message}
              </p>
            )}
            {data?.warnings.map((w) => (
              <p key={w} className="text-xs text-amber-700 dark:text-amber-300">
                {w}
              </p>
            ))}

            {data && <AdoClosedList closed={data.closed} />}

            {data?.checkedAt && data.items.length === 0 && (
              <p className="text-zinc-500">Nothing open is assigned to you.</p>
            )}
            {groups.map(([adoProject, items]) => {
              const selectable = items.filter((i) => !i.taskId).map((i) => i.externalId);
              const allOn = selectable.length > 0 && selectable.every((id) => selected.has(id));
              return (
                <section key={adoProject} className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <label className="flex items-center gap-2 font-semibold uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={allOn}
                        disabled={selectable.length === 0}
                        onChange={(e) => toggle(selectable, e.target.checked)}
                      />
                      {adoProject || 'Unknown project'}
                    </label>
                    {adoProject && (
                      <>
                        <span aria-hidden="true">→</span>
                        <select
                          value={linkFor(adoProject)?.projectId ?? ''}
                          onChange={(e) => setDestination(adoProject, e.target.value || null)}
                          disabled={saveLinks.isPending}
                          aria-label={`Dashboard project for ${adoProject}`}
                          className="px-1.5 py-0.5 rounded-md text-xs bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 focus:outline-none focus:border-indigo-400 cursor-pointer"
                        >
                          <option value="">Inbox</option>
                          {projects.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </>
                    )}
                  </div>
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {items.map((item) => (
                      <li key={item.externalId} className="flex items-center gap-2 py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Import ${item.title}`}
                          checked={!!item.taskId || selected.has(item.externalId)}
                          disabled={!!item.taskId}
                          onChange={(e) => toggle([item.externalId], e.target.checked)}
                        />
                        <TypeLabel item={item} className="shrink-0 w-28" />
                        <span className={`flex-1 truncate ${item.taskId ? 'text-zinc-400' : ''}`} title={item.title}>
                          {item.title}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {item.taskId ? 'Imported' : item.state}
                        </span>
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
                </section>
              );
            })}
          </div>

          <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <span className="text-xs text-red-600 dark:text-red-400">
              {importMutation.error?.message ?? saveLinks.error?.message ?? ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={newItems.length === 0}
                onClick={() => toggle(newItems.map((i) => i.externalId), selected.size < newItems.length)}
              >
                {selected.size < newItems.length ? 'Select all' : 'Select none'}
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || importMutation.isPending}
                onClick={() => importMutation.mutate(newItems.filter((i) => selected.has(i.externalId)))}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                Import {selected.size || ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
};
