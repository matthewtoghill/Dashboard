import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  LayoutDashboard,
  Inbox,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Folder,
  Sun,
  Moon,
  Archive,
  ArchiveRestore,
  Plus,
  X,
} from 'lucide-react';
import { Project, Task } from '../../shared/types.ts';
import { ActiveNavigation } from '../utils/taskView.ts';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Project[];
  onSelectNav: (nav: ActiveNavigation) => void;
  onFocusQuickAdd: () => void;
  onToggleTheme: () => void;
  onArchiveCompleted: () => void;
  /** The task open in the detail drawer, if any. */
  openTask: Task | null;
  onToggleArchiveTask: (task: Task) => void;
  darkMode: boolean;
}

interface CommandItem {
  id: string;
  label: string;
  category: string;
  icon: React.FC<{ className?: string }>;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  projects,
  onSelectNav,
  onFocusQuickAdd,
  onToggleTheme,
  onArchiveCompleted,
  openTask,
  onToggleArchiveTask,
  darkMode,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const items: CommandItem[] = useMemo(() => {
    const base: CommandItem[] = [
      {
        id: 'act-new-task',
        label: 'New Task (Focus Quick-Add)',
        category: 'Actions',
        icon: Plus,
        action: () => {
          onClose();
          setTimeout(() => onFocusQuickAdd(), 20);
        },
      },
      {
        id: 'nav-overview',
        label: 'Go to Dashboard Home Overview',
        category: 'Views',
        icon: LayoutDashboard,
        action: () => {
          onSelectNav({ type: 'smart', id: 'overview' });
          onClose();
        },
      },
      {
        id: 'nav-inbox',
        label: 'Go to All Active Tasks',
        category: 'Views',
        icon: Inbox,
        action: () => {
          onSelectNav({ type: 'smart', id: 'inbox' });
          onClose();
        },
      },
      {
        id: 'nav-today',
        label: 'Go to Today & Overdue',
        category: 'Views',
        icon: Calendar,
        action: () => {
          onSelectNav({ type: 'smart', id: 'today' });
          onClose();
        },
      },
      {
        id: 'nav-upcoming',
        label: 'Go to Upcoming',
        category: 'Views',
        icon: CalendarClock,
        action: () => {
          onSelectNav({ type: 'smart', id: 'upcoming' });
          onClose();
        },
      },
      {
        id: 'nav-completed',
        label: 'Go to Completed',
        category: 'Views',
        icon: CheckCircle2,
        action: () => {
          onSelectNav({ type: 'smart', id: 'completed' });
          onClose();
        },
      },
      {
        id: 'nav-archived',
        label: 'Go to Archive',
        category: 'Views',
        icon: Archive,
        action: () => {
          onSelectNav({ type: 'smart', id: 'archived' });
          onClose();
        },
      },
      {
        id: 'act-theme',
        label: darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode',
        category: 'Preferences',
        icon: darkMode ? Sun : Moon,
        action: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: 'act-archive-done',
        label: 'Archive All Completed Tasks…',
        category: 'Actions',
        icon: Archive,
        action: () => {
          onArchiveCompleted();
          onClose();
        },
      },
    ];

    const projectItems: CommandItem[] = projects.map((p) => ({
      id: `proj-${p.id}`,
      label: `Go to Project: ${p.name}`,
      category: 'Projects',
      icon: Folder,
      action: () => {
        onSelectNav({ type: 'project', id: p.id });
        onClose();
      },
    }));

    const taskItems: CommandItem[] = openTask
      ? [
          {
            id: 'act-archive-open-task',
            label:
              openTask.status === 'archived'
                ? `Restore "${openTask.title}"`
                : `Archive "${openTask.title}"`,
            category: 'Task',
            icon: openTask.status === 'archived' ? ArchiveRestore : Archive,
            action: () => {
              onToggleArchiveTask(openTask);
              onClose();
            },
          },
        ]
      : [];

    return [...taskItems, ...base, ...projectItems];
  }, [
    projects,
    darkMode,
    onClose,
    onFocusQuickAdd,
    onSelectNav,
    onToggleTheme,
    onArchiveCompleted,
    openTask,
    onToggleArchiveTask,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (filtered.length > 0 ? (prev + 1) % filtered.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0
      );
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-24 px-4 bg-black/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Command Palette"
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 gap-2.5">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or jump to view..."
            aria-label="Command search"
            className="flex-1 bg-transparent text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close command palette"
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto p-2 space-y-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400">
              No matching commands found
            </p>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isActive = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </span>
                  <span
                    className={`text-[11px] ${
                      isActive ? 'text-indigo-100' : 'text-zinc-400'
                    }`}
                  >
                    {item.category}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/60 flex items-center justify-between text-[11px] text-zinc-400">
          <span>Navigate with ↑↓ and Enter</span>
          <span>Shortcuts: N (new), / (search), Ctrl+K (commands)</span>
        </div>
      </div>
    </div>
  );
};
