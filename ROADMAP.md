# Roadmap

Features planned after Stage 5. Each feature will get its own `PLAN-STAGE<n>.md` with full design, tests and acceptance criteria before work starts. This file records intent, scope and open questions only.

## Status Summary

| # | Feature | Status |
| :- | :--- | :--- |
| 1 | Claude session integration | **Done** (branch `roadmap/claude-sessions`) |
| 2 | Claude skills, hooks and automations for task management | Proposed |
| 3 | Azure DevOps work item import | **Done** (branch `roadmap/ado-import`) |
| 4 | Settings panel | **Done** (branch `roadmap/settings-panel`) |
| 5 | Calendar view | **Done** (branch `roadmap/calendar`) |
| 6 | Task activity log | **Done** (branch `roadmap/activity-log`) |
| 7 | Automatic Azure DevOps sync check | **Done** (branch `roadmap/ado-sync`) |
| 8 | Weekly review view | Proposed |
| 9 | Custom right-click menu | **Done** (branch `roadmap/context-menu`) |

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

### Decisions

- One-way import only. The Dashboard never changes Azure DevOps items.
- Single organisation, from Settings > Integrations, falling back to the `az devops configure` default.
- Work items come from one org-wide WIQL query (assigned to me, not Done/Closed/Removed), filtered by type. Default types live in settings (`adoWorkItemTypes`); a mapped project can override them.
- `az repos pr list` needs a project, so pull requests are fetched only for projects listed in `ado_project_links`: ones I authored, and ones where I am a reviewer who has not voted yet. Review PRs import as "Review: <title>".
- `ado_project_links` (`ado_project`, `project_id` nullable, `work_item_types` nullable JSON) holds the mapping. Tasks gain `external_source`, `external_id` (`workitem/<id>` or `pr/<id>`) and `external_url`, with a unique index on source and id.
- The destination project can be set in Settings or per group in the import dialog. Both write the same mapping, so a change in the dialog sticks for later imports.
- Work item types are picked as chips from the types Azure DevOps reports (`az devops invoke`, `wit/workitemtypes`). A type the project doesn't have is refused, or shown amber if it was saved earlier. Types are cached in `key_value_store` (`ado_work_item_types`, per organization setting and project) and only fetched for uncached projects or on "Refresh types".
- When a source item closes or its PR is merged or abandoned, the next fetch lists the unfinished task under "Closed in Azure DevOps" with a Complete button. Nothing completes automatically.
- Export is version 5 and includes the project mappings.

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

### Decisions

- Calendar is a layout, not a separate view. `ViewState` gains `layout` (`list`, `month` or `week`), so any project, tag or smart view can show as a calendar, and saved views remember the layout. Views saved before this read as `list`.
- The sidebar and command palette "Calendar" entry opens All Active in month layout. Other smart views open as a list; projects and tags keep the current layout.
- Group and sort are hidden in calendar layouts. Within a day, unfinished tasks come first, then ghosts, then done tasks, each by priority. Archive has no calendar.
- No tray for undated tasks. Undated tasks don't appear on the calendar.
- Completed tasks show struck through, behind the same "Show completed" toggle as the list.
- Month and week layouts only, with no day or agenda layout.
- Ghost entries are shown only for unfinished tasks that repeat from their due date. Tasks that repeat from completion have no fixed future dates, so they get none. Ghosts open the task but can't be dragged.
- Drag a task to another day, or press Alt+Arrows on it (one day left or right, one week up or down). Either move shows a toast with undo.
- Clicking an empty part of a day, or its + button, opens an inline quick-add. Typed tokens work as usual, and the due date defaults to that day.
- Week start is a General setting (`weekStartDay`), Monday by default.

## 6. Task Activity Log

Keep a history of what changed on each task and when. Today only `updatedAt` survives an edit, so there is no record of status changes, due dates being pushed back, or changes made by imports and automations.

### Scope

