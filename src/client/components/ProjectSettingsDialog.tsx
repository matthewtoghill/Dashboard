import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Project, UpdateProjectInput } from '../../shared/types.ts';
import { sameFolder } from '../../shared/claudeFolders.ts';
import { fetchClaudeSessions } from '../api.ts';
import { PROJECT_COLORS } from '../utils/taskUtils.ts';
import { buttonClass, inputClass } from './AdoImport.tsx';
import { AdoProjectLinksEditor } from './AdoProjectPanel.tsx';
import { useClaudeFolders } from './ClaudeSessions.tsx';

const sectionTitleClass = 'text-xs font-semibold uppercase tracking-wider text-zinc-400';

/** Folders whose Claude sessions belong to `project`, each covering its subfolders. For Project settings. */
const ClaudeFoldersEditor: React.FC<{ project: Project }> = ({ project }) => {
  const { links, save, remove } = useClaudeFolders();
  const { data: sessions = [] } = useQuery({ queryKey: ['claudeSessions'], queryFn: fetchClaudeSessions });
  const [draft, setDraft] = useState('');
  const own = links.filter((l) => l.projectId === project.id);
  // Folders sessions have run in that no mapping names yet
  const suggestions = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))]
    .filter((cwd) => !links.some((l) => sameFolder(l.path, cwd)))
    .sort();
  const mappedElsewhere = links.some((l) => l.projectId !== project.id && sameFolder(l.path, draft));
  const error = save.error ?? remove.error;

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const path = draft.trim();
    if (path) save.mutate({ path, projectId: project.id }, { onSuccess: () => setDraft('') });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Claude sessions started in these folders, or their subfolders, belong to this project unless linked to a task
        in another one.
      </p>
      {own.length > 0 && (
        <ul className="space-y-1">
          {own.map((link) => (
            <li key={link.path} className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate text-xs" title={link.path}>
                {link.path}
              </code>
              <button
                type="button"
                aria-label={`Remove ${link.path}`}
                title="Remove"
                disabled={remove.isPending}
                onClick={() => remove.mutate(link.path)}
                className="p-1 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          list="claude-folder-suggestions"
          placeholder="C:\Repos\my-project"
          aria-label="Folder to add"
          className={`${inputClass} flex-1 min-w-0`}
        />
        <datalist id="claude-folder-suggestions">
          {suggestions.map((cwd) => (
            <option key={cwd} value={cwd} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={!draft.trim() || save.isPending}
          className={buttonClass}
        >
          Add
        </button>
      </form>
      {mappedElsewhere && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          This folder is mapped to another project; adding it moves it here.
        </p>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error.message}</p>}
    </div>
  );
};

/** One project's settings: name and colour, its Azure DevOps switch and mappings, and its Claude folders. */
export const ProjectSettingsDialog: React.FC<{
  project: Project | null;
  onClose: () => void;
  onUpdate: (id: string, input: UpdateProjectInput) => void;
}> = ({ project, onClose, onUpdate }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const open = project !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="project-settings-title"
      className="m-auto w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl p-0 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800 shadow-2xl backdrop:bg-black/40"
    >
      {project && (
        <div className="flex flex-col max-h-[85vh] text-sm">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <h2 id="project-settings-title" className="flex items-center gap-2 text-base font-semibold">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color }} />
              {project.name} settings
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <section className="space-y-3">
              <h3 className={sectionTitleClass}>General</h3>
              <label className="flex items-center gap-4">
                <span className="w-24 shrink-0 text-zinc-600 dark:text-zinc-300">Name</span>
                <input
                  key={project.name}
                  type="text"
                  defaultValue={project.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== project.name) onUpdate(project.id, { name });
                  }}
                  className={`${inputClass} flex-1 min-w-0`}
                />
              </label>
              <div className="flex items-center gap-4">
                <span className="w-24 shrink-0 text-zinc-600 dark:text-zinc-300">Colour</span>
                <div className="flex items-center gap-1.5">
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Colour ${color}`}
                      aria-pressed={project.color === color}
                      onClick={() => onUpdate(project.id, { color })}
                      className={`w-5 h-5 rounded-full cursor-pointer ${
                        project.color === color ? 'ring-2 ring-offset-2 ring-primary-500 dark:ring-offset-zinc-900' : ''
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className={sectionTitleClass}>Azure DevOps</h3>
              <label className="flex items-start gap-2 text-zinc-600 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={project.adoEnabled}
                  onChange={(e) => onUpdate(project.id, { adoEnabled: e.target.checked })}
                  className="mt-0.5 rounded text-primary-600"
                />
                <span>
                  Use Azure DevOps in this project
                  <span className="block text-xs text-zinc-400">
                    Off hides the Azure DevOps panel and leaves the linked projects out of checks. Links are kept.
                  </span>
                </span>
              </label>
              {project.adoEnabled && <AdoProjectLinksEditor project={project} />}
            </section>

            <section className="space-y-3">
              <h3 className={sectionTitleClass}>Claude folders</h3>
              <ClaudeFoldersEditor project={project} />
            </section>
          </div>
        </div>
      )}
    </dialog>
  );
};
