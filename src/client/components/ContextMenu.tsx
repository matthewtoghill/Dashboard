import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { isTextInput } from '../utils/useGlobalShortcuts.ts';

/** One menu entry: an action, a submenu, or an inline text/date input. */
export interface MenuItem {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onSelect?: () => void;
  submenu?: MenuItem[];
  input?: {
    type: 'text' | 'date';
    initial?: string;
    /** id of a <datalist> with suggestions. */
    list?: string;
    onSubmit: (value: string) => void;
  };
  /** Renders as a radio item, ticked when true. */
  checked?: boolean;
  danger?: boolean;
  /** A colour dot before the label. */
  swatch?: string;
  separatorBefore?: boolean;
}

export interface MenuContent {
  /** Accessible name of the menu, e.g. the task title. */
  label: string;
  items: MenuItem[];
}

/** Where a panel opens: at x/y, or (submenus) flipped to end at `flipX` if it would overflow. */
interface Anchor {
  x: number;
  y: number;
  flipX?: number;
}

const EDGE = 4;

const itemClass =
  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs cursor-pointer outline-none';

const InputItem: React.FC<{ item: MenuItem; onCloseAll: () => void }> = ({ item, onCloseAll }) => {
  const input = item.input!;
  const [value, setValue] = useState(input.initial ?? '');
  const submit = () => {
    if (!value.trim()) return;
    onCloseAll();
    input.onSubmit(value.trim());
  };
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      <input
        data-menu-nav
        type={input.type}
        value={value}
        list={input.list}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label={item.label}
        placeholder={item.label}
        className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-indigo-500"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={submit}
        className="px-2 py-1 rounded text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 cursor-pointer"
      >
        Set
      </button>
    </div>
  );
};