- **Recorded events:** create, status change (including complete, archive and restore), due date, priority, project and title changes, subtask added or completed, and Claude session linked or unlinked.
- **Source:** each event records who made it: `manual`, `ado` (import) or `claude` (feature 2), so automated changes are easy to tell apart.
- **Drawer section:** a collapsible "History" section at the bottom of the task drawer, newest first, showing compact rows such as "Due 12 Oct → 19 Oct · 3 days ago".

### Design Notes

- New table, roughly `task_events` (`id`, `task_id`, `at`, `kind`, `from`, `to`, `source`), with `on delete cascade` on `task_id`.
- Write events in the task and subtask routes in `src/server/routes/tasks.ts`, inside the same transaction as the change. Compare old and new values there rather than logging every field on every PATCH.
- Moves that are not edits (manual reorder, rebalancing `sortOrder`) are not logged, the same rule as `updatedAt`.
- Undo of a delete or complete records the reversal as a new event rather than removing the earlier one.
- The data can feed later trends, for example how often a task is rescheduled or how long it sat `in_progress`.

### Open Questions

- Include events in JSON export and import, or treat them as local history only?
- Should events be pruned (for example a year after the task is archived), or kept forever?
- Should description edits be logged? Notes change often, so logging them could drown out everything else.

### Decisions

- Events are included in JSON export (version 6) and import. Events for a task in neither the backup nor the database are skipped.
- Events are kept forever; deleting a task removes them through the cascade.
- Description, tag and recurrence edits are not logged. Subtask renames and deletes are not logged either; reopening a subtask is.
- Linking a session to a different task logs an unlink on the old task and a link on the new one. The label is the session title, or its id when untitled.
- All task and subtask routes record source `manual`; ADO import records `ado`. `claude` is reserved for feature 2.
- The History section loads when first expanded, and reloads when the task's `updatedAt` or linked sessions change.

## 7. Automatic Azure DevOps Sync Check

Check Azure DevOps in the background so new work and closed items show up without opening the import dialog.

### Scope

- **Scheduled fetch:** the server runs the existing work item and pull request fetch on a timer.
- **Overview badge:** shows counts of new assigned items not yet imported, pull requests awaiting my review, and linked tasks whose source item has closed or been merged.
- **Click-through:** the badge opens the existing import dialog with the cached results, so nothing is fetched twice.
- **Setting:** an interval in Settings > Integrations, with an option to turn the check off.

### Design Notes

- Reuse the fetch logic behind `GET /api/ado/items` in `src/server/routes/ado.ts`. Store the last result and its timestamp in `key_value_store`, and serve it to the Overview from there.
- Still one-way and still manual. The check only reports; importing and completing stay as they are now (see feature 3 decisions).
- Skip the check quietly when `az` is missing or not logged in, and show the last error in Settings instead of repeating it on every run.
- Run the first check shortly after startup, then on the interval. Do not overlap runs if `az` is slow.

### Open Questions

- Default interval: 15, 30 or 60 minutes?
- Should "new" mean not imported, or not seen since the last time the dialog was opened? The latter needs a stored list of dismissed ids.
- Should the import dialog refetch on open as it does now, or show the cached result with a "Refresh" button?

### Decisions

