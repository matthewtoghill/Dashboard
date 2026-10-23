# Roadmap

Features planned after Stage 5. Each feature will get its own `PLAN-STAGE<n>.md` with full design, tests and acceptance criteria before work starts. This file records intent, scope and open questions only.

## Status Summary

| # | Feature | Status |
| :- | :--- | :--- |
| 1 | Claude session integration | **Done** (branch `roadmap/claude-sessions`) |
| 2 | Claude skills, hooks and automations for task management | Proposed |
| 3 | Azure DevOps work item import | Proposed |
| 4 | Settings panel | **Done** (branch `roadmap/settings-panel`) |
| 5 | Calendar view | Proposed |

## 1. Claude Session Integration

See Claude sessions from the Dashboard and tie them to tasks.

### Scope

- **Session list:** show active Claude sessions with their state: running, finished, or needs attention (waiting on a permission prompt or a question).
- **Link to task:** attach a session to an existing task, and show linked sessions in the task drawer.
- **Click-through:** open the session in the Claude desktop app (or the matching client) from the Dashboard through a deep link.

### Design Notes

- Session state could come from Claude Code hooks (`SessionStart`, `Stop`, `Notification`, `SessionEnd`) posting to a local Dashboard endpoint, for example `POST /api/claude/events`. This is push-based and avoids parsing transcript files.
- The fallback is reading session transcripts from `~/.claude/projects/` on a timer, which works without hook setup but has to guess at state.
- New table, roughly `claude_sessions` (`session_id`, `cwd`, `title`, `state`, `task_id` nullable, `last_event_at`).
- Include linked sessions in JSON export and import.

### Open Questions

- Which deep link formats does the Claude desktop app support for opening a specific session or thread? Confirm before building click-through.
- Should finished sessions be pruned after some period, or kept as task history?
- Should "needs attention" raise a browser notification, or only a badge?

### Decisions

- State comes from hooks only (no transcript polling). Setup and the event-to-state mapping are in `PLAN.md` under "Claude Session Tracking".
- Click-through copies `cd "<folder>" && claude --resume <session id>`, because no documented deep link opens a specific Code session. Revisit if one is published.
- Unlinked sessions are pruned a week after their last event; linked sessions are kept as task history. Deleting a task unlinks its sessions.
- "Needs attention" shows as a badge on Dashboard Home, with no browser notification.

## 2. Claude Skills, Hooks and Automations

Let Claude add, update and complete Dashboard tasks during a session.

### Scope

- A Claude skill (or MCP server) that wraps the existing REST API: list, create, update, complete and archive tasks, and add subtasks.
- Hooks that act on session events, for example marking a linked task `in_progress` when a session starts, or adding a note when it stops.
- Builds on feature 1 where a session is linked to a task.

### Design Notes

- Start with a skill that calls the API with `curl`. It needs no new server code. Move to an MCP server only if typed tools prove necessary.
- The API binds to localhost only. Keep it that way. Any write endpoint used by automation must stay off the network.
- Automated changes should be distinguishable from manual ones (for example a `source` field or an activity note), so undo and auditing stay clear.

### Open Questions

- Skill or MCP server first?
- Should Claude be allowed to delete tasks, or only archive them?

## 3. Azure DevOps Work Item Import

Read outstanding Azure DevOps work and import it as linked Dashboard tasks.

### Scope

- Fetch work assigned to me: PBIs, Tasks and Pull Requests (authored or awaiting my review).
- Import selected items as new Dashboard tasks that keep a link back to the source item.
- Map Azure DevOps projects to Dashboard projects, so imported items land in the right project.

### Design Notes

- Use the `az` CLI with the `azure-devops` extension (`az boards query`, `az repos pr list`). It reuses the existing `az login`, so the Dashboard stores no tokens.
- The server shells out to `az` and parses its JSON output. Report a clear error if `az` is missing or not logged in.
- New columns on `tasks`, roughly `external_source` (`'ado'`), `external_id` and `external_url`, with a unique index on (`external_source`, `external_id`) so re-importing does not create duplicates.
- New table for the mapping, roughly `ado_project_links` (`ado_org`, `ado_project`, `project_id`).
- Import is manual (a "Fetch from Azure DevOps" dialog with checkboxes) to begin with. Scheduled sync can come later if it proves useful.

