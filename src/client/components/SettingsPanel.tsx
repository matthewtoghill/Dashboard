import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, FileSpreadsheet, Settings, Trash2, Upload, X } from 'lucide-react';
import {
  BackupPayload,
  Project,
  Task,
  UpdateSettingsInput,
  WidgetConfig,
} from '../../shared/types.ts';
import {
  exportDashboardData,
  fetchBackups,
  fetchSettings,
  ImportResult,
  updateSettings,
} from '../api.ts';
import { formatRelativeTime, tasksToCsv } from '../utils/taskUtils.ts';
import { BackupStatusLine } from './DashboardWidgets.tsx';

export type ThemePreference = 'light' | 'dark' | 'system';

const WIDGET_LABELS: [keyof WidgetConfig, string][] = [
  ['showStats', 'Progress & stats'],
  ['showScratchpad', 'Quick scratchpad'],
  ['showTrends', 'Trends & project progress'],
  ['showQuickLinks', 'Quick links launcher'],
  ['showHeaderSummary', 'Summary bar in task views'],
];

const inputClass =
  'px-2.5 py-1.5 rounded-lg text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:border-indigo-400';
const buttonClass =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-indigo-400 cursor-pointer disabled:opacity-50 disabled:cursor-default';

function download(content: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
    {children}
  </section>
);

