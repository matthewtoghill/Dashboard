import React, { useState, useEffect, useRef } from 'react';
import {
  Flame,
  CheckCircle2,
  AlertTriangle,
  CalendarCheck,
  StickyNote,
  ExternalLink,
  Plus,
  Trash2,
  ArrowUpRight,
  Download,
  Upload,
  Settings2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  FileJson,
  FileSpreadsheet,
} from 'lucide-react';
import {
  Task,
  Project,
  QuickLink,
  WidgetConfig,
  BackupPayload,
} from '../../shared/types.ts';
import {
  computeDashboardStats,
  tasksToCsv,
} from '../utils/taskUtils.ts';
import { exportDashboardData, ImportResult } from '../api.ts';

interface DashboardWidgetsProps {
  mode: 'full' | 'compact';
  tasks: Task[];
  projects: Project[];
  scratchpad: string;
  quickLinks: QuickLink[];
  widgetConfig: WidgetConfig;
  onSaveScratchpad: (content: string) => void;
  onConvertLineToTask: (lineText: string) => void;
  onCreateQuickLink: (title: string, url: string, category?: string) => void;
  onDeleteQuickLink: (id: string) => void;
  onUpdateWidgetConfig: (config: Partial<WidgetConfig>) => void;
  onImportBackup: (payload: BackupPayload) => Promise<ImportResult>;
  onSelectSmartView?: (view: 'today' | 'inbox' | 'completed') => void;
}

