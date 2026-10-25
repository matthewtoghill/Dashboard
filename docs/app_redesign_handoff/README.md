# Handoff: "Calm Today" dashboard redesign

## Overview
This is a redesign of the Dashboard app shell (header and sidebar) and three screens:

1. **Home**, which replaces "Dashboard Home" / "Dashboard Overview" (design ref `1a`)
2. **All Active** task list (`2a`)
3. **Project** view, shown with "Platform API" as the example (`2b`)

It goes after two problems with the current app:

- **Too many cards and too much visual noise.** The current Home stacks about 11 bordered cards.
- **Claude sessions are buried.** Today they sit as a card at the top of a long scroll, styled the same as everything else.

The new Home puts four things first: **today's agenda**, **Claude sessions that need you**, **in-progress work**, and **stats/streak**. Everything else (trends, projects, stale tasks, Azure DevOps, scratchpad, quick links) moves into one tabbed drawer at the bottom.

This is an *evolution* of the current UI, not a rewrite. It keeps the same information architecture, data, Tailwind zinc/indigo palette and Lucide icons. Most of the work is restyling and reorganising existing components.

## About the design files
The files in this bundle are **design references built in HTML**. They show the intended look and behaviour; they are **not production code to copy**. Recreate them in the existing codebase (React + TypeScript + Tailwind v4 + TanStack Query + lucide-react, under `src/client`), using its established components, hooks and data flow.

- `Calm Today Reference.dc.html` shows the three screens stacked. Open it in a browser with `support.js` in the same folder.
- All task, session and ADO data in the mock is **sample data**. Wire everything to the real queries already used in `App.tsx`.
- The mock uses inline hex values. In the codebase, use the equivalent **Tailwind classes** listed in "Design tokens" below.

## Fidelity
**High fidelity for dark mode** at 1440×900. Colours, type sizes, spacing and radii are final. Recreate them closely using Tailwind utilities.

**Light mode was not designed.** The app supports light, dark and system themes (`dark:` variant on `.dark`). Keep the same structure and derive light values from the light classes the codebase already uses (e.g. `bg-white` / `zinc-50` surfaces, `zinc-200` borders, `zinc-900` text). Flag light mode for design review.

---

## Codebase map

| Design area | Current source | Change |
|---|---|---|
| Header | `App.tsx` (`<header>` ~L638) | Simplify (see §1) |
| Sidebar | `components/Sidebar.tsx` | Restyle; collapse Saved views and Tags; move Archive (see §2) |
| Claude attention banner | `components/ClaudeSessions.tsx` (`primaryClaudeSession`, `ClaudeSessionActions`, `resumeCommand`, `sessionLink`) | **New** component, `ClaudeAttentionBanner` |
| Home stats strip | `components/DashboardWidgets.tsx` (4 stat cards) | Replace with an inline `HomeStatsStrip` |
| Up next | `components/TaskWidgets.tsx` → `AgendaCard` | Remove the card chrome; becomes a plain section |
| In progress (rail) | `TaskWidgets.tsx` → `InProgressCard` | Compact rail version |
| Claude sessions (rail) | `ClaudeSessions.tsx` → `ClaudeSessionsCard` | Compact rail list |
| Bottom drawer | `DashboardWidgets.tsx` (trends, projects), `TaskWidgets.tsx` (`StaleCard`, `AdoCard`), scratchpad, quick links, `BackupStatusLine` | **New** `HomeDrawer` with tabs that host the existing widgets |
| List toolbar | `components/TaskListToolbar.tsx`, `SavedViewControls.tsx` | Restyle into one quiet row |
| Quick add | `components/QuickAddBar.tsx` | Restyle; parsing logic unchanged |
| Task rows | `components/TaskRow.tsx`, `ReorderableTaskList.tsx`, `TaskListHeader` | Column grid layout (see §4) |
| Grouping | `utils/taskView.ts` (`groupTasks`, `groupBy: 'dueDate' \| 'status' …`) | Due-date buckets (see §4) |
| Project ADO panel | `components/AdoProjectPanel.tsx` (`arrangeAdoItems`) | Compact inbox with checkboxes (see §5) |
| Priority / project colours | `utils/taskUtils.ts` (`PRIORITY_CONFIG`, project colours) | Reuse; text colours are listed below |

---

## Screens

The global layout applies to all screens:

- Root: `bg-zinc-950`, full viewport, flex column.
- **Header** is 52px high.
- Below it, a flex row: **Sidebar** (232px, fixed), then **Main** (`flex-1`, `min-w-0`).
- Main padding is `28px 40px` on Home and `24px 40px` on list screens.
- Font is the default Tailwind sans stack (`ui-sans-serif, system-ui, sans-serif`). Mono is `ui-monospace, Menlo, monospace`.

### §1 Header (all screens)
- `h-[52px] px-5 gap-4 flex items-center border-b border-zinc-800/80 bg-zinc-950`.
- **Brand block** (`w-[212px]`, so it lines up with the sidebar edge):
  - Logo tile: 28×28, `rounded-lg bg-indigo-600 text-white`, Lucide `SquareCheckBig` at 15px.
  - Wordmark "Dashboard": 15px / 600, `tracking-[-0.01em]`, `text-zinc-100`.
  - **Removed:** the "Personal Task Manager" subtitle.
- **Search / command field**:
  - Container: `flex-1 max-w-[560px] h-8 px-2.5 rounded-lg bg-zinc-900 border border-zinc-800`, 13px `text-zinc-500`.
  - `Search` icon at 14px.
  - Placeholder: **"Search tasks or run a command…"**.
  - Two key hints on the right, "/" and "Ctrl K": 11px / 500 mono, `px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400`.
  - This field **merges** the old separate "Ctrl+K" button into the search. Typing searches as today; Ctrl+K still opens `CommandPalette`.
- **Right icons**: `CloudDownload` (backup), `Settings`, `Sun`/`Moon` (theme toggle). Each is 16px, `p-2 rounded-lg text-zinc-400`, hover `bg-zinc-900 text-zinc-200`.
- **Removed:**
  - The "19 active • 18 done" pill. Those counts now live in the sidebar and the Home stats strip.
  - The visible sidebar toggle (`PanelLeft`). *Decision to confirm:* keep `sidebarOpen` working through a keyboard shortcut (e.g. `[`) and the command palette, or put the `PanelLeft` button back to the left of the logo.

### §2 Sidebar (all screens)
- Container: `w-[232px] shrink-0 border-r border-zinc-800/80 px-2.5 py-3.5 flex flex-col gap-[22px] text-[13px]`. There's no tinted background (the current `bg-zinc-900/40` is removed).
- **Primary nav** (no section heading, items with `gap-px`):
  - Item: `flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-zinc-300`. Icon is 15px `text-zinc-400`. Label is `flex-1`. Count is 12px `text-zinc-500`.
  - Active item: `bg-indigo-500/15 text-indigo-300 font-medium`, with the icon inheriting that colour.
  - Hover (not drawn; recommended): `bg-zinc-900`.
  - Items in order:
    - **Home** (renamed from "Dashboard Home"), `LayoutDashboard`. Its badge is the count of `needs_attention` Claude sessions, shown as a pill: 11px / 600, `px-1.5 py-px rounded-full bg-amber-500/20 text-amber-300`. Hide the pill when the count is 0.
    - **All Active**, `Inbox`, with a count.
    - **Today & Overdue**, `Calendar`. Count in `text-emerald-400 font-semibold`.
    - **Upcoming**, `CalendarClock`, with a count.
    - **Calendar**, `CalendarDays`, no count.
    - **Completed**, `CircleCheck`, with a count.
- **Projects** section:
  - Heading row: 11px / 600, `uppercase tracking-[0.06em] text-zinc-500`, `px-2.5 pb-1.5`, with a `Plus` icon (13px) on the right for new project.
  - Project rows: `px-2.5 py-1.5 gap-2.5`. Colour dot is 8px round in the project colour. Name is `text-zinc-300`, count is 12px `text-zinc-500`.
  - Active project row uses the same active style as nav (`bg-indigo-500/15 text-indigo-300 font-medium rounded-lg`).
- **Secondary group** (`text-zinc-400`):
  - **Saved views** and **Tags** are collapsible rows: `ChevronRight` (13px) + label + count. Both are **collapsed by default**. Expanding shows the current lists (Tags keeps its chip style). Persist the open/closed state in localStorage.
  - **Archive** row (`Archive` icon) moves here, out of the primary nav.

### §3 Home (`1a`)
Main is a flex column, `gap-[22px]`, filling the height. From top to bottom:

**3.1 Greeting row**
- `flex items-end justify-between gap-6`.
- Left side:
  - Date "Friday, 24 October": 12px / 500 `text-zinc-500`. Format is `weekday, d MMMM`.
  - `h2` greeting, `mt-1` 22px / 600 `tracking-[-0.015em]`: "Good morning" before 12:00, "Good afternoon" before 18:00, "Good evening" after.