const EnvNote: React.FC<{ name: string; value: string | null }> = ({ name, value }) =>
  value ? (
    <p className="text-xs text-amber-700 dark:text-amber-300">
      Overridden by the {name} environment variable ({value}).
    </p>
  ) : null;

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemePreference;
  onChangeTheme: (theme: ThemePreference) => void;
  tasks: Task[];
  projects: Project[];
  widgetConfig: WidgetConfig;
  onUpdateWidgetConfig: (config: Partial<WidgetConfig>) => void;
  onImportBackup: (payload: BackupPayload) => Promise<ImportResult>;
  onDeleteArchived: () => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  theme,
  onChangeTheme,
  tasks,
  projects,
  widgetConfig,
  onUpdateWidgetConfig,
  onImportBackup,
  onDeleteArchived,
}) => {
  const queryClient = useQueryClient();
  const asideRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
  const { data: backups } = useQuery({
    queryKey: ['backups'],
    queryFn: fetchBackups,
    enabled: isOpen,
  });
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(['settings'], next);
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  // Move focus into the panel on open and hand it back on close.
  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const settings = data?.settings;
  const archivedCount = tasks.filter((t) => t.status === 'archived').length;

  /** Text and number fields save on blur, and only when changed. */
  const saveOnBlur =
    (key: 'backupKeep' | 'backupDir' | 'claudeSessionTtlDays') =>
    (e: React.FocusEvent<HTMLInputElement>) => {
      const value = e.target.type === 'number' ? Number(e.target.value) : e.target.value.trim();
      if (settings && value !== settings[key]) save.mutate({ [key]: value } as UpdateSettingsInput);
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
          `${result.importedQuickLinks} links, ${result.importedSavedViews} saved views, ` +
          `${result.importedClaudeSessions} Claude sessions added ` +
          '(existing items were left unchanged).'
      );
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end bg-black/25 dark:bg-black/50 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        className="focus:outline-none w-full max-w-lg bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <Settings className="w-4 h-4" />
            Settings
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-7 text-sm">
          {save.isError && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {save.error.message}
            </p>
          )}

          <Section title="General">
            <fieldset className="flex items-center gap-4">
              <legend className="sr-only">Theme</legend>
              <span className="w-32 text-zinc-600 dark:text-zinc-300">Theme</span>
              {(['light', 'dark', 'system'] as const).map((value) => (
                <label key={value} className="inline-flex items-center gap-1.5 cursor-pointer capitalize">
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === value}
                    onChange={() => onChangeTheme(value)}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-4">
              <span className="w-32 text-zinc-600 dark:text-zinc-300">Quick-add project</span>
              <select
                value={
                  projects.some((p) => p.id === settings?.defaultProjectId)
                    ? settings!.defaultProjectId!
                    : ''
                }
                onChange={(e) => save.mutate({ defaultProjectId: e.target.value || null })}
                disabled={!settings}
                className={inputClass}
              >
                <option value="">Inbox (no project)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-zinc-400">Project views always add to their own project.</p>
          </Section>

          <Section title="Overview widgets">
            <div className="grid grid-cols-2 gap-2">
              {WIDGET_LABELS.map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={widgetConfig[key]}
                    onChange={(e) => onUpdateWidgetConfig({ [key]: e.target.checked })}
                    className="rounded text-indigo-600"
                  />
                  {label}
                </label>
              ))}
            </div>
          </Section>

          <Section title="Backups">
            {backups && !backups.enabled ? (
              <p className="text-xs text-zinc-400">Backups are off (in-memory database).</p>
            ) : (
              settings && (
                <>
                  <label className="flex items-center gap-4">
                    <span className="w-32 text-zinc-600 dark:text-zinc-300">Keep newest</span>
                    <input
                      key={settings.backupKeep}
                      type="number"
                      min={1}
                      max={1000}
                      defaultValue={settings.backupKeep}
                      onBlur={saveOnBlur('backupKeep')}
                      className={`${inputClass} w-24`}
                    />
                  </label>
                  <EnvNote name="BACKUP_KEEP" value={data.envOverrides.backupKeep} />
                  <label className="flex items-center gap-4">
                    <span className="w-32 shrink-0 text-zinc-600 dark:text-zinc-300">Folder</span>
                    <input
                      key={settings.backupDir}
                      type="text"
                      defaultValue={settings.backupDir}
                      placeholder={backups?.enabled ? backups.dir : 'Default'}
                      onBlur={saveOnBlur('backupDir')}
                      className={`${inputClass} flex-1 min-w-0`}
                    />
                  </label>
                  <EnvNote name="BACKUP_DIR" value={data.envOverrides.backupDir} />
                  <p className="text-xs text-zinc-400">
                    Absolute path; leave empty for the default. A new folder applies to new
                    backups only; existing backups stay where they are.
                  </p>
                  <BackupStatusLine />
                  {backups?.enabled && backups.backups.length > 0 && (
                    <ul className="text-xs text-zinc-500 dark:text-zinc-400 divide-y divide-zinc-100 dark:divide-zinc-800">
                      {backups.backups.map((b) => (
                        <li key={b.file} className="flex justify-between gap-3 py-1">
                          <span className="truncate font-mono" title={`${backups.dir}/${b.file}`}>
                            {b.file}
                          </span>
                          <span className="shrink-0">
                            {formatRelativeTime(b.createdAt)} · {(b.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )
            )}
          </Section>

          <Section title="Data">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={async () =>
                  download(
                    JSON.stringify(await exportDashboardData(), null, 2),
                    'application/json',
                    `dashboard-backup-${today}.json`
                  )
                }
              >
                <FileJson className="w-3.5 h-3.5 text-indigo-500" />
                Export JSON
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() =>
                  download(
                    tasksToCsv(tasks, projects),
                    'text/csv;charset=utf-8;',
                    `dashboard-tasks-${today}.csv`
                  )
                }
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                Export CSV
              </button>
              <button type="button" className={buttonClass} onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-3.5 h-3.5" />
                Import JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportFileChange}
                className="hidden"
              />
            </div>
            {importStatus && (
              <p className="text-xs text-indigo-700 dark:text-indigo-300">{importStatus}</p>
            )}
            <button
              type="button"
              className={buttonClass}
              onClick={onDeleteArchived}
              disabled={archivedCount === 0}
            >
              <Trash2 className="w-3.5 h-3.5 text-red-500" />
              Delete all archived tasks ({archivedCount})
            </button>
          </Section>

          <Section title="Integrations">
            {settings && (
              <label className="flex items-center gap-4">
                <span className="w-32 text-zinc-600 dark:text-zinc-300">Claude sessions</span>
                <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                  Forget unlinked after
                  <input
                    key={settings.claudeSessionTtlDays}
                    type="number"
                    min={1}
                    max={365}
                    defaultValue={settings.claudeSessionTtlDays}
                    onBlur={saveOnBlur('claudeSessionTtlDays')}
                    className={`${inputClass} w-20`}
                  />
                  days
                </span>
              </label>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
};