export const DashboardWidgets: React.FC<DashboardWidgetsProps> = ({
  mode,
  tasks,
  projects,
  scratchpad,
  quickLinks,
  widgetConfig,
  onSaveScratchpad,
  onConvertLineToTask,
  onCreateQuickLink,
  onDeleteQuickLink,
  onUpdateWidgetConfig,
  onImportBackup,
  onSelectSmartView,
}) => {
  const stats = computeDashboardStats(tasks);

  const [localScratchpad, setLocalScratchpad] = useState(scratchpad);
  const [scratchpadSavedIndicator, setScratchpadSavedIndicator] = useState(false);

  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [linkCategory, setLinkCategory] = useState('Dev');

  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scratchpad autosave: debounce while typing, flush on blur, unmount and page hide.
  // savedRef is the last value sent; server echoes of it must not overwrite newer typing.
  const savedRef = useRef(scratchpad);
  const latestRef = useRef(localScratchpad);
  latestRef.current = localScratchpad;
  const onSaveRef = useRef(onSaveScratchpad);
  onSaveRef.current = onSaveScratchpad;

  useEffect(() => {
    if (scratchpad !== savedRef.current) {
      savedRef.current = scratchpad;
      setLocalScratchpad(scratchpad);
    }
  }, [scratchpad]);

  const flushScratchpad = () => {
    if (latestRef.current === savedRef.current) return;
    savedRef.current = latestRef.current;
    onSaveRef.current(latestRef.current);
    setScratchpadSavedIndicator(true);
    setTimeout(() => setScratchpadSavedIndicator(false), 1800);
  };

  useEffect(() => {
    if (localScratchpad === savedRef.current) return;
    const timer = window.setTimeout(flushScratchpad, 800);
    return () => window.clearTimeout(timer);
  }, [localScratchpad]);

  useEffect(() => {
    window.addEventListener('pagehide', flushScratchpad);
    return () => {
      window.removeEventListener('pagehide', flushScratchpad);
      flushScratchpad();
    };
  }, []);

  const handleScratchpadBlur = flushScratchpad;

  // Convert the first non-empty line or selected line of scratchpad into a task
  const handlePromoteScratchpadLine = () => {
    const lines = localScratchpad
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const firstLine = lines[0].replace(/^[-*•]\s*/, '');
    onConvertLineToTask(firstLine);

    const remaining = localScratchpad
      .split('\n')
      .filter((l, idx) => {
        const firstNonEmptyIdx = localScratchpad
          .split('\n')
          .findIndex((line) => line.trim().length > 0);
        return idx !== firstNonEmptyIdx;
      })
      .join('\n');

    setLocalScratchpad(remaining); // saved by the autosave effect
  };

  const handleAddLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle.trim() || !linkUrl.trim()) return;
    onCreateQuickLink(linkTitle.trim(), linkUrl.trim(), linkCategory.trim() || 'General');
    setLinkTitle('');
    setLinkUrl('');
    setIsAddingLink(false);
  };

  const handleExportJson = async () => {
    const data = await exportDashboardData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = tasksToCsv(tasks, projects);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    let parsed: BackupPayload;
    try {
      parsed = JSON.parse(await file.text()) as BackupPayload;
    } catch {
      setImportStatus('Invalid JSON backup file.');
      return;
    }
    setImportStatus('Importing…');
    try {
      const result = await onImportBackup(parsed);
      setImportStatus(
        `Backup restored: ${result.importedTasks} tasks, ${result.importedProjects} projects, ` +
          `${result.importedQuickLinks} links added (existing items were left unchanged).`
      );
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  // Ring SVG math
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (stats.completionRate / 100) * circumference;

  // Compact collapsible summary bar above task views
  if (mode === 'compact') {
    return (
      <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-900 shadow-2xs overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
              <span className="font-semibold text-zinc-800 dark:text-zinc-100">
                {stats.completionRate}% of current tasks done
              </span>
              <span className="text-zinc-400">
                ({stats.totalCompleted}/{stats.totalActive + stats.totalCompleted})
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{stats.completedToday} done today</span>
            </div>

            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
              <Flame className="w-3.5 h-3.5" />
              <span>{stats.streakDays}d streak</span>
            </div>

            {stats.overdueCount > 0 && (
              <button
                type="button"
                onClick={() => onSelectSmartView?.('today')}
                className="flex items-center gap-1.5 text-red-600 dark:text-red-400 font-medium hover:underline cursor-pointer"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{stats.overdueCount} overdue</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() =>
              onUpdateWidgetConfig({
                showHeaderSummary: !widgetConfig.showHeaderSummary,
              })
            }
            aria-label="Toggle summary widgets"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <span>{widgetConfig.showHeaderSummary ? 'Hide Widgets' : 'Show Widgets'}</span>
            {widgetConfig.showHeaderSummary ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {widgetConfig.showHeaderSummary && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 border-t border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/40">
            {/* Mini Scratchpad */}
            <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  <StickyNote className="w-3.5 h-3.5 text-amber-500" />
                  <span>Quick Scratchpad</span>
                </span>
                {localScratchpad.trim() && (
                  <button
                    type="button"
                    onClick={handlePromoteScratchpadLine}
                    className="inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    title="Convert top line into a task"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>+ Task from top line</span>
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={localScratchpad}
                onChange={(e) => setLocalScratchpad(e.target.value)}
                onBlur={handleScratchpadBlur}
                placeholder="Jot down quick thoughts or notes..."
                aria-label="Quick scratchpad"
                className="w-full text-xs p-2 rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>

            {/* Mini Quick Links */}
            <div className="p-3 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Quick Links</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingLink((v) => !v)}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  + Add Link
                </button>
              </div>

              {isAddingLink ? (
                <form onSubmit={handleAddLinkSubmit} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="Label"
                    aria-label="Quick link title"
                    className="w-24 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800"
                  />
                  <input
                    type="text"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    aria-label="Quick link URL"
                    className="flex-1 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800"
                  />
                  <button
                    type="submit"
                    className="px-2 py-1 rounded bg-indigo-600 text-white text-xs cursor-pointer"
                  >
                    Save
                  </button>
                </form>
              ) : quickLinks.length === 0 ? (
                <p className="text-xs text-zinc-400 italic py-2">
                  No bookmarks yet. Click "+ Add Link" to pin frequent URLs.
                </p>
              ) : (
                <div className="flex items-center flex-wrap gap-1.5">
                  {quickLinks.map((link) => (
                    <div
                      key={link.id}
                      className="group inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-zinc-700 dark:text-zinc-200 border border-zinc-200/70 dark:border-zinc-700/70 transition-colors"
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                      >
                        <span>{link.title}</span>
                        <ArrowUpRight className="w-3 h-3 opacity-60" />
                      </a>
                      <button
                        type="button"
                        onClick={() => onDeleteQuickLink(link.id)}
                        aria-label={`Delete link ${link.title}`}
                        className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 ml-0.5 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full Dashboard Overview Home Page
  return (
    <div className="space-y-6">
      {/* Top Toolbar: Customize Widgets & Data Portability */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200/70 dark:border-zinc-800/70">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Dashboard Overview</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Daily progress, scratchpad, quick links, and local data backup
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowWidgetSettings((s) => !s)}
            aria-label="Customize dashboard widgets"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Widgets</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            aria-label="Export JSON backup"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 cursor-pointer"
          >
            <FileJson className="w-3.5 h-3.5 text-indigo-500" />
            <span>Export JSON</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            aria-label="Export CSV tasks"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Import JSON backup"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSON</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={handleImportFileChange}
            className="hidden"
          />
        </div>
      </div>

      {importStatus && (
        <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
          {importStatus}
        </div>
      )}

      {/* Modular Widget Toggles Bar */}
      {showWidgetSettings && (
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center flex-wrap gap-4 text-xs shadow-xs">
          <span className="font-semibold uppercase tracking-wider text-zinc-400">
            Active Widgets:
          </span>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={widgetConfig.showStats}
              onChange={(e) => onUpdateWidgetConfig({ showStats: e.target.checked })}
              className="rounded text-indigo-600"
            />
            <span>Progress & Stats</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={widgetConfig.showScratchpad}
              onChange={(e) =>
                onUpdateWidgetConfig({ showScratchpad: e.target.checked })
              }
              className="rounded text-indigo-600"
            />
            <span>Quick Scratchpad</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={widgetConfig.showQuickLinks}
              onChange={(e) =>
                onUpdateWidgetConfig({ showQuickLinks: e.target.checked })
              }
              className="rounded text-indigo-600"
            />
            <span>Quick Links Launcher</span>
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={widgetConfig.showHeaderSummary}
              onChange={(e) =>
                onUpdateWidgetConfig({ showHeaderSummary: e.target.checked })
              }
              className="rounded text-indigo-600"
            />
            <span>Show Summary Bar in Task Views</span>
          </label>
        </div>
      )}

      {/* 1. Stats & Progress Ring Cards */}
      {widgetConfig.showStats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Progress Ring Card */}
          <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex items-center gap-4">
            <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
              <svg className="w-16 h-16 -rotate-90" viewBox="0 0 68 68">
                <circle
                  cx="34"
                  cy="34"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  fill="transparent"
                  className="text-zinc-100 dark:text-zinc-800"
                />
                <circle
                  cx="34"
                  cy="34"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  fill="transparent"
                  className="text-indigo-600 transition-all duration-300"
                />
              </svg>
              <span className="absolute text-xs font-bold">
                {stats.completionRate}%
              </span>
            </div>
            <div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                Current Progress
              </p>
              <p className="text-lg font-bold mt-0.5">
                {stats.totalCompleted} / {stats.totalActive + stats.totalCompleted}
              </p>
              <p className="text-[11px] text-zinc-400">Completed, excluding archived</p>
            </div>
          </div>

          {/* Completed Today Card */}
          <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                Completed Today
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{stats.completedToday}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {stats.dueTodayCount} more scheduled for today
              </p>
            </div>
          </div>

          {/* Completion Streak Card */}
          <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                Daily Streak
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Flame className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">
                {stats.streakDays} {stats.streakDays === 1 ? 'day' : 'days'}
              </p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                Consecutive days completing tasks
              </p>
            </div>
          </div>

          {/* Overdue / Due Today Focus Card */}
          <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                Attention Needed
              </span>
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  stats.overdueCount > 0
                    ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                    : 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400'
                }`}
              >
                {stats.overdueCount > 0 ? (
                  <AlertTriangle className="w-4 h-4" />
                ) : (
                  <CalendarCheck className="w-4 h-4" />
                )}
              </div>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{stats.overdueCount} Overdue</p>
              <button
                type="button"
                onClick={() => onSelectSmartView?.('today')}
                className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline mt-0.5 cursor-pointer"
              >
                View Today & Overdue ({stats.dueTodayCount + stats.overdueCount}) →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Scratchpad & Quick Links Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Scratchpad Widget */}
        {widgetConfig.showScratchpad && (
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <StickyNote className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Quick Scratchpad</h3>
                  <p className="text-[11px] text-zinc-400">
                    Persistent local notepad — auto-saves on blur
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {scratchpadSavedIndicator && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    Saved
                  </span>
                )}
                {localScratchpad.trim() && (
                  <button
                    type="button"
                    onClick={handlePromoteScratchpadLine}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Convert top line to Task</span>
                  </button>
                )}
              </div>
            </div>

            <textarea
              rows={7}
              value={localScratchpad}
              onChange={(e) => setLocalScratchpad(e.target.value)}
              onBlur={handleScratchpadBlur}
              placeholder="Write brain-dumps, meeting notes, or rough ideas here. Click 'Convert top line to Task' to turn the first line into an actionable task!"
              aria-label="Dashboard scratchpad"
              className="w-full p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-800/50 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-indigo-500 resize-y font-mono"
            />
          </div>
        )}

        {/* Quick Links / Bookmarks Widget */}
        {widgetConfig.showQuickLinks && (
          <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <ExternalLink className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Quick Links & Bookmarks</h3>
                  <p className="text-[11px] text-zinc-400">
                    Launchpad for frequent local ports, docs, and repos
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsAddingLink((v) => !v)}
                aria-label="Add quick link"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Link</span>
              </button>
            </div>

            {isAddingLink && (
              <form
                onSubmit={handleAddLinkSubmit}
                className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="Title (e.g. GitHub PRs)"
                    aria-label="New link title"
                    autoFocus
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="URL (e.g. github.com)"
                    aria-label="New link URL"
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  />
                  <input
                    type="text"
                    value={linkCategory}
                    onChange={(e) => setLinkCategory(e.target.value)}
                    placeholder="Category (e.g. Work)"
                    aria-label="New link category"
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddingLink(false)}
                    className="px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                  >
                    Save Bookmark
                  </button>
                </div>
              </form>
            )}

            {quickLinks.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-8 text-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  No quick links saved yet.
                </p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Add links to your repos, local servers, or dashboards.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {quickLinks.map((link) => (
                  <div
                    key={link.id}
                    className="group flex items-center justify-between p-3 rounded-xl border border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 min-w-0 pr-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                          {link.title}
                        </span>
                        <ArrowUpRight className="w-3 h-3 text-zinc-400 flex-shrink-0" />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                          {link.category}
                        </span>
                        <span className="text-[11px] text-zinc-400 truncate">
                          {link.url}
                        </span>
                      </div>
                    </a>
                    <button
                      type="button"
                      onClick={() => onDeleteQuickLink(link.id)}
                      aria-label={`Delete quick link ${link.title}`}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