- Right side is the **stats strip**, replacing the four stat cards: `flex items-center gap-5 text-xs text-zinc-400`.
  - **Progress**: a 16px ring (conic gradient, `indigo-500` on `zinc-800`), then **"62%"** (`text-zinc-100 font-semibold`), " done ", then "18/29" in `text-zinc-500`. Same maths as the current "Current Progress" card (completed out of non-archived).
  - Divider: 1×14px `bg-zinc-800`.
  - **Completed today**: `CircleCheck` 13px + **"4"** + " today", all `text-emerald-400`.
  - **Streak**: `Flame` 13px + **"8d"** + " streak", `text-amber-400`.
  - **Overdue**: `TriangleAlert` 13px + **"1"** + " overdue", `text-red-400`. Clicking it opens Today & Overdue. Hide it when 0.

**3.2 Claude attention banner** (new; render only when `primaryClaudeSession(sessions)?.state === 'needs_attention'`)
- Container: `flex items-center gap-3.5 px-4 py-3.5 rounded-xl bg-amber-500/[.08] border border-amber-500/30`.
- Icon tile: 34×34, `rounded-[9px] bg-amber-500/20 text-amber-300`, `Bot` icon at 17px.
- Text block (`flex-1 min-w-0`):
  - Eyebrow: "CLAUDE NEEDS YOU", 11px / 600, `uppercase tracking-[0.04em] text-amber-300`. After it, in normal case `text-zinc-400`: `{cwd basename} · {relative time}`, e.g. "platform-api · 2 min ago".
  - Title: 14px / 500 `text-zinc-100`. Use the linked task's title if there is one, otherwise `session.title`.
  - Detail: 12px `text-zinc-300`, showing `session.attentionMessage`. Render backticked or command text as an inline code chip: 11.5px mono, `px-1.5 py-px rounded bg-black/35 text-amber-200`. If `attentionMessage` is empty, show "Waiting for your input".
- Actions (`flex gap-2 shrink-0`):
  - Primary **"Open in Claude"**: `ExternalLink` 13px, `px-3 py-[7px] rounded-lg bg-amber-500 text-zinc-900 text-xs font-semibold`, hover `bg-amber-400`. Opens `sessionLink(session).url`.
  - Secondary **"Resume"**: `Copy` 13px, `px-2.5 py-[7px] rounded-lg border border-zinc-700 text-zinc-300 text-xs`. Copies `resumeCommand(session)` and shows the existing copied feedback.
- If more than one session needs attention, show the newest one and add a small "+N more" text link (12px `text-amber-300`) after the actions. It scrolls to the rail list. *(Not drawn; recommended.)*
- Dismissing still works from the rail list (existing dismiss action).

**3.3 Two-column body**
- `flex-1 min-h-0 grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-10`.
- **Section header pattern** (used by all three sections): `flex items-baseline justify-between border-b border-zinc-800 pb-2.5`. Title is `h3` 14px / 600. The right-hand meta is 12px `text-zinc-500`. There is **no card container** (no background, border or radius) and **no collapse chevrons**.

**Left column: "Up next"** (data from `AgendaCard`)
- Header meta: "Overdue and next 7 days".
- Groups, in order: Overdue, Today, Tomorrow, then each later day by name ("Mon, Oct 27"), up to 7 days out.
- Group label: 11px / 600 `uppercase tracking-[0.06em]`, `px-2 pt-3 pb-1` (the first group uses `pt-0.5`). Overdue is `text-red-400`; the others are `text-zinc-400`, followed by the count in `font-normal text-zinc-500`.
- Row: `flex items-center gap-3 p-2 rounded-lg`, hover `bg-zinc-900/60`.
  - Status checkbox: 18×18 `rounded-md border border-zinc-600`.
    - **In progress:** `border-amber-400 bg-amber-400/15` with a 7×7 `rounded-sm bg-amber-400` square inside, and the row gets `bg-amber-500/5`.
    - Keep the `TaskStatusCheckbox` cycling behaviour.
  - Project dot: 7px.
  - Title: 14px `text-zinc-100 flex-1`.
  - Trailing meta, one item:
    - For overdue tasks, the due date (12px `text-red-400`, "Wed, Oct 22").
    - Otherwise badges (see the badge spec in §4): Claude session badge and PR / work-item badge.
