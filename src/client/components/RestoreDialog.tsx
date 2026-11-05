import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, History, X } from 'lucide-react';
import { RESTORE_SECTIONS, RestoreFieldChange, RestoreItem, RestoreResult, RestoreSection } from '../../shared/types.ts';
import { fetchRestoreDiff, restoreFromBackup } from '../api.ts';
import {
  buildRestoreRequest,
  fieldLabel,
  formatValue,
  itemKey,
  RestoreSelection,
  SECTION_LABELS,
  selectionCount,
  summarizeResult,
} from '../utils/restore.ts';
import { buttonClass } from './AdoImport.tsx';

const BADGE = 'shrink-0 px-1.5 rounded text-[11px] leading-[18px] font-medium';
const STATE_BADGE: Record<RestoreItem['state'], string> = {
  missing: `${BADGE} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`,
  changed: `${BADGE} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`,
};
const STATE_LABEL: Record<RestoreItem['state'], string> = { missing: 'Missing', changed: 'Changed' };
const primaryButtonClass =
  'px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 cursor-pointer disabled:opacity-50 disabled:cursor-default';
const secondaryButtonClass =
  'px-3 py-1.5 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer';

/** Backup and current values of each differing field. */
const FieldChanges: React.FC<{ changes: RestoreFieldChange[] }> = ({ changes }) => (
  <dl className="mt-1 ml-6 grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 text-xs">
    {changes.map((c) => (
      <React.Fragment key={c.field}>
        <dt className="row-span-2 text-zinc-500">{fieldLabel(c.field)}</dt>
        <dd className="text-zinc-400">Backup</dd>
        <dd className="min-w-0 truncate" title={formatValue(c.field, c.backup)}>
          {formatValue(c.field, c.backup)}
        </dd>
        <dd className="text-zinc-400">Now</dd>
        <dd className="min-w-0 truncate text-zinc-500" title={formatValue(c.field, c.live)}>
          {formatValue(c.field, c.live)}
        </dd>
      </React.Fragment>
    ))}
  </dl>
);

const ItemRow: React.FC<{
  item: RestoreItem;
  checked: boolean;
  onToggle: (on: boolean) => void;
}> = ({ item, checked, onToggle }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="py-1">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`${item.state === 'missing' ? 'Add' : 'Overwrite'} ${item.label}`}
          className="rounded text-primary-600"
        />
        <span className="flex-1 min-w-0 truncate" title={item.label}>
          {item.label}
        </span>
        <span className={STATE_BADGE[item.state]}>{STATE_LABEL[item.state]}</span>
        {item.state === 'changed' ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={`Show changes to ${item.label}`}
            title="Show changes"
            className="p-0.5 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
      </div>
      {expanded && <FieldChanges changes={item.changes} />}
    </li>
  );
};

/** "All missing (3)" style toggle for one state in a section. */
const SelectAll: React.FC<{
  state: RestoreItem['state'];
  keys: string[];
  selected: Set<string>;
  onToggle: (keys: string[], on: boolean) => void;
}> = ({ state, keys, selected, onToggle }) =>
  keys.length === 0 ? null : (
    <label className="inline-flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
      <input
        type="checkbox"
        checked={keys.every((k) => selected.has(k))}
        onChange={(e) => onToggle(keys, e.target.checked)}
        className="rounded text-primary-600"
      />
      All {STATE_LABEL[state].toLowerCase()} ({keys.length})
    </label>
  );

