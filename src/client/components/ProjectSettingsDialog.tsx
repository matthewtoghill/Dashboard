import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Project, UpdateProjectInput } from '../../shared/types.ts';
import { PROJECT_COLORS } from '../utils/taskUtils.ts';
import { inputClass } from './AdoImport.tsx';
import { AdoProjectLinksEditor } from './AdoProjectPanel.tsx';

const sectionTitleClass = 'text-xs font-semibold uppercase tracking-wider text-zinc-400';

/** One project's settings: name and colour, and its Azure DevOps switch and mappings. */
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
                        project.color === color ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-zinc-900' : ''
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
                  className="mt-0.5 rounded text-indigo-600"
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
          </div>
        </div>
      )}
    </dialog>
  );
};