- Clicking a row opens `TaskDetailDrawer`, as now.

**Right column: rail** (`flex flex-col gap-[26px]`)
- **"In progress"** (header meta is the count):
  - Rows: `flex items-center gap-2.5 px-1 py-1.5`. 7px project dot, title 13px `text-zinc-200` truncated, due 11px `text-zinc-400` ("Today", "Oct 29", or "—" when no date).
- **"Claude sessions"** (header meta "{n} live"; excludes `ended`):
  - Rows: `flex items-center gap-2.5 px-1 py-1.5`.
  - State dot, 8px:
    - `needs_attention`: `bg-amber-400` with a 3px `amber-400/20` ring.
    - `running`: `bg-indigo-400`.
    - `idle`: `bg-emerald-400`.
  - Two-line text: title 13px `text-zinc-200`; subline 11px `text-zinc-500`, `{cwd basename} · {state label}[ · {lastTool}]`, e.g. "client-portal · running · Edit", "infra · idle 14 min".
  - On hover, show the existing action icons on the right (link task, open, copy resume, dismiss) at 14px `text-zinc-500`.
  - Order: needs_attention, then running, then idle.

**3.4 Bottom drawer** (new `HomeDrawer`)
- `shrink-0 border-t border-zinc-800 pt-3 flex flex-col gap-3`.
- **Tab row** (`flex items-center gap-1 text-xs`):
  - Tab: `px-2.5 py-[5px] rounded-md cursor-pointer`. Active is `bg-zinc-800 text-zinc-100`; inactive is `text-zinc-400`, hover `text-zinc-200`.
  - Tabs: **Trends**, **Projects**, **Gone stale · {n}**, **Azure DevOps · {n} review**, **Scratchpad**, **Quick links**. Counts are dropped from a label when 0.
  - Right side: `BackupStatusLine` in `text-zinc-500` ("Last backup 3 h ago").
- **Panel**:
  - The mock shows a compact 64px panel. Implement it as auto height with `max-h-[240px] overflow-auto`.
  - Persist the selected tab in `localStorage['dashboard_home_drawer_tab']` (default `Trends`).
  - Clicking the active tab again collapses the panel. Persist that state too.
- **Panel contents** reuse the existing widget bodies without their card chrome:
  - *Trends*: 14 bars, each 14px wide, `gap-[5px]`, max height 56px, `rounded-t-[3px] bg-indigo-500`, with today in `bg-indigo-300`. Next to the bars: **"34"** (20px / 700 `text-zinc-100`) + " done in 14 days · " + "+7 vs previous" (`text-emerald-400`). Show a negative delta in `text-zinc-400`.
  - *Projects*: the existing project progress bars, in a 2–3 column grid.
  - *Gone stale*: the `StaleCard` rows.
  - *Azure DevOps*: the `AdoCard` content (stat chips + Import button).
  - *Scratchpad*: the existing textarea and "Convert top line to Task".
  - *Quick links*: the existing links grid (4 columns), plus "Add link".
- **Removed from Home:** the "Dashboard Overview" title and subtitle, all four stat cards, and the collapsible card wrappers.

### §4 All Active (`2a`)
Main is a flex column with `gap-3.5`.

**4.1 Title + toolbar row** (`flex items-center justify-between gap-4`)
- Left: `h2` "All Active" (22px / 600, `tracking-[-0.015em]`), then the meta "19 tasks · 5 projects" (13px `text-zinc-500`, `gap-2.5`, baseline aligned).
- Right: the `TaskListToolbar`, restyled. `flex items-center gap-2 text-xs text-zinc-400`:
  - **Layout segmented control**:
    - Container: `p-0.5 rounded-lg bg-zinc-900 border border-zinc-800`.
    - Items: `flex items-center gap-[5px] px-2 py-[3px] rounded-md`, each with a 13px icon: List (`List`), Month (`CalendarDays`), Week (`CalendarRange`).
    - Active item: `bg-zinc-800 text-zinc-100`.
  - **Ghost dropdowns**, each `flex items-center gap-1.5 px-[9px] py-1 rounded-lg` with a 13px leading icon and a `ChevronDown` at 11px; hover `bg-zinc-900 text-zinc-200`:
    - Group by (`Layers`), showing the current value ("Due date").
    - Sort (`ArrowUpDown`) ("Due date").
    - Priority filter (`Flag`) ("Any priority").
  - Divider: 1×16 `bg-zinc-800`.
  - **Save view** (`BookmarkPlus` 13px, `text-zinc-300`), wired to `SavedViewControls`.

