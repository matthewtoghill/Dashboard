# Stage 6: Task Status Notes (roadmap feature 12)

A short, dated progress log on each task ("Receipts collected, form half done"). The description holds what the task is; status notes record where it stands. Intent and scope are in `ROADMAP.md` feature 12; this file is the build plan.

## Status

| Item | Status |
| :--- | :--- |
| Plan | Decided (see Decisions) |
| Build | **Built** on `roadmap/status-notes`; tests, `tsc` and build pass; browser check still to do |

## Current State

- `task_events` (feature 6, migration 6) already stores `kind`, `from_value`, `to_value`, `source`, and is cascaded on task delete, included in export (version 8) and imported with `onConflictDoNothing`.
- `TASK_EVENT_KINDS` in `src/shared/types.ts` is a closed zod enum, also used as the Drizzle column enum in `src/server/db/schema.ts`. A new kind is a type change only; no migration is needed because the column is plain `TEXT`.
- `describeTaskEvent` (`src/client/utils/taskUtils.ts`) switches on every kind with no default, so adding a kind without a case fails `tsc`. That is the safety net.
- The History section is `TaskHistory` in `TaskDetailDrawer.tsx`. It loads on first expand and re-keys on `task.updatedAt`.
- `staleTasks` filters on `updatedAt`, so any write that bumps `updatedAt` already counts as a touch. The weekly review (feature 8) does not exist yet and will use the same rule.
- `listTasks` returns every task with subtasks and ADO links embedded, and the client holds them all in one query. `GET /api/tasks/:id/events` serves one task's log.
- Task row actions live in `src/client/utils/contextMenuItems.ts` and `TaskRow.tsx`.

## Scope

Taken from the roadmap, with the decisions proposed below.

1. **Add a note:** one-line input in the drawer, and a "Status note" action in the row menu and the right-click menu.
2. **Row display:** the latest note shows under the task title, muted, with its relative date.
3. **Drawer:** notes appear in History with the other events, newest first. Notes are only added, never edited or deleted (see Open Questions).
4. **Staleness:** adding a note bumps `updatedAt`.

## Design

### Data

No migration.

- Add `'status_note'` to `TASK_EVENT_KINDS`. The text is stored in `to_value`; `from_value` is null.
- Source is `manual` for notes typed in the UI. `claude` is reserved for feature 2.
- Validate with a new `CreateTaskNoteInputSchema` in `src/shared/types.ts`: `{ text: z.string().trim().min(1).max(280) }`. One line means no newline characters; collapse them on the server rather than reject (pasted text), then check the length.

### Server (`src/server/routes/tasks.ts`, `src/server/taskEvents.ts`)

- `POST /api/tasks/:id/notes` with `{ text }`. In one transaction: `recordTaskEvents(db, id, [{ kind: 'note', to: text }])` and `update tasks set updatedAt = now`. Returns `{ task, event }`. 404 for an unknown task; 400 for an empty or over-long note.
- Archived tasks accept notes too (a note can explain why it was archived). The task is not otherwise changed.
- `latestNotes(db): Map<taskId, { text, at }>` in `taskEvents.ts`: one grouped query over `kind = 'status_note'` (`max(at)` per task, joined back for the text; `rowid` breaks ties for two notes in the same millisecond). `listTasks` and `getTaskWithSubtasks` call it and `serializeTask` takes the result.
- `Task` gains `latestNote: { text: string, at: number } | null`, `.optional().default(null)` as with the other late fields, so old exports and fixtures still parse.
- No index change: `idx_task_events_task (task_id, at)` covers the lookup. Revisit only if `listTasks` becomes measurably slower on a large database.
- Export and import need no change: notes are events, and events are already exported (version 8 stays). `latestNote` is derived and is not exported or imported.

### Client

- `api.ts`: `addTaskNote(taskId, text)`; on success, invalidate the tasks query and `['taskEvents', taskId]`.
- `describeTaskEvent`: a `note` case returning "Note: <text>". The drawer shows the full text with no truncation.
- `TaskDetailDrawer.tsx`: a "Status note" input above the History section, Enter to add, `Escape` to clear. Add it as a small component next to `TaskHistory` rather than growing the drawer body.
- `TaskRow.tsx`: a muted second line under the title: `<note text> · 2d ago`, truncated to one line, full text in `title`. Hidden for done and archived tasks (their latest note stays in History). Row height must not jump for tasks without a note.
- `contextMenuItems.ts`: "Status note…" opens the drawer focused on the note input. Rows have no inline editor, the same reason "Edit title" opens the drawer on calendar entries (feature 9 decisions). No new inline input in the menu.
- Calendar entries and Overview widget rows: no note line. Too dense; they open the drawer.