- Checks every 30 minutes by default (Off, 15, 30, 60 or 120 in Settings > Integrations). The server looks once a minute whether a check is due, starting 10 seconds after startup, so a check that fell due while it was down runs soon. One check runs at a time.
- The last result is stored under `ado_sync` in `key_value_store`. `GET /api/ado/items` serves it, with task links and the closed list re-read from the database so imports and completions show at once; `?refresh=1` checks now. A failed check keeps the previous result and stores the error, shown in Settings, the Overview card and the dialog. A failing `az` is retried at the interval, not every minute.
- "New" means not imported. No dismissed list.
- The import dialog opens on the stored result, with its age and a Refresh button.
- The Overview's Azure DevOps card shows New items, Reviews and Closed counts from the last check; each opens the dialog.
- **Ignored states** (for example Ready for QA, In UAT): a default list in Settings, and a per-mapping override (`ado_project_links.ignored_states`, migration 7). Work items in an ignored state are left out, and an imported task whose item reaches one is listed under "Closed in Azure DevOps", like Done. State pickers use the states Azure DevOps reports for the types, cached with them.
- **Linked projects only** setting: work items and pull requests are fetched only for ADO projects mapped to a Dashboard project. With none mapped, nothing is fetched and a warning says why.
- **Project panel:** a project view with a mapped ADO project, or any project once Azure DevOps is in use, shows a collapsible "Azure DevOps" section above the task list: that project's items with filter, type and state filters, grouping (type, state, project), sorting, "Show imported", import, refresh, and the closed list. Its gear links and unlinks ADO projects and edits their types and ignored states; saving a change checks again. Open or collapsed is remembered per browser.
- Export stays version 6; mappings gain `ignoredStates`, which older backups read as null.

## 8. Weekly Review View

A guided pass over tasks that have gone stale, so the list stays trustworthy.

### Scope

- **Review set:** overdue tasks, `in_progress` tasks not updated in N days, `todo` tasks not updated in N days, and undated `todo` tasks.
- **One at a time:** shows one task with its details and a progress count ("4 of 17"), with keys for the common actions: reschedule, mark in progress, complete, archive, open in the drawer, and keep (skip with no change).
- **Entry points:** a smart nav entry ("Review") in the sidebar and command palette, with a count badge.

### Design Notes

- The review set is a pure filter in `src/client/utils/taskView.ts`, tested alongside the existing view helpers. The data needed (`status`, `dueDate`, `updatedAt`) already exists.
- Subtask edits already bump the task's `updatedAt`, so a task with recent subtask progress does not count as stale.
- "Keep" must stop a task reappearing straight away. Either bump `updatedAt` on keep, or record a `reviewedAt` per task.
- Reschedule reuses the natural-language date parser from quick-add.
- The staleness threshold (N days) is a General setting, 14 days by default.

### Open Questions

- Bump `updatedAt` on "keep", or add a separate `reviewedAt` column so keeping a task isn't counted as an edit?
- Should the view remember progress if closed partway through, or start again each time?
- Is a reminder useful, for example a badge on the Overview when no review has been done in a week?

## 9. Custom Right-Click Menu

Replace the browser's context menu with Dashboard actions on tasks and projects. Today task actions are spread across hover buttons and inline controls on `TaskRow`, and there is no right-click handling anywhere in the client.

### Scope

- **Task rows and calendar entries:** open, edit title, set status (todo, in progress, done), priority, due date (today, tomorrow, next week, pick a date), move to project, add tag, copy title or link, open the Azure DevOps item, archive or restore, and delete.
- **Sidebar projects:** rename, change colour, and delete.
- **Keyboard:** the Menu key and Shift+F10 open the menu for the focused row. Arrow keys, Enter and Escape work inside it, and submenus (project, priority, due date) open with Right Arrow.
- Every action shows the same toast and undo as its existing button.

### Design Notes

- One `ContextMenu` component, positioned at the pointer and kept inside the viewport, with `role="menu"` and `menuitem` roles. No menu library.
- Menu items call the handlers `TaskRow` and `Sidebar` already receive, so no new server endpoints are needed.
- Holding Shift while right-clicking falls through to the browser menu, so copying text and the browser's spellcheck still work. Text inputs always get the browser menu.
- Right-clicking a ghost (recurring) entry on the calendar offers only "Open task".
- If multi-select is added later, the menu acts on the whole selection.

### Decisions

- Hover buttons and inline controls on `TaskRow` stay, so actions remain discoverable.
- "Copy link" was dropped: tasks have no URLs. "Copy title" and "Open in Azure DevOps" remain.
- "Pick a date", "Add tag" and project "Rename" are inline inputs inside a submenu.
- Overview task widget rows get the task menu too. Claude session rows are out of scope.
- On calendar and widget entries, "Edit title" opens the task drawer, since they have no inline editor.