**4.2 Quick add** (`QuickAddBar`, restyled)
- Container: `h-10 px-3 gap-2.5 flex items-center rounded-[10px] bg-zinc-900 border border-zinc-800 text-[13px]`. Focus state: `border-indigo-500/60 ring-2 ring-indigo-500/15`.
- `Plus` icon, 16px `text-indigo-400`.
- Placeholder: "Add a task…", then the hint "e.g. Call Sam !high #work @fri ~weekly" in `text-zinc-600`. Don't put the "(Shortcut: N)" text in the placeholder any more; it moves to the key hint at the end.
- Picker buttons as icon-only 14px buttons (`p-[5px] text-zinc-500`, hover `text-zinc-300`): `Flag`, `Folder`, `Calendar`, `Tag`. They open the existing pickers. Selected values show as the current chips below or inline (keep the existing behaviour).
- Key hint "N" (same kbd style as the header).

**4.3 Column header**
- Grid: `grid-cols-[minmax(0,1fr)_140px_130px_130px_84px] gap-3 px-2 pt-1.5`.
- 11px / 600 `uppercase tracking-[0.06em] text-zinc-600`.
- Columns: Task · Tags · Project · Due · Priority.

**4.4 Groups and rows**
- **Due-date buckets** for `groupBy: 'dueDate'` (extend `groupTasks` in `utils/taskView.ts`):

  | Bucket | Label colour |
  |---|---|
  | Overdue | `text-red-400` |
  | Today | `text-emerald-300` |
  | Tomorrow | `text-indigo-300` |
  | This week (rest of the next 7 days) | `text-zinc-400` |
  | Later (more than 7 days out; **collapsed by default**) | |
  | No date | `text-zinc-500` |

- Group label: 11px / 600 `uppercase tracking-[0.06em] px-2 pt-3 pb-1.5`, count in `font-normal text-zinc-600`.
- **Row**:
  - Same grid as the header, `items-center gap-3 p-2 border-t border-zinc-800/50` (≈ `#1c1c20`).
  - Hover: `bg-zinc-900/60`, and reveal the existing `TaskRow` hover actions over the right-hand cells.
  - Selected / keyboard focus (`useTaskListKeyboard`): `bg-indigo-500/10`.
  - **In progress:** `bg-amber-500/[.04]` plus `shadow-[inset_2px_0_0_theme(colors.amber.400)]` (a 2px amber left edge).
- **Cell 1, Task** (`flex items-center gap-2.5 min-w-0`):
  - 18px status checkbox (as in §3.3).
  - Title: 14px `text-zinc-100 truncate`.
  - Then the badges.
- **Badges** (`inline-flex items-center gap-1 px-1.5 py-px rounded text-[11px]`, icon 11px, `shrink-0`):

  | Badge | Icon | Text | Colours |
  |---|---|---|---|
  | Subtasks | `SquareCheck` | "2/4" | `bg-zinc-800 text-zinc-300` |
  | Notes | `AlignLeft` | (none) | `bg-zinc-800 text-zinc-400` |
  | Recurring | `Repeat` | (none) | `bg-zinc-800 text-zinc-400` |
  | Claude, needs attention | `Bot` | (none) | `bg-amber-500/15 text-amber-300` (`ClaudeSessionBadge`) |
  | Claude, running / idle | `Bot` | (none) | `bg-indigo-500/15 text-indigo-300` |
  | ADO PR | `GitPullRequest` | "PR 482" | `bg-zinc-800 text-zinc-300` |
  | ADO work item | `ExternalLink` | "#3127" | `bg-zinc-800 text-zinc-300` |

- **Tags**: 12px `text-zinc-400 truncate`, joined with " · ".
- **Project**: 7px dot + name, 12px `text-zinc-300`.
- **Due**: pill `justify-self-start text-xs px-[7px] py-0.5 rounded-[5px]`:

  | State | Text | Background | Example |
  |---|---|---|---|
  | overdue | `text-red-300` | `bg-red-500/12` | "Overdue · Oct 22" or just "Oct 22" |
  | today | `text-emerald-300` | `bg-emerald-500/12` | "Today" |
  | tomorrow | `text-indigo-300` | `bg-indigo-500/15` | "Tomorrow" |
  | dated | `text-zinc-300` | `bg-zinc-800` | "Wed, Oct 29" |
  | none | `text-zinc-600` | no background | "No date" |

  Clicking the pill opens `DatePicker` inline, as today.
