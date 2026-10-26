import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, ArrowUpRight, Sparkles, ChevronRight } from 'lucide-react';
import { Task, Project, QuickLink, WidgetConfig } from '../../shared/types.ts';
import {
  completionsByDay,
  formatDayDate,
  formatRelativeTime,
  getTodayIso,
  projectProgress,
  staleTasks,
} from '../utils/taskUtils.ts';
import { fetchBackups, createBackup } from '../api.ts';
import { AdoSummaryPanel, EmptyNote, StaleList, TaskWidgetActions } from './TaskWidgets.tsx';
import { useAdoSync } from './AdoImport.tsx';
import { Dot, DockedPanel } from './ui.tsx';

export type HomeDrawerTab = 'trends' | 'projects' | 'stale' | 'ado' | 'scratchpad' | 'links';

const TAB_KEY = 'dashboard_home_drawer_tab';
const COLLAPSED_KEY = 'dashboard_home_drawer_collapsed';

export interface HomeDrawerProps {
  tasks: Task[];
  projects: Project[];
  scratchpad: string;
  quickLinks: QuickLink[];
  widgetConfig: WidgetConfig;
  taskWidgetActions: TaskWidgetActions;
  staleTaskDays: number;
  onSaveScratchpad: (content: string) => void;
  onConvertLineToTask: (lineText: string) => void;
  onCreateQuickLink: (title: string, url: string, category?: string) => void;
  onUpdateQuickLink: (id: string, title: string, url: string, category: string) => void;
  onDeleteQuickLink: (id: string) => void;
  onSelectProject: (projectId: string) => void;
  onOpenAdoImport: () => void;
}

/**
 * Home's bottom drawer: one tab each for trends, projects, stale tasks, Azure DevOps, the
 * scratchpad and quick links. Tabs follow the widget settings. The tab, and whether the panel is
 * collapsed (click the open tab again), are remembered per browser.
 */