### Open Questions

- One-way import only, or should completing a Dashboard task update the Azure DevOps item state?
- What happens to a Dashboard task when its source item is closed or its PR is merged: auto-complete, flag it, or do nothing?
- Single organisation, or several?

## 4. Settings Panel

One place in the UI to configure the Dashboard, instead of environment variables and scattered toggles.

### Scope

- **General:** theme (currently a header toggle stored in `localStorage`), default project for quick-add, and week start day.
- **Overview:** widget visibility (currently `widget_config` in `key_value_store`, edited inline on the Overview).
- **Backups:** retention count and backup folder (currently the `BACKUP_KEEP` and `BACKUP_DIR` environment variables), plus a "Back up now" button and the list of recent backups.
- **Data:** JSON export and import, and archived task cleanup.
- **Integrations:** Claude session settings (feature 1) and Azure DevOps organisation and project mappings (feature 3).

### Design Notes

- Store settings in the existing `key_value_store` under a single `settings` key, validated with a zod schema in `src/shared/`, and expose them through `GET` and `PUT /api/settings`.
- Environment variables stay as overrides, so existing launch scripts keep working. The panel shows when an environment variable is overriding a value.
- Open as a modal or drawer from a gear icon in the header, matching the existing task drawer.
- Include settings in JSON export and import.
- Build this before features 1 and 3, so their configuration has somewhere to go.

### Open Questions

- Should theme move server-side (shared across browsers) or stay per-browser in `localStorage`?
- Should changing the backup folder move existing backups, or only apply to new ones?

### Decisions

- Theme stays per-browser in `localStorage`. The panel offers light, dark, or system (follows the OS).
- Changing the backup folder applies to new backups only. Existing backups stay where they are, and the panel lists the current folder only.
- Widget visibility stays under `widget_config`. The `settings` key holds the default quick-add project, backup count and folder, and the Claude session retention days (previously a fixed week).
- `BACKUP_KEEP` and `BACKUP_DIR` still win over saved settings, and the panel shows when they do. Settings are read on each use, so changes apply without a restart.
- Export includes settings (version 4). Import only applies them to a database with no saved settings, and never carries over the backup folder.
- Widget toggles, JSON/CSV export and JSON import moved from the Overview toolbar into the panel. The Overview keeps the "Last backup" line.
- Week start waits for the calendar view (feature 5); Azure DevOps settings wait for feature 3.

## 5. Calendar View

See tasks laid out by due date. Today and Upcoming are filtered lists only, so there is no way to see how work spreads across a week or month.

### Scope

- **Month and week layouts:** tasks shown on their due date, coloured by project, with overdue tasks highlighted.
- **Reschedule by dragging:** drag a task to another day to change its due date, with undo.
- **Quick-add on a day:** click an empty day to create a task due that day.
- **Recurring tasks:** show future occurrences of recurring tasks as ghost entries, so the schedule ahead is visible.
- **Filters:** respects the current project, priority and tag filters, and can be saved as a saved view.
- Clicking a task opens the existing task drawer.

### Design Notes

- Build it as a CSS grid with no calendar library. A month view is a seven-column grid, and the date helpers in `src/shared/dates.ts` already cover the date maths.
- Add it as a new smart nav entry ("Calendar") in the sidebar and command palette, next to Today and Upcoming.
- Project future occurrences with the existing rules in `src/shared/recurrence.ts`. These are computed for display only and never stored.
- Reuse the drag handling from `ReorderableTaskList.tsx` where it fits, including keyboard support for moving a task to another day.
- Week start day comes from the settings panel (feature 4).

### Open Questions

- Should tasks without a due date appear in a side tray that you can drag onto the calendar?
- Should completed tasks show on the calendar (struck through), or be hidden?
- Is a day or agenda layout needed as well, or are month and week enough?