- **Priority**: 6px dot + label, 12px:

  | Priority | Label colour | Dot colour |
  |---|---|---|
  | None | `zinc-500` | `zinc-600` |
  | Low | `sky-300` | `sky-500` |
  | Medium | `amber-300` | `amber-500` |
  | High | `orange-300` | `orange-500` |
  | Urgent | `red-300` | `red-500` |

  Clicking it opens the priority menu.
- **Footer row** (`flex items-center gap-2 p-2 border-t text-xs text-zinc-500`):
  - "› Later 6" and "› Completed 18" are collapsible toggles.
  - On the right, "Archive completed" (`Archive` 12px) runs the existing archive action.
- Drag-reorder (`ReorderableTaskList`) still applies when `sortBy: 'manual'`.

### §5 Project view (`2b`)
- Sidebar: the active project row is highlighted (§2).
- **Title row**: 12px project-colour dot, then `h2` "{Project name}" (22px / 600), then "{n} open" (13px `text-zinc-500`), then a `Settings2` icon button (15px `text-zinc-500 p-1`) that opens `ProjectSettingsDialog`. The toolbar on the right matches §4.1, with defaults **Group: Status** and **Sort: Priority**.
- **Progress strip** (`flex items-center gap-[18px] text-xs text-zinc-400`):
  - A 160×5 `rounded-full bg-zinc-800` bar, filled in the project colour. Then **"9 of 16"** (`text-zinc-100 font-semibold`) + " done".
  - Divider (1×14 `bg-zinc-800`), then "1 overdue" in `text-red-400`. Hide it when 0.
  - Divider, then a 7px `bg-amber-400` dot + "Claude is waiting on you" + `ArrowRight` 12px, all `text-amber-300`. Show this only when a `needs_attention` session is linked to one of this project's tasks; clicking it opens that session. Hide it otherwise.
- **Azure DevOps panel** (`AdoProjectPanel`, restyled; only when the project has an ADO link):
  - Container: `rounded-[10px] border border-zinc-800 bg-[#0f0f12]`.
  - **Header** (`flex items-center gap-2.5 px-3.5 py-2.5 border-b border-[#1f1f23]`):
    - `ChevronDown` 14px `text-zinc-500` to collapse (persist per project).
    - `GitPullRequest` 14px `text-sky-400`.
    - "Azure DevOps" 13px / 600.
    - "{adoProject} · checked {relative}" 12px `text-zinc-500`.
    - Pills, 11px `px-[7px] py-px rounded-full`: "{n} new" (`bg-sky-500/15 text-sky-300`) and "{n} review" (`bg-violet-500/15 text-violet-300`).
    - Right side: `RefreshCw` icon button (13px `text-zinc-400 p-1`) and the primary **"Import {n}"** button: `Download` 12px, `px-2.5 py-[5px] rounded-[7px] bg-indigo-600 text-white text-xs font-medium`, hover `bg-indigo-500`. Disable it when n = 0.
  - **Rows** (from `arrangeAdoItems`):
    - Grid: `grid-cols-[18px_90px_70px_minmax(0,1fr)_70px] gap-3 items-center px-3.5 py-2 text-[13px] border-t border-zinc-900`.
    - Checkbox: 15px `rounded border border-zinc-600`; checked is `bg-indigo-600 border-indigo-600` with a white check. New items are pre-checked.
    - Type: 12px, icon plus label, coloured by type: Bug is `text-red-300` with `Bug`; PBI / Task is `text-sky-300` with `SquareCheck`; Review is `text-violet-300` with `GitPullRequest`.
    - ID: 12px mono `text-zinc-500` ("3152" or "PR 491").
    - Title: `text-zinc-200 truncate`.
    - State: 12px `text-zinc-400`.
  - "Import {n}" imports the checked items and counts them live. Items already imported as tasks are hidden from this list. Keep `AdoProjectLinksEditor` in project settings.
- **Quick add**: as §4.2, with the placeholder "Add to {Project}…" and the hint "!high #backend @fri". The project is preset, so drop the `Folder` picker.
- **List**: the same row spec as §4, with grid `grid-cols-[minmax(0,1fr)_140px_130px_84px]` (no Project column). Status groups are "In progress" (`text-amber-400`), then "To do" (`text-zinc-400`). The footer shows "› Completed {n}".

---