### Staleness

`updatedAt` is bumped by the POST route, so `staleTasks` and the future weekly review treat a note as a touch with no other change. Nothing else to build here, but a test pins it.

## Files

- `src/shared/types.ts`: kind, `CreateTaskNoteInputSchema`, `Task.latestNote`.
- `src/server/taskEvents.ts`: `latestNotes`.
- `src/server/routes/tasks.ts`: route, `serializeTask`, `listTasks`, `getTaskWithSubtasks`.
- `src/client/api.ts`, `src/client/utils/taskUtils.ts`, `src/client/utils/contextMenuItems.ts`.
- `src/client/components/TaskDetailDrawer.tsx`, `TaskRow.tsx`.
- `docs/ROADMAP.md`, `README.md`, this file.

## Tests

Server, through `app.inject` in `src/server/__tests__/` (extend `taskEvents.test.ts` and `tasks.test.ts`):

- POST adds a `note` event with the text in `to`, source `manual`, and bumps `updatedAt`.
- Empty, whitespace-only and over-280-character notes are rejected; embedded newlines are collapsed to spaces.
- Unknown task returns 404; an archived task accepts a note and stays archived.
- `latestNote` on `GET /api/tasks` is the newest of several notes and null with none; two notes in the same millisecond return the later one.
- A task with a note leaves `staleTasks` (give it an old `updatedAt`, add a note, assert it drops out).
- Notes appear in `GET /api/tasks/:id/events`, newest first, and survive export → import into an empty database. Deleting the task removes them.
- Client helper: `describeTaskEvent` for `note`.

## Acceptance Criteria

- [ ] Add a note from the drawer, the row menu and the right-click menu; the row shows it at once and History lists it.
- [ ] A second note replaces the first on the row and both show in History, newest first.
- [ ] A stale task with a new note disappears from the stale list.
- [ ] Notes survive JSON export and import, and old backups (with no notes) still import.
- [ ] Rows without a note are unchanged in height, in light and dark mode; long notes truncate to one line.
- [ ] Definition of Done from `PLAN-STAGE5.md`: `npx tsc --noEmit -p .`, `npm test`, `npm run build`, browser check on a `DB_PATH` copy, `ROADMAP.md` status table updated.

## Decisions

- **Row display is a setting**, `statusNoteStyle` (Settings > General): `line` (default) shows the latest note as a second line under the title; `icon` shows a speech-bubble badge with the note and its age on hover or focus. The line is hidden on done and archived tasks; the icon is not. Clicking either opens the drawer.
- **Drawer:** a separate "Status" section with the note input and a timeline of notes, newest first, above History. History excludes notes.
- **Event kind is `status_note`**, not `note`, to avoid confusion with the markdown description notes.
- `Task.latestNote` is optional on the type so existing fixtures still compile.
- Open questions below kept their defaults: append-only, not copied to the description, 280 characters, allowed on done and archived tasks.
- Right-click "Status note…" opens the drawer with the input focused.

## Open Questions

Defaults are proposed so work can start; change any before it does.

1. **Edit or delete a note shortly after adding it?** Roadmap leaves this open. Default: no. Notes are an append-only log, and the whole feature is cheaper without it. A typo is corrected by adding another note. Allowing a short undo toast right after adding (reusing `Feedback.tsx`) is the cheap middle ground if typos prove annoying.
2. **Copy notes into the description too?** Default: no. Two places to keep in step, and the export already includes events as JSON.
3. **Maximum length:** default 280 characters. It is a one-line status, not a second description.
4. **Note on a done task:** default allowed from the drawer, with no row line. Say if notes should be blocked once a task is done.

## Out of Scope

- Editing, deleting or pinning notes.
- Markdown in notes. Plain text only.
- A global notes feed or search across notes.
- Notes made by Claude (feature 2): source `claude` is already reserved, so it adds a caller later and no schema.