const ResultSummary: React.FC<{ result: RestoreResult }> = ({ result }) => (
  <>
    <ul className="list-disc pl-5 space-y-0.5">
      {summarizeResult(result).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
    {result.warnings.length > 0 && (
      <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-1">
        <p className="font-medium text-amber-800 dark:text-amber-200">Not everything comes back as ticked:</p>
        <ul className="list-disc pl-5 text-amber-800 dark:text-amber-200">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </div>
    )}
  </>
);

/**
 * Pick items, settings and the scratchpad to bring back from one local backup. Missing items are
 * added; changed ones are overwritten with the backup's values. A dry run shows the outcome first.
 */
export const RestoreDialog: React.FC<{ file: string; onClose: () => void }> = ({ file, onClose }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<RestoreSelection>({
    items: new Set(),
    settings: new Set(),
    scratchpad: false,
  });
  const [preview, setPreview] = useState<RestoreResult | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const { data: diff, error, isLoading } = useQuery({
    queryKey: ['restoreDiff', file],
    queryFn: () => fetchRestoreDiff(file),
    gcTime: 0,
  });

  const dryRun = useMutation({
    mutationFn: () => restoreFromBackup(file, { ...buildRestoreRequest(diff!, selection), dryRun: true }),
    onSuccess: setPreview,
  });
  const restore = useMutation({
    mutationFn: () => restoreFromBackup(file, buildRestoreRequest(diff!, selection)),
    // Anything may have changed, and the safety backup adds to the backup list
    onSettled: () => queryClient.invalidateQueries(),
  });

  const toggleItems = (keys: string[], on: boolean) =>
    setSelection((prev) => {
      const items = new Set(prev.items);
      for (const key of keys) {
        if (on) items.add(key);
        else items.delete(key);
      }
      return { ...prev, items };
    });
  const toggleSetting = (field: string, on: boolean) =>
    setSelection((prev) => {
      const settings = new Set(prev.settings);
      if (on) settings.add(field);
      else settings.delete(field);
      return { ...prev, settings };
    });

  const sections = diff ? RESTORE_SECTIONS.filter((s) => diff.sections[s].length > 0) : [];
  const empty = diff && sections.length === 0 && diff.settings.length === 0 && !diff.scratchpad;
  const count = selectionCount(selection);
  const step = restore.data ? 'done' : preview ? 'confirm' : 'pick';
  const failure = error ?? dryRun.error ?? restore.error;

  const keysOf = (section: RestoreSection, state: RestoreItem['state']) =>
    diff!.sections[section].filter((i) => i.state === state).map((i) => itemKey(section, i.id));

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // Keep Esc from also closing the settings panel underneath
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.stopPropagation();
      }}
      aria-labelledby="restore-dialog-title"
      className="m-auto w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      <div className="flex flex-col max-h-[85vh] text-sm">
        <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <h2 id="restore-dialog-title" className="min-w-0 flex items-center gap-2 text-base font-semibold">
            <History className="w-4 h-4 shrink-0 text-primary-500" />
            <span className="truncate">Restore from {file}</span>
          </h2>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close restore"
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && <p className="text-zinc-500">{'Reading the backup…'}</p>}
          {failure && (
            <p role="alert" className="text-red-600 dark:text-red-400">
              {failure.message}
            </p>
          )}
          {empty && <p className="text-zinc-500">This backup matches your current data.</p>}

          {step === 'pick' && diff && !empty && (
            <>
              <p className="text-xs text-zinc-500">
                Tick what to bring back. Missing items are added; changed items are overwritten with the
                backup&apos;s version. Nothing added since the backup is removed.
              </p>
              {sections.map((section) => {
                const items = diff.sections[section];
                const missing = keysOf(section, 'missing');
                const changed = keysOf(section, 'changed');
                return (
                  <details key={section} open={items.length <= 10} className="group">
                    <summary className="flex items-center gap-2 cursor-pointer select-none">
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
                      <span className="font-medium">{SECTION_LABELS[section]}</span>
                      <span className="text-xs text-zinc-500">
                        {[missing.length && `${missing.length} missing`, changed.length && `${changed.length} changed`]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </summary>
                    <div className="ml-5 mt-1 space-y-1">
                      <div className="flex gap-4">
                        <SelectAll state="missing" keys={missing} selected={selection.items} onToggle={toggleItems} />
                        <SelectAll state="changed" keys={changed} selected={selection.items} onToggle={toggleItems} />
                      </div>
                      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {items.map((item) => {
                          const key = itemKey(section, item.id);
                          return (
                            <ItemRow
                              key={key}
                              item={item}
                              checked={selection.items.has(key)}
                              onToggle={(on) => toggleItems([key], on)}
                            />
                          );
                        })}
                      </ul>
                      {section === 'tasks' && changed.length > 0 && (
                        <p className="text-xs text-zinc-400">
                          Overwriting a task resets its subtasks to the backup&apos;s. ADO and source links added
                          since the backup are kept.
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}

              {diff.settings.length > 0 && (
                <details open className="group">
                  <summary className="flex items-center gap-2 cursor-pointer select-none">
                    <ChevronRight className="w-3.5 h-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
                    <span className="font-medium">Settings</span>
                    <span className="text-xs text-zinc-500">{diff.settings.length} changed</span>
                  </summary>
                  <ul className="ml-5 mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
                    {diff.settings.map((c) => (
                      <li key={c.field} className="py-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selection.settings.has(c.field)}
                            onChange={(e) => toggleSetting(c.field, e.target.checked)}
                            className="rounded text-primary-600"
                          />
                          <span className="flex-1 min-w-0 truncate">{fieldLabel(c.field)}</span>
                          <span className="min-w-0 truncate text-xs text-zinc-500" title={formatValue(c.field, c.backup)}>
                            Backup: {formatValue(c.field, c.backup)} · Now: {formatValue(c.field, c.live)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {diff.scratchpad && (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selection.scratchpad}
                      onChange={(e) => setSelection((prev) => ({ ...prev, scratchpad: e.target.checked }))}
                      className="rounded text-primary-600"
                    />
                    Replace the scratchpad with the backup&apos;s text
                  </label>
                  <p className="ml-6 text-xs text-zinc-500 line-clamp-3 whitespace-pre-line" title={diff.scratchpad.backup}>
                    {diff.scratchpad.backup}
                  </p>
                </div>
              )}
            </>
          )}

          {step === 'confirm' && preview && (
            <>
              <p>This restore will make these changes:</p>
              <ResultSummary result={preview} />
              <p className="text-xs text-zinc-500">
                A safety backup of your current data is taken first, so you can restore it if needed.
              </p>
            </>
          )}

          {step === 'done' && restore.data && (
            <>
              <p className="font-medium">Restore complete.</p>
              <ResultSummary result={restore.data} />
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500" aria-live="polite">
            {step === 'pick' && diff && !empty && `${count} selected`}
          </span>
          <div className="flex gap-2">
            {step === 'pick' && (
              <button
                type="button"
                className={primaryButtonClass}
                disabled={!diff || count === 0 || dryRun.isPending}
                onClick={() => dryRun.mutate()}
              >
                {dryRun.isPending ? 'Checking…' : 'Review restore'}
              </button>
            )}
            {step === 'confirm' && (
              <>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  autoFocus
                  disabled={restore.isPending}
                  onClick={() => setPreview(null)}
                >
                  Back
                </button>
                <button
                  type="button"
                  className={primaryButtonClass}
                  disabled={restore.isPending}
                  onClick={() => restore.mutate()}
                >
                  {restore.isPending ? 'Restoring…' : 'Restore'}
                </button>
              </>
            )}
            {step === 'done' && (
              <button type="button" className={buttonClass} autoFocus onClick={() => ref.current?.close()}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
};