## Interactions and behaviour
- **Transitions:** use `transition-colors duration-150` on hover and active surfaces. The drawer panel open/close is a height/opacity transition, 180ms ease-out. Nothing else animates. The banner appears without animation, so it doesn't flash while data polls.
- **Claude polling:** keep the current session query and interval. The banner, the sidebar Home badge and the rail all derive from the same data.
- **Keyboard:** keep all existing shortcuts (`/` search, Ctrl K palette, `N` quick add, list navigation). Add a shortcut for the sidebar toggle (see §1).
- **Empty states** (not drawn; recommended copy, 13px `text-zinc-500`, no illustration):
  - Up next: "Nothing due in the next 7 days."
  - In progress: "Nothing in progress."
  - Claude sessions: "No live sessions."
  - Hide the banner when nothing needs attention.
  - All Active with no results: "No active tasks match these filters."
- **Loading:** reuse the current skeleton/loading handling. Rows can render as 36px `bg-zinc-900` bars.
- **Responsive** (designed at 1440 wide; recommended):
  - Below 1100px, the Home rail stacks under Up next.
  - In lists, hide the Tags column below 1200px and the Project column below 1000px.
  - Below 900px, the sidebar becomes an overlay.

## State
New client state only:
- `homeDrawerTab: 'trends' | 'projects' | 'stale' | 'ado' | 'scratchpad' | 'links'`, persisted to localStorage.
- `homeDrawerCollapsed: boolean`, persisted.
- `sidebarSections: { savedViews: boolean; tags: boolean }`, persisted.
- `adoPanelCollapsed[projectId]` and the ADO selection set, which resets on refresh.

There are no new API endpoints. Everything comes from existing queries: tasks, projects, dashboard trends, claude sessions, ADO and backups.

## Design tokens (dark)

| Role | Hex | Tailwind |
|---|---|---|
| App background | `#09090b` | `zinc-950` |
| Surface (inputs, segmented, drawer tab active base) | `#18181b` | `zinc-900` |
| ADO panel surface | `#0f0f12` | arbitrary |
| Border / dividers | `#27272a` | `zinc-800` |
| Header/sidebar border | `rgba(39,39,42,.8)` | `zinc-800/80` |
| Row divider | `#1c1c20` | `zinc-800/50` |
| Subtle divider | `#1f1f23` | arbitrary |
| Text, primary | `#f4f4f5` | `zinc-100` |
| Text, rail/title | `#e4e4e7` | `zinc-200` |
| Text, nav/body | `#d4d4d8` | `zinc-300` |
| Text, secondary | `#a1a1aa` | `zinc-400` |
| Text, meta | `#71717a` | `zinc-500` |
| Text, faint / column headers | `#52525b` | `zinc-600` |
| Strong border (secondary button) | `#3f3f46` | `zinc-700` |
| Accent | `#4f46e5` / `#6366f1` / `#818cf8` / `#a5b4fc` | `indigo-600/500/400/300` |
| Accent active background | `rgba(99,102,241,.15)` | `indigo-500/15` |
| Attention | `#f59e0b` / `#fbbf24` / `#fcd34d` / `#fde68a` | `amber-500/400/300/200` |
| Success | `#34d399` / `#6ee7b7` | `emerald-400/300` |
| Danger | `#f87171` / `#fca5a5` | `red-400/300` |
| ADO | `#38bdf8` / `#7dd3fc`, `#c4b5fd` | `sky-400/300`, `violet-300` |

