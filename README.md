# Dashboard

A local-first personal task manager and dashboard. It runs as a small Node server on your machine, stores everything in a single SQLite file, and needs no cloud account.

Besides tasks, it tracks your Claude Code sessions and pulls outstanding work from Azure DevOps, so the day's work sits in one place.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Using the app](#using-the-app)
- [Configuration](#configuration)
- [Backups and restore](#backups-and-restore)
- [Claude session tracking](#claude-session-tracking)
- [Azure DevOps import](#azure-devops-import)
- [Development](#development)
- [Project layout](#project-layout)
- [Further docs](#further-docs)

## Features

**Tasks**
- Quick-add bar with inline syntax for priority, project, tags, due date and repeats.
- Priorities, due dates, tags, projects with colours, and subtasks with progress.
- Task drawer with markdown notes (links, checklists), linked Claude sessions, linked Azure DevOps items and an activity log.
- Recurring tasks: daily, weekdays, every N days/weeks/months, counted from the due date or from completion.
- Archive instead of delete, with Undo on delete, archive and clear.
- Drag-to-reorder when sorted manually.

**Views**
- Home: today's agenda, Claude sessions that need you, in-progress work, stats and streak, plus a drawer with trends, project progress, stale tasks, Azure DevOps, scratchpad and quick links.
- All Active, Today & Overdue, Upcoming, Completed, Archive and per-project views.
- Calendar (month and week) with drag-to-reschedule and ghost entries for future repeats.
- Group by status, priority, project or due date; sort by priority, due date, created date or manual order; filter as you type.
- Saved views: name a filter/group/sort combination and reopen it from the sidebar.

**Keyboard and menus**
- Keyboard-first: shortcuts for adding, searching, navigating and editing (press `?` for the full list).
- Command palette (`Ctrl+K`) to jump to views and run actions.
- Right-click menus on tasks and projects.

**Integrations and data**
- Claude Code session tracking through hooks, with links between sessions and tasks.
- Azure DevOps work item and pull request import through the `az` CLI, with a background check for new and closed items.
- JSON export/import, CSV task export, and automatic SQLite backups.
- Light, dark and system themes; adjustable density.

## Getting started

### Prerequisites

- Node.js 22 or later, with npm.
- Optional: [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) with the `azure-devops` extension, for the Azure DevOps import.
- Optional: Claude Code, for session tracking.

`better-sqlite3` is a native module. npm normally downloads a prebuilt binary; if that fails, install the Visual Studio C++ build tools and run `npm install` again.

### Run

For everyday use, build once and start the server:

```powershell
npm run build
npm start
```

Open http://127.0.0.1:3444. The server serves both the API and the built app.

For development with hot reload:

```powershell
npm run dev
```

Open http://localhost:5444. Vite serves the app and proxies `/api` to the API server on port 3444.

The database is created at `data/dashboard.db` on first start. Schema upgrades run automatically, with a backup taken first.

## Using the app

### Quick-add syntax

Type a task into the quick-add bar and press `Enter`. These tokens are stripped from the title and applied to the task:

| Token | Meaning | Examples |
| :--- | :--- | :--- |
| `!priority` | Priority | `!urgent` `!high` `!med` `!low` `!none`, or `!p4` to `!p0` |
| `#name` | Project if a project has that name (case-insensitive), otherwise a tag | `#work` `#bug` |
| `@date` | Due date | `@today` `@tomorrow` `@tmrw` `@fri` `@next-week` `@eom` `@+3d` `@+2w` `@+1m` `@2026-11-01` |
| `~repeat` | Recurrence | `~daily` `~weekdays` `~weekly` `~monthly` `~3d` `~2w` `~1m` |

Add `!` to a repeat (`~2w!`) to count the next occurrence from completion rather than from the due date.

Example: `Review release notes !high #work @fri ~weekly`

### Keyboard shortcuts

Global:

| Key | Action |
| :--- | :--- |
| `N` or `C` | Focus quick-add |
| `/` | Focus search |
| `[` | Toggle sidebar |
| `Ctrl+K` | Command palette |
| `Ctrl+Z` | Undo |
| `?` | Show all shortcuts |

On a focused task row:

| Key | Action |
| :--- | :--- |
| `J` / `K` or arrow keys | Move between tasks |
| `X` or `Space` | Toggle complete |
| `Enter` | Open task drawer |
| `E` | Edit title |
| `A` | Archive (or restore from Archive) |
| `0` to `4` | Set priority |
| `Delete` / `Backspace` | Delete (with Undo) |
| `Alt+↑` / `Alt+↓` | Reorder (manual sort, no grouping) |

### Data import and export

Settings has JSON export, CSV task export, and JSON import. A JSON import adds the records that are not already present (matching ids are skipped), runs all-or-nothing, and takes a backup first.

## Configuration

Most options are in the in-app **Settings** panel and are stored in the database: default quick-add project, backup folder and count, Claude session retention, Azure DevOps organisation, work item types and sync interval, week start day, stale-task threshold, in-progress colour, theme and density.

Environment variables:

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3444` | API server port |
| `HOST` | `127.0.0.1` | Address the server binds to; also added to the allowed host names |
| `DB_PATH` | `data/dashboard.db` | Database file |
| `BACKUP_DIR` | `backups/` next to the database | Backup folder; overrides the setting |
| `BACKUP_KEEP` | `14` | Number of backups kept; overrides the setting |
| `CLAUDE_CONFIG_DIR` | `~/.claude` | Where Claude Code's session registry is read from |

If you change `PORT`, update the proxy target in `vite.config.ts` for `npm run dev`, the port in the Claude hooks below, and `DASHBOARD_PORT` for the resume handler.

The server only answers requests addressed to a loopback host name and rejects cross-site requests. It has no login, so keep it bound to `127.0.0.1`.

## Backups and restore

The server keeps automatic snapshots of the database in `data/backups/` and keeps the newest 14 (see `BACKUP_DIR` and `BACKUP_KEEP` above). A snapshot is taken once a day, before every JSON import, and before a schema upgrade. Home and Settings show the last one and have a **Back up now** button.

To restore a snapshot:

1. Stop the server.
2. Copy the chosen `data/backups/dashboard-<timestamp>.db` over `data/dashboard.db`, and delete `data/dashboard.db-wal` and `data/dashboard.db-shm` if they exist.
3. Start the server.

## Claude session tracking

Home lists Claude Code sessions with their state (Running, Idle, Needs attention, Ended). From a row you can link the session to a task, create a new task from it (titled after the session, linked, and opened in the task drawer), open it, copy its resume command, or clear it. Clicking a session's title opens a side panel with its last prompt, last tool, why it needs attention, client, folder and times, plus the same actions. The task drawer shows a task's linked sessions, and the sidebar shows how many sessions need attention.

Clearing hides a session from Home until it starts again, gets a new prompt, or needs attention. Cleared sessions still show in their task's drawer, and the panel can restore them.

### Set up the hooks

Sessions are reported by Claude Code hooks, which pipe each event's JSON to `POST /api/claude/events`, with the client (`CLAUDE_CODE_ENTRYPOINT`) and process id (`CLAUDE_PID`) as headers. Add this to `~/.claude/settings.json`, merging it with any `hooks` you already have (change the port if you run the server on a different one):

```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "PreToolUse": [{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }],
    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "curl -s -m 2 -o /dev/null -H 'Content-Type: application/json' -H \"X-Claude-Entrypoint: $CLAUDE_CODE_ENTRYPOINT\" -H \"X-Claude-Pid: $CLAUDE_PID\" --data-binary @- http://127.0.0.1:3444/api/claude/events || true" }] }]
  }
}
```

How events map to states:

| Event | State |
| :--- | :--- |
| `SessionStart`, `Stop` | Idle |
| `UserPromptSubmit`, `PostToolUse` | Running |
| `PermissionRequest`, `PreToolUse` for `AskUserQuestion`, `Notification` (except `idle_prompt` and `auth_success`) | Needs attention |
| `SessionEnd` | Ended |

The session title is the first line of its first prompt. Sessions with no linked task are deleted a week after their last event (configurable in Settings); linked sessions are kept as task history and included in JSON export and import. Deleting a task unlinks its sessions.

### Opening sessions

- **Claude desktop sessions** open with `claude://code/continue?session=<desktop id>`. The desktop id (`local_...`) is read from Claude Code's session registry (`~/.claude/sessions/<pid>.json`, an undocumented file), so this needs the `X-Claude-Pid` header in the hooks above.
- **Other sessions** (terminal, IDE, Agent SDK) open with a `claude-resume://<session id>` link, which starts Windows Terminal in the session's folder running `claude --resume <id>`. Register the handler once per user (add `-Unregister` to remove it, and run it again if you move the repository):

  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts\register-claude-resume.ps1
  ```

  The handler looks the folder up from the Dashboard API (`DASHBOARD_PORT`, default 3444) and only opens sessions the Dashboard knows about, because any web page can fire the link.
- The copy button puts `cd "<folder>" && claude --resume <session id>` on the clipboard, which works from any terminal.

## Azure DevOps import

The Dashboard reads work from Azure DevOps through the `az` CLI and stores no tokens of its own. Import is one-way: the Dashboard never changes Azure DevOps items.

### Setup

```powershell
az extension add --name azure-devops
az login
az devops configure --defaults organization=https://dev.azure.com/<your-org>
```

Instead of the `az devops configure` default, you can set the organisation in **Settings > Integrations**.

### How it works

- Work items assigned to you that are not closed are fetched with one organisation-wide query, filtered by work item type (default: Product Backlog Item, Task, Bug, User Story).
- Pull requests are fetched only for Azure DevOps projects mapped in Settings: ones you authored, and ones where you are a reviewer who has not voted yet. Review PRs import as "Review: <title>".
- Map Azure DevOps projects to Dashboard projects in Settings or in the import dialog, so imported items land in the right project. A mapping can override the work item types and ignored states.
- Imported tasks link back to their source item, and re-importing does not create duplicates.
- A background check (every 30 minutes by default; 0 turns it off) shows new items, PRs awaiting review, and linked tasks whose source item has closed or merged. Closed items are listed with a **Complete** button; nothing completes automatically.

If `az` is missing or not logged in, the check skips quietly and Settings shows the last error.

## Development

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | API (tsx watch) and Vite dev server together |
| `npm run build` | Type-check and build the client into `dist/` |
| `npm start` | Run the server, serving `dist/` if it exists |
| `npm test` | Run the Vitest suite |

`npm run dev` uses the real `data/dashboard.db`, and `tsx watch` applies new migrations to it as soon as you save. To try schema changes safely, point the server at a copy:

```powershell
Copy-Item data\dashboard.db data\dev.db
$env:DB_PATH = "data\dev.db"; npm run dev
```

Schema changes go in `src/server/db/migrations.ts` as new entries appended to the list. Never edit an existing migration.

Stack: React 19, Vite, Tailwind CSS v4, TanStack Query, Lucide icons, Fastify, SQLite (`better-sqlite3`) with Drizzle ORM, and Zod schemas shared between client and server.

## Project layout

```
src/
  client/           React app
    components/     UI components (Home, task list, drawer, calendar, settings, ...)
    utils/          Pure helpers and hooks (quick-add parser, view logic, keyboard)
  server/
    index.ts        Fastify app, host checks, daily backup timer, static serving
    routes/         REST API: tasks, projects, dashboard, backups, claude, settings, ado
    db/             Drizzle schema and migrations
    __tests__/      Vitest tests
  shared/           Types, Zod schemas, date and recurrence logic used by both sides
scripts/            claude-resume:// link handler and its registration script
docs/               Plans, roadmap and design references
data/               Database and backups (git-ignored)
```

## Further docs

- [docs/PLAN.md](docs/PLAN.md): architecture, data model and delivery stages.
- [docs/PLAN-STAGE5.md](docs/PLAN-STAGE5.md): design notes for the Stage 5 features.
- [docs/ROADMAP.md](docs/ROADMAP.md): planned and completed features.