const MenuPanel: React.FC<{
  content: MenuContent;
  at: Anchor;
  autoFocus: boolean;
  onCloseAll: () => void;
  /** Closes this submenu and returns focus to its parent item. */
  onBack?: () => void;
}> = ({ content, at, autoFocus, onCloseAll, onBack }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [open, setOpen] = useState<{ index: number; autoFocus: boolean } | null>(null);

  const navItems = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-nav]') ?? [])];

  // Measure, then keep the panel inside the viewport. It starts at opacity 0, not hidden, so it can take focus.
  useLayoutEffect(() => {
    const { width, height } = ref.current!.getBoundingClientRect();
    let left = at.x;
    if (left + width > window.innerWidth - EDGE) {
      left = at.flipX !== undefined ? at.flipX - width : window.innerWidth - EDGE - width;
    }
    const top = Math.min(at.y, window.innerHeight - EDGE - height);
    setPos({ left: Math.max(EDGE, left), top: Math.max(EDGE, top) });
    if (autoFocus) navItems()[0]?.focus({ preventScroll: true });
  }, []);

  const openSubmenu = (index: number, focus: boolean) => setOpen({ index, autoFocus: focus });
  const closeSubmenu = () => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>(`[data-menu-index="${open.index}"]`)?.focus();
    setOpen(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The task list and global shortcuts listen on window; keys typed here are the menu's
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (onBack) onBack();
      else onCloseAll();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      onCloseAll();
      return;
    }
    // Arrows move the caret / date inside an input
    if (isTextInput(e.target)) return;
    const nav = navItems();
    const i = nav.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => nav[(n + nav.length) % nav.length]?.focus();
    if (e.key === 'ArrowDown') focusAt(i + 1);
    else if (e.key === 'ArrowUp') focusAt(i === -1 ? -1 : i - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(-1);
    else if (e.key === 'ArrowRight') {
      const index = Number((document.activeElement as HTMLElement)?.dataset.menuIndex);
      if (!content.items[index]?.submenu) return;
      openSubmenu(index, true);
    } else if (e.key === 'ArrowLeft' && onBack) onBack();
    else return;
    e.preventDefault();
  };

  const openItem = open && content.items[open.index];
  const openRect =
    openItem && ref.current?.querySelector(`[data-menu-index="${open.index}"]`)?.getBoundingClientRect();

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={content.label}
        data-context-menu
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        style={pos ?? { left: at.x, top: at.y, opacity: 0 }}
        className="fixed z-50 min-w-44 max-w-64 max-h-[calc(100vh-8px)] overflow-y-auto p-1 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl text-zinc-700 dark:text-zinc-200"
      >
        {content.items.map((item, index) => {
          const Icon = item.icon;
          const separator = item.separatorBefore && index > 0 && (
            <div role="separator" className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />
          );
          if (item.input) {
            return (
              <React.Fragment key={item.label}>
                {separator}
                <InputItem item={item} onCloseAll={onCloseAll} />
              </React.Fragment>
            );
          }
          const isOpen = open?.index === index;
          return (
            <React.Fragment key={item.label}>
              {separator}
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={item.checked}
                aria-haspopup={item.submenu ? 'menu' : undefined}
                aria-expanded={item.submenu ? isOpen : undefined}
                tabIndex={-1}
                data-menu-nav
                data-menu-index={index}
                onMouseEnter={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  if (item.submenu) {
                    if (!isOpen) openSubmenu(index, false);
                  } else setOpen(null);
                }}
                onClick={() => {
                  if (item.submenu) {
                    openSubmenu(index, true);
                    return;
                  }
                  onCloseAll();
                  item.onSelect?.();
                }}
                className={`${itemClass} ${
                  item.danger
                    ? 'text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/40'
                    : `focus:bg-zinc-100 dark:focus:bg-zinc-800 ${isOpen ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`
                }`}
              >
                <span className="w-3.5 flex-shrink-0 flex justify-center">
                  {item.checked ? (
                    <Check className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  ) : item.swatch ? (
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.swatch }} />
                  ) : (
                    Icon && <Icon className="w-3.5 h-3.5 opacity-70" />
                  )}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {item.submenu && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {openItem && openRect && (
        <MenuPanel
          key={`${open.index}:${open.autoFocus}`}
          content={{ label: openItem.label, items: openItem.submenu! }}
          at={{ x: openRect.right + 2, y: openRect.top - 4, flipX: openRect.left - 2 }}
          autoFocus={open.autoFocus}
          onCloseAll={onCloseAll}
          onBack={closeSubmenu}
        />
      )}
    </>
  );
};

/**
 * Replaces the browser's context menu wherever `resolve` returns menu content for the clicked
 * element. Shift+right-click and text inputs keep the browser menu. The Menu key and Shift+F10
 * open it for the focused element.
 */
export const ContextMenuHost: React.FC<{ resolve: (target: HTMLElement) => MenuContent | null }> = ({
  resolve,
}) => {
  const [menu, setMenu] = useState<(MenuContent & Anchor) | null>(null);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  const returnFocus = useRef<HTMLElement | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setMenu(null);
    if (restoreFocus) returnFocus.current?.focus({ preventScroll: true });
    returnFocus.current = null;
  }, []);

  useEffect(() => {
    let keyboardOpenedAt = 0;
    const open = (target: EventTarget | null, x: number, y: number) => {
      if (!(target instanceof HTMLElement) || isTextInput(target) || target.closest('[inert]')) return false;
      const content = resolveRef.current(target);
      if (!content) return false;
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setMenu({ ...content, x, y });
      return true;
    };
    const onContextMenu = (e: MouseEvent) => {
      // The keyboard may still fire its own contextmenu after we opened the menu on keydown
      const target = e.target as HTMLElement;
      if (target.closest?.('[data-context-menu]') || performance.now() - keyboardOpenedAt < 500) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) return;
      if (open(target, e.clientX, e.clientY)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      const target = e.target as HTMLElement;
      const rect = target.getBoundingClientRect?.();
      if (rect && open(target, rect.left + 8, rect.bottom)) {
        e.preventDefault();
        keyboardOpenedAt = performance.now();
      }
    };
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    const inMenu = (e: Event) => (e.target as HTMLElement).closest?.('[data-context-menu]');
    const onPointerDown = (e: PointerEvent) => {
      if (!inMenu(e)) close(false);
    };
    const onScroll = (e: Event) => {
      if (!inMenu(e)) close(false);
    };
    const onDismiss = () => close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [menu, close]);

  if (!menu) return null;
  return (
    <MenuPanel
      key={`${menu.x},${menu.y},${menu.label}`}
      content={menu}
      at={menu}
      autoFocus
      onCloseAll={() => close()}
    />
  );
};