Project colours (sample data; use each project's stored colour): `#6366f1`, `#3b82f6`, `#10b981`, `#f59e0b`, `#ec4899`.

**Type scale**

| Size | Weight | Use |
|---|---|---|
| 22px | 600, `-0.015em` | Page title |
| 15px | 600 | Wordmark |
| 14px | 600 | Section titles |
| 14px | 400–500 | Task titles |
| 13px | | Sidebar, rail, inputs |
| 12px | | Meta, toolbar, pills |
| 11px | 600, uppercase, `0.06em` | Labels |
| 11px | | Badges, kbd |

**Spacing**
- Main padding: 40px horizontal, 24–28px top.
- Section gaps: 22px (Home), 14px (lists).
- Two-column gap: 40px. Rail section gap: 26px.
- Row padding: 8px (`p-2`).
- Sidebar item padding: 7px 10px (nav), 6px 10px (projects).

**Radii**
- 4px: badges, kbd
- 5px: due pill
- 6px: checkbox, tabs, segment items
- 7px: Import button
- 8px: nav items, inputs, buttons
- 9px: banner icon tile
- 10px: quick add, ADO panel
- 12px: banner
- Full: dots, count pills

**Shadows:** none in the app UI. Depth comes only from borders and tints.

## Assets
- Icons: **Lucide** (already a dependency, `lucide-react`):
  - Shell and nav: `SquareCheckBig`, `Search`, `CloudDownload`, `Settings`, `Sun`/`Moon`, `LayoutDashboard`, `Inbox`, `Calendar`, `CalendarClock`, `CalendarDays`, `CalendarRange`, `CircleCheck`, `Archive`, `Plus`.
  - Disclosure and stats: `ChevronRight`, `ChevronDown`, `Flame`, `TriangleAlert`.
  - Claude and ADO: `Bot`, `ExternalLink`, `Copy`, `Link2`, `GitPullRequest`, `Bug`, `RefreshCw`, `Download`.
  - Task and list controls: `SquareCheck`, `AlignLeft`, `Repeat`, `List`, `Layers`, `ArrowUpDown`, `Flag`, `BookmarkPlus`, `Folder`, `Tag`, `Settings2`, `ArrowRight`.
- No images or custom fonts.
- **Favicon / app icon** (`favicon/`): the header logo tile, which is a Lucide `SquareCheckBig` in white on an `indigo-600` (`#4f46e5`) rounded square (corner radius 25% of the size).
  - Files: `favicon.svg` (preferred), `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`.
  - Copy them to the client's public/static folder and add this to `index.html` `<head>`:
    ```html
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
    <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    ```
  - Use `icon-192.png` / `icon-512.png` in a web manifest if one is added.

## Files in this bundle
- `README.md`: this document.
- `Calm Today Reference.dc.html`: the hi-fi reference for Home (1a), All Active (2a) and Project (2b). The Home drawer tabs are clickable.
- `support.js`: the runtime needed to open the reference file locally.
- `favicon/`: the app icon in SVG and PNG sizes (see Assets).
- `screenshots/1a-home.png`, `screenshots/2a-all-active.png`, `screenshots/2b-project.png`: 1440×900 renders of each screen, using the sample data.

## Suggested implementation order
1. Shell: header simplification and sidebar restyle (`App.tsx`, `Sidebar.tsx`).
2. Shared row styles: `TaskRow` column grid, badges, due pill, priority cell; `TaskListToolbar` and `QuickAddBar` restyle; due-date buckets in `taskView.ts`. This gives you All Active.
3. Project view: progress strip and `AdoProjectPanel` inbox.
4. Home: stats strip, `ClaudeAttentionBanner`, the Up next / rail split, and `HomeDrawer` (moving the existing widgets in).
5. Light-mode pass, empty states, responsive breakpoints. Run the existing tests (`src/server/__tests__`); `taskView.test.ts` will need cases for the new buckets.

---

## Implementation decisions

Choices made while building this on the `app-redesign` branch, where the spec left a decision open or the existing app differed.

- **Group and sort defaults are unchanged.** The spec suggests Group: Due date / Sort: Due date for All Active and Group: Status / Sort: Priority for projects. We kept the current behaviour instead: one group/sort setting that persists across navigation, starting at no grouping, newest first. Due-date buckets (Overdue, Today, Tomorrow, This week, Later, No date) apply whenever Group: Due date is chosen. Worth revisiting once the new lists have been used for a while.
- **Sidebar toggle.** No visible `PanelLeft` button. The header logo tile is the toggle, plus the `[` shortcut and a "Toggle Sidebar" command palette entry. The open/closed state is remembered per browser.
- **Widget settings map onto Home.** Progress & stats controls the stats strip, Up next and In progress control their sections, Trends controls the Trends and Projects drawer tabs, and Stale, Azure DevOps, Scratchpad and Quick links control their tabs. The compact summary bar above task lists is gone, and so is its "Summary bar in task views" setting (the stored field is left in place so older data still validates).
- **Row hover actions** (rename, archive, delete) appear at the end of the Task cell rather than over the right-hand cells, so the Due and Priority controls stay clickable on hover.
- **Tags in list rows** are plain text with a hover "+" to add a tag. Removing a tag happens in the task drawer.
- **Project ADO panel** drops the old filter, group, sort and "show imported" controls. Imported items are hidden, new work items start ticked, reviews start unticked, and the ticks reset after each check.
- **Claude sessions rail** lists live sessions only (not ended, not cleared). Ended sessions still show on their task's drawer.
- **Light mode** follows the structure of the dark design using the app's existing light classes. It still needs a design review.