export const HomeDrawer: React.FC<HomeDrawerProps> = (props) => {
  const tabs = useWidgetList(props);

  const [storedTab, setStoredTab] = useState(() => (localStorage.getItem(TAB_KEY) as HomeDrawerTab) || 'trends');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === '1');
  const tab = tabs.some(([id]) => id === storedTab) ? storedTab : tabs[0]?.[0];

  const selectTab = (id: HomeDrawerTab) => {
    const nextCollapsed = id === tab ? !collapsed : false;
    setStoredTab(id);
    setCollapsed(nextCollapsed);
    localStorage.setItem(TAB_KEY, id);
    localStorage.setItem(COLLAPSED_KEY, nextCollapsed ? '1' : '0');
  };

  return (
    <section aria-label="More" className="shrink-0 border-t border-zinc-200 dark:border-zinc-800 pt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <div role="tablist" aria-label="Home panels" className="flex flex-wrap items-center gap-1">
          {tabs.map(([id, label]) => {
            const active = id === tab;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-expanded={active ? !collapsed : undefined}
                onClick={() => selectTab(id)}
                title={active ? (collapsed ? 'Show panel' : 'Hide panel') : undefined}
                className={`px-2.5 py-[5px] rounded-md transition-colors duration-150 cursor-pointer ${
                  active
                    ? 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto">
          <BackupStatusLine compact />
        </span>
      </div>

      {tab && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${
            collapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
          }`}
        >
          <div role="tabpanel" inert={collapsed} className="min-h-0 overflow-hidden">
            <div className="@container max-h-[240px] overflow-auto pb-1">
              <WidgetBody id={tab} {...props} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

/** The widgets the settings leave shown, as [id, label] with live counts in the labels. */
const useWidgetList = ({ tasks, widgetConfig, staleTaskDays }: HomeDrawerProps) => {
  const { data: adoData } = useAdoSync();
  const staleCount = staleTasks(tasks, staleTaskDays).length;
  const reviewCount = (adoData?.items ?? []).filter((i) => i.role === 'reviewer').length;
  return (
    [
      ['trends', 'Trends', widgetConfig.showTrends],
      ['projects', 'Projects', widgetConfig.showTrends],
      ['stale', staleCount ? `Gone stale · ${staleCount}` : 'Gone stale', widgetConfig.showStale],
      ['ado', reviewCount ? `Azure DevOps · ${reviewCount} review` : 'Azure DevOps', widgetConfig.showAdo],
      ['scratchpad', 'Scratchpad', widgetConfig.showScratchpad],
      ['links', 'Quick links', widgetConfig.showQuickLinks],
    ] as const
  ).filter(([, , shown]) => shown);
};

const WidgetBody: React.FC<HomeDrawerProps & { id: HomeDrawerTab }> = ({ id, ...props }) => {
  const { tasks } = props;
  switch (id) {
    case 'trends':
      return <TrendsPanel tasks={tasks} />;
    case 'projects':
      return <ProjectsPanel tasks={tasks} projects={props.projects} onSelectProject={props.onSelectProject} />;
    case 'stale':
      return <StaleList tasks={tasks} days={props.staleTaskDays} actions={props.taskWidgetActions} />;
    case 'ado':
      return <AdoSummaryPanel tasks={tasks} onOpenAdoImport={props.onOpenAdoImport} />;
    case 'scratchpad':
      return (
        <ScratchpadPanel
          scratchpad={props.scratchpad}
          onSave={props.onSaveScratchpad}
          onConvertLineToTask={props.onConvertLineToTask}
        />
      );
    case 'links':
      return (
        <QuickLinksPanel
          quickLinks={props.quickLinks}
          onCreate={props.onCreateQuickLink}
          onUpdate={props.onUpdateQuickLink}
          onDelete={props.onDeleteQuickLink}
        />
      );
  }
};

const WIDGETS_COLLAPSED_KEY = 'dashboard_widgets_collapsed';

/**
 * Right-hand Widgets panel, docked beside the main view. Widgets flow in a grid that fits as
 * many columns as the width allows; each one collapses from its header. Width and collapsed
 * widgets are remembered per browser.
 */
export const WidgetsPanel: React.FC<HomeDrawerProps & { onClose: () => void }> = ({ onClose, ...props }) => {
  const widgets = useWidgetList(props);
  const [collapsed, setCollapsed] = useState<HomeDrawerTab[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(WIDGETS_COLLAPSED_KEY) ?? '[]');
    } catch {
      return [];
    }
  });

  const toggle = (id: HomeDrawerTab) => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    setCollapsed(next);
    localStorage.setItem(WIDGETS_COLLAPSED_KEY, JSON.stringify(next));
  };

  return (
    <DockedPanel title="Widgets" widthKey="dashboard_widgets_width" onClose={onClose}>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {widgets.length === 0 ? (
          <EmptyNote>All widgets are turned off in Settings.</EmptyNote>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-3">
            {widgets.map(([id, label]) => {
              const open = !collapsed.includes(id);
              return (
                <section
                  key={id}
                  aria-label={label}
                  className="min-w-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-950/40"
                >
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    aria-expanded={open}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors duration-150 cursor-pointer"
                  >
                    <ChevronRight className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
                    {label}
                  </button>
                  {open && (
                    <div className="@container px-3 pb-3">
                      <WidgetBody id={id} {...props} />
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </DockedPanel>
  );
};

const TREND_DAYS = 14;
const TREND_HEIGHT = 56;

/** Last 14 days: one bar per day (today highlighted), the total, and the change on the 14 days before. */
const TrendsPanel: React.FC<{ tasks: Task[] }> = ({ tasks }) => {
  const today = getTodayIso();
  const both = completionsByDay(tasks, TREND_DAYS * 2, today);
  const previous = both.slice(0, TREND_DAYS).reduce((sum, d) => sum + d.count, 0);
  const days = both.slice(TREND_DAYS);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  const max = Math.max(...days.map((d) => d.count), 1);
  const diff = total - previous;

  return (
    <div className="flex flex-wrap items-end gap-x-7 gap-y-2">
      <div aria-hidden className="flex items-end gap-[5px]" style={{ height: TREND_HEIGHT }}>
        {days.map((d) => (
          <span
            key={d.date}
            title={`${formatDayDate(d.date)}: ${d.count} ${d.count === 1 ? 'completion' : 'completions'}`}
            className={`w-3.5 rounded-t-[3px] ${
              d.count === 0
                ? 'bg-zinc-200 dark:bg-zinc-800'
                : d.date === today
                ? 'bg-indigo-700 dark:bg-indigo-300'
                : 'bg-indigo-500'
            }`}
            style={{ height: d.count === 0 ? 2 : Math.max(4, (d.count / max) * TREND_HEIGHT) }}
          />
        ))}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 pb-0.5">
        <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{total}</span> done in 14 days ·{' '}
        <span className={diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
          {diff > 0 ? '+' : ''}
          {diff} vs previous
        </span>
      </p>
      <table className="sr-only">
        <caption>Completions per day, last 14 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Completed</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th scope="row">
                {formatDayDate(d.date)}
                {d.date === today ? ' (today)' : ''}
              </th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Per-project progress bars, most open first; a row opens its project. */
const ProjectsPanel: React.FC<{
  tasks: Task[];
  projects: Project[];
  onSelectProject: (projectId: string) => void;
}> = ({ tasks, projects, onSelectProject }) => {
  if (projects.length === 0) return <EmptyNote>No projects yet. Add one from the sidebar.</EmptyNote>;
  return (
    <ul className="grid grid-cols-1 @sm:grid-cols-2 @3xl:grid-cols-3 gap-x-6 gap-y-1">
      {projectProgress(tasks, projects).map((row) => {
        const percent = row.total > 0 ? Math.round((row.done / row.total) * 100) : 0;
        const content = (
          <>
            <span className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 min-w-0">
                <Dot color={row.color} />
                <span className="truncate text-zinc-800 dark:text-zinc-200">{row.name}</span>
              </span>
              <span className="tabular-nums text-zinc-500 shrink-0">
                {row.done}/{row.total}
              </span>
            </span>
            <span aria-hidden className="mt-1.5 block h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <span
                className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                style={{ width: `${percent}%`, ...(row.color ? { backgroundColor: row.color } : {}) }}
              />
            </span>
          </>
        );
        const rowLabel = `${row.name}: ${row.done} of ${row.total} done`;
        return (
          <li key={row.projectId ?? 'none'}>
            {row.projectId ? (
              <button
                type="button"
                onClick={() => onSelectProject(row.projectId!)}
                aria-label={`${rowLabel}. Open project`}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-zinc-100/70 dark:hover:bg-zinc-900/60 transition-colors duration-150 cursor-pointer"
              >
                {content}
              </button>
            ) : (
              <div className="px-2 py-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

/** The scratchpad: autosaves while typing; the top line can become a task. */
const ScratchpadPanel: React.FC<{
  scratchpad: string;
  onSave: (content: string) => void;
  onConvertLineToTask: (lineText: string) => void;
}> = ({ scratchpad, onSave, onConvertLineToTask }) => {
  const [localScratchpad, setLocalScratchpad] = useState(scratchpad);
  const [savedIndicator, setSavedIndicator] = useState(false);

  // Autosave: debounce while typing, flush on blur, unmount (switching tabs) and page hide.
  // savedRef is the last value sent; server echoes of it must not overwrite newer typing.
  const savedRef = useRef(scratchpad);
  const latestRef = useRef(localScratchpad);
  latestRef.current = localScratchpad;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (scratchpad !== savedRef.current) {
      savedRef.current = scratchpad;
      setLocalScratchpad(scratchpad);
    }
  }, [scratchpad]);

  const flush = () => {
    if (latestRef.current === savedRef.current) return;
    savedRef.current = latestRef.current;
    onSaveRef.current(latestRef.current);
    setSavedIndicator(true);
    setTimeout(() => setSavedIndicator(false), 1800);
  };

  useEffect(() => {
    if (localScratchpad === savedRef.current) return;
    const timer = window.setTimeout(flush, 800);
    return () => window.clearTimeout(timer);
  }, [localScratchpad]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  // Turn the first non-empty line into a task and drop it from the scratchpad
  const promoteTopLine = () => {
    const lines = localScratchpad.split('\n');
    const index = lines.findIndex((l) => l.trim().length > 0);
    if (index === -1) return;
    onConvertLineToTask(lines[index].trim().replace(/^[-*•]\s*/, ''));
    setLocalScratchpad(lines.filter((_, i) => i !== index).join('\n')); // saved by the autosave effect
  };

  return (
    <div className="flex flex-col gap-2">
      <textarea
        rows={5}
        value={localScratchpad}
        onChange={(e) => setLocalScratchpad(e.target.value)}
        onBlur={flush}
        placeholder="Brain-dumps, meeting notes, rough ideas. 'Convert top line to Task' turns the first line into a task."
        aria-label="Scratchpad"
        className="w-full p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-[13px] font-mono text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500/60 resize-y"
      />
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={promoteTopLine}
          disabled={!localScratchpad.trim()}
          className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline disabled:cursor-default"
        >
          <Sparkles className="w-3 h-3" />
          Convert top line to Task
        </button>
        {savedIndicator && <span className="text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
    </div>
  );
};

const linkInputClass =
  'text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:border-indigo-500/60';

/** Quick links in a 4-column grid, with add, edit and delete. */
const QuickLinksPanel: React.FC<{
  quickLinks: QuickLink[];
  onCreate: (title: string, url: string, category?: string) => void;
  onUpdate: (id: string, title: string, url: string, category: string) => void;
  onDelete: (id: string) => void;
}> = ({ quickLinks, onCreate, onUpdate, onDelete }) => {
  const [formOpen, setFormOpen] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkCategory, setLinkCategory] = useState('Dev');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);

  const closeForm = () => {
    setFormOpen(false);
    setEditingLinkId(null);
    setLinkTitle('');
    setLinkUrl('');
  };

  const startEdit = (link: QuickLink) => {
    setEditingLinkId(link.id);
    setLinkTitle(link.title);
    setLinkUrl(link.url);
    setLinkCategory(link.category);
    setFormOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    const category = linkCategory.trim() || 'General';
    if (editingLinkId) onUpdate(editingLinkId, linkTitle.trim(), linkUrl.trim(), category);
    else onCreate(linkTitle.trim(), linkUrl.trim(), category);
    closeForm();
  };

  return (
    <div className="flex flex-col gap-2.5">
      {formOpen && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={linkTitle}
            onChange={(e) => setLinkTitle(e.target.value)}
            placeholder="Title (e.g. GitHub PRs)"
            aria-label={editingLinkId ? 'Link title' : 'New link title'}
            autoFocus
            className={linkInputClass}
          />
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="URL (e.g. github.com)"
            aria-label={editingLinkId ? 'Link URL' : 'New link URL'}
            className={`${linkInputClass} flex-1 min-w-48`}
          />
          <input
            type="text"
            value={linkCategory}
            onChange={(e) => setLinkCategory(e.target.value)}
            placeholder="Category"
            aria-label={editingLinkId ? 'Link category' : 'New link category'}
            className={`${linkInputClass} w-28`}
          />
          <button
            type="button"
            onClick={closeForm}
            className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
          >
            {editingLinkId ? 'Update link' : 'Save link'}
          </button>
        </form>
      )}

      {quickLinks.length > 0 && (
        <ul className="grid grid-cols-1 @sm:grid-cols-2 @4xl:grid-cols-4 gap-2">
          {quickLinks.map((link) => (
            <li
              key={link.id}
              className="group flex items-center gap-1 px-2.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 dark:hover:border-indigo-500/60 transition-colors duration-150"
            >
              <a href={link.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0" title={link.url}>
                <span className="flex items-center gap-1 text-xs font-medium text-zinc-800 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                  <span className="truncate">{link.title}</span>
                  <ArrowUpRight className="w-3 h-3 shrink-0 text-zinc-400" />
                </span>
                <span className="block truncate text-[11px] text-zinc-500">{link.category}</span>
              </a>
              <span className="hidden group-hover:flex group-focus-within:flex items-center">
                <button
                  type="button"
                  onClick={() => startEdit(link)}
                  aria-label={`Edit quick link ${link.title}`}
                  className="p-1 rounded-md text-zinc-400 hover:text-indigo-600 cursor-pointer"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(link.id)}
                  aria-label={`Delete quick link ${link.title}`}
                  className="p-1 rounded-md text-zinc-400 hover:text-red-500 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!formOpen && (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          aria-label="Add quick link"
          className="self-start inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          {quickLinks.length === 0 ? 'Add a link to your repos, local servers or dashboards' : 'Add link'}
        </button>
      )}
    </div>
  );
};

/** "Last backup 3 hours ago · Back up now"; `compact` is the quiet version for Home's drawer. */
export const BackupStatusLine: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['backups'], queryFn: fetchBackups });
  const backupNow = useMutation({
    mutationFn: createBackup,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  if (!data) return null;
  if (!data.enabled) {
    return <p className="text-xs text-zinc-500">Automatic backups are off (in-memory database).</p>;
  }

  const latest = data.backups[0];
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
      <span
        title={`Daily, before imports and before upgrades. Keeps the newest ${data.keep} in ${data.dir}. To restore: stop the server and copy a backup over the database file.`}
      >
        {latest ? `Last backup ${formatRelativeTime(latest.createdAt)}` : 'No backups yet'}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={() => backupNow.mutate()}
        disabled={backupNow.isPending}
        className={`${compact ? 'hover:text-zinc-800 dark:hover:text-zinc-200' : 'text-indigo-600 dark:text-indigo-400'} hover:underline cursor-pointer disabled:opacity-50`}
      >
        {backupNow.isPending ? 'Backing up…' : 'Back up now'}
      </button>
      {backupNow.isError && (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {backupNow.error.message}
        </span>
      )}
      {backupNow.isSuccess && !backupNow.isPending && (
        <span className="text-emerald-600 dark:text-emerald-400">Saved</span>
      )}
    </p>
  );
};
