# Selective Restore Plan

Restore chosen items from a local backup inside the app, instead of the current manual, all-or-nothing file copy. Work goes on `roadmap/selective-restore`, one commit per phase.

## Status

| Phase | Status |
| :--- | :--- |
| 1. Extract export and import into functions | **Done**, committed `f1eb2e8` |
| 2. Open a backup and diff it against the live database | **Done**, committed `c457184` |
| 3. Restore missing items | **Done**, committed `e20bf51` |
| 4. Overwrite changed items | **Done**, committed `1b32721` |
| 5. Restore UI | **Done**, committed `ad71410` |
| 6. Docs and final checks | **Done** |

## Decisions

- **Granularity:** per item. Each section lists its items, and you tick the ones to restore.
- **Conflicts:** restore brings back items that are missing from the live database. Overwriting an item that exists in both but differs needs its own tick, per item.
- **Restore never deletes.** Items created after the backup aren't shown or touched.
- **Safety backup first,** reusing the import's `beforeImport` hook. If the snapshot fails, the restore is cancelled.
- **One transaction.** A restore applies in full or not at all.
- **Settings are restored per field,** not as a whole. `backupDir` is machine-specific and never restored, the same as import.
- **Only local backups** from `listBackups(dir)`. Restoring from a JSON export file can use the same picker later, since both become a `BackupPayload`.

## Background

- Backups are full SQLite snapshots written with `VACUUM INTO` (`src/server/backup.ts`). They're taken before migrations, before every import, daily, and on demand.
- `GET /api/export` builds a `BackupPayload` from the live database. `POST /api/import` inserts a payload in one transaction and skips rows whose id already exists (`src/server/routes/dashboard.ts`). Before phase 1, both lived inline in the route handlers, and the scratchpad and saved views helpers were closures over `db`.
- Older backups use an older schema version (`user_version`). They need `runMigrations` before they can be read with the current Drizzle schema.
- Foreign keys: subtasks, task ADO links, task source links and task events cascade when their task is deleted. A task's `project_id` and a Claude session's `task_id` are set to null when the parent is deleted.

## Phase 1: Extract export and import into functions [Done]

**Status:** Done, committed `f1eb2e8`. `tsc -b` is clean and 196/196 tests pass.

Refactor only, with no behaviour change. This lets the restore code run export against a second database and reuse the insert logic.

- [x] Move `getScratchpad`, `setKeyValue` and `getSavedViews` to module-level functions that take `db`.
- [x] `exportPayload(db): BackupPayload`, with `GET /api/export` calling it.
- [x] `importPayload(db, payload): ImportResult`, holding the body of the import transaction, with `POST /api/import` calling it as `db.transaction(() => importPayload(db, payload))`.
- [x] Move `ImportResult` from `src/client/api.ts` to `src/shared/types.ts`, so the server can use it. `api.ts` re-exports it.
- [x] Verify: `npx tsc -b && npm test` (the import and export tests cover this).
- [x] Commit: `refactor: extract export and import into functions`

Notes:

- `importPayload` takes `db`, not the transaction handle. With better-sqlite3 everything runs on one connection, so statements made through `db` inside `db.transaction()` are part of that transaction. The old handler already mixed `tx` and `db` this way for settings, the scratchpad and saved views. Taking `db` also means phase 3 can call `importPayload` and write settings in the same transaction.
- `exportPayload` and `importPayload` stay in `src/server/routes/dashboard.ts`, next to the routes that use them, the same way `listTasks` lives in `routes/tasks.ts`.

## Phase 2: Open a backup and diff it against the live database [Done]

**Status:** Done, committed `c457184`. `tsc -b` is clean and 202/202 tests pass (6 new). A read-only diff against the real 2026-11-04 15:26 backup on the dev server lists 7 changed tasks and nothing else, and leaves no temp copies behind.

New module `src/server/restore.ts`.

**Open a backup:** `withBackupSnapshot(dir, file, fn)`

- [x] Reject any `file` that isn't in `listBackups(dir)`. This blocks path traversal, because the name comes from the client. It returns `null`, and the route turns that into a 404.
- [x] Copy the file to `os.tmpdir()`, then open the copy with `new Database()` and `runMigrations`. Don't use `createDatabase`, which takes a pre-migration backup into the live backup folder.
- [x] Pass `fn` a `BackupSnapshot`: `exportPayload` of the copy, plus the settings actually stored in it. Close and delete the copy in `finally`.
- [x] The original backup file is never opened for writing.

**Diff:** `diffPayloads(snapshot, live): RestoreDiff`

- [x] Match each section by its key: `id` for most, `sessionId` for Claude sessions, `path` for Claude folder links, `adoProject` for ADO project links, and `externalId` for ADO dismissed. Settings match per field, and the scratchpad is a single item.
- [x] Each item gets a state: `missing` (in the backup only) or `changed` (in both, but different). Unchanged items are left out, and so are items added since the backup.
- [x] For `changed` items, list the differing top-level fields with their backup and live values. A task's subtasks, ADO links and source links count as fields of the task.
- [x] Each item carries a label for the UI (task title, project name, and so on).
- [x] Sections (`RESTORE_SECTIONS` in `src/shared/types.ts`): projects, tasks, notes, quick links, saved views, Claude sessions, Claude folder links, ADO project links, ADO dismissed. Settings and the scratchpad are separate fields of `RestoreDiff`. Task events aren't a section, because they come with their task (see phase 3).

Comparison rules, chosen to keep background churn out of the diff:

- **Task ADO links:** only `externalId` and `url` are compared. Every ADO check rewrites a link's `title`, `type` and `state` (`routes/ado.ts`), so comparing those would flag nearly every linked task.
- **`updatedAt` alone doesn't make an item changed.** ADO checks bump it without other edits. When another field differs too, `updatedAt` is still listed alongside it.
- **Task `latestNote`** is derived from the activity log, so it isn't compared.
- **Claude sessions:** only sessions linked to a task that are missing from the live database are offered, and never as changed. Sessions change with every hook event, and unlinked ones are pruned after `claudeSessionTtlDays`.
- **ADO dismissed:** missing only, because only the dismissal time could differ.
- **Settings:** only fields stored in the backup are compared (`readStoredSettings` in `settings.ts`). A field added after the backup was written would otherwise show its default as the backup value. `backupDir` is never included.
- **Scratchpad:** offered only when the backup has text that differs from the live text, because restore never deletes.

**Route:** `GET /api/backups/:file/diff` returns `RestoreDiff`.

- [x] Returns 404 for an unknown file, 400 when backups are disabled, and 400 with details when the backup can't be read (a corrupt file, or a schema newer than the app).
- [x] `registerBackupRoutes` now takes the Drizzle `db` instead of the raw SQLite handle, so the route can export the live database.

Tests (`src/server/__tests__/restore.test.ts`):

- [x] Back up, then delete a task, edit a note and change two settings. The diff shows the task as missing, the note as changed with its field list, and both settings with their values. A task added after the backup isn't listed.
- [x] ADO link snapshot changes and `updatedAt`-only changes aren't listed. A real edit is listed, with `updatedAt` alongside it.
- [x] Only missing, linked Claude sessions are listed.
- [x] A backup written at schema version 14 diffs. Only the settings it stored are compared. The backup file stays at version 14.
- [x] Unknown file names, `../`, and encoded `..%2F` names return 404.
- [x] The route returns 400 for an in-memory database.
- [x] A mutation check (removing the `updatedAt`, ADO link and file-name rules) fails the matching tests.
- [x] Commit: `feat: diff a backup against the live database`

## Phase 3: Restore missing items [Done]

**Status:** Done, committed `e20bf51`. `tsc -b` is clean and 208/208 tests pass (6 new). Not yet tried against real data; phase 6 does that on a `DB_PATH` copy.

**Route:** `POST /api/backups/:file/restore`

```ts
// Request body (RestoreRequestSchema in src/shared/types.ts, strict); phase 4 adds `overwrite`
{ add?: { [section in RestoreSection]?: string[] }, settings?: string[], scratchpad?: boolean }
// Response (RestoreResult); phase 4 adds `overwritten`
{ restored: Record<RestoreSection, number>, settings: number, scratchpad: boolean, warnings: string[] }
```

In `src/server/restore.ts`, inside `withBackupSnapshot`:

- [x] `planRestore(snapshot, live, selection)` recomputes the diff and changes nothing. It returns a 400 `RestoreError` for any id that isn't listed as missing, any setting that isn't listed as different, or a scratchpad the diff doesn't offer. Stale or hand-written requests fail before anything is written, and no safety backup is taken for them.
- [x] It filters the backup payload down to the selected items. Import's insert-if-missing behaviour is what "add" means here.
- [x] A restored task brings its own subtasks, links and events. Only events for restored tasks are included.
- [x] Settings and the scratchpad are removed from the payload, so import's "keep existing" rules don't apply to them.
- [x] Then the safety backup (`backupDatabase(..., { prune: false })`). If it fails, the request gets a 500 and nothing changes.
- [x] `applyRestore(db, plan)` runs `importPayload`, the settings write (`{ ...live, ...picked }`, never `backupDir`) and the scratchpad write in one transaction.

Dependencies, each reported in `warnings`:

- [x] **A task whose project isn't in the database after the restore** comes back with `projectId` null. Ticking the project too keeps the link.
- [x] **An ADO project link whose project isn't there** comes back with `projectId` null.
- [x] **A Claude folder link whose project isn't there** is skipped, because its project is required.
- [x] **A Claude session whose task isn't there** (neither live nor ticked) is skipped. Restored unlinked, it would be pruned on the next sessions request.
- [x] **Saved views beyond `MAX_SAVED_VIEWS`** are skipped.

**Pruning:** `backupDatabase` takes `{ prune: false }` for the safety backup. It runs after the backup has been copied, so restoring from the oldest backup doesn't delete it straight away. The next daily or manual backup prunes as usual.

Tests (`src/server/__tests__/restore.test.ts`):

- [x] Restore one of two deleted tasks. Only that one comes back, with its subtasks and its full event history, and one safety backup is added.
- [x] With `backupKeep: 1`, the backup being restored from still exists afterwards.
- [x] Restore two settings fields and the scratchpad. The other settings keep their live values (the Zod 4 `.partial()` bug).
- [x] A task restored without its project gets `projectId` null and a warning. Ticked together, the link is kept.
- [x] A session is skipped with a warning without its task, and restored linked when its task is ticked too.
- [x] Not-missing ids, unknown ids, unchanged settings, `backupDir`, a scratchpad the diff doesn't offer, an unknown section, and unknown body fields all return 400 without a safety backup. An unknown file returns 404, and an in-memory database returns 400.
- [x] A mutation check (pruning the safety backup, dropping events, not filtering sessions, skipping the id check) fails the matching tests.
- [x] Commit: `feat: restore selected missing items from a backup`

Not covered by a test: a failure inside the transaction rolling everything back. Nothing a valid plan does can fail on purpose, and the rollback is better-sqlite3's own.

## Phase 4: Overwrite changed items [Done]

**Status:** Done, committed `1b32721`. `tsc -b` is clean and 210/210 tests pass (2 new, plus more cases in the rejection test). Not yet tried against real data; phase 6 does that on a `DB_PATH` copy.

```ts
// Request body gains
{ overwrite?: { [section in RestoreSection]?: string[] } }
// Response gains
{ overwritten: Record<RestoreSection, number> }
```

- [x] `planRestore` checks overwrite ids the same way as add ids, but against `changed` items in the diff. An item can't be both missing and changed, so an id in both `add` and `overwrite` always fails one of the checks with a 400. Sections that are missing-only (Claude sessions, ADO dismissed) have no changed items, so overwriting them is always a 400.
- [x] The same dependency rules apply to overwritten items: a task or ADO project link whose project isn't there gets `projectId` null, and a Claude folder link whose project isn't there is skipped, each with a warning.
- [x] **Rows are updated in place, never deleted and re-inserted.** Deleting a task cascades to its events, ADO links and source links, and sets Claude session links to null, so that history would be lost. A test checks that the task's events and its linked Claude session survive an overwrite.
- [x] Tasks: the task row is updated to the backup's values, **including `updatedAt`**, so the task looks as it did then.
- [x] **Subtasks become exactly the backup's.** Ones added since the backup are removed, and renamed ones go back. Subtasks have no history of their own.
- [x] **ADO and source links merge:** the backup's links are added back, and links added since stay, so ADO import tracking isn't lost. A link that has since moved to another task stays there. One consequence: a task with newer links still shows as changed after an overwrite.
- [x] Projects, notes (including `updatedAt`), quick links, Claude folder links (project) and ADO project links (project, work item types, ignored states) are updated in place.
- [x] Saved views: the view with the same id is replaced in its current position. Views added since stay.
- [x] Overwrites run in the same transaction as the adds, settings and scratchpad, after `importPayload`, so an overwritten task can point at a project restored in the same request.
- [x] `taskValues` and `insertTaskChildren` were split out of `importPayload` (in `routes/dashboard.ts`), so import and overwrite share the task column mapping and the subtask and link inserts. `getSavedViews` and a new `setSavedViews` are exported for the saved views overwrite.

Tests (`src/server/__tests__/restore.test.ts`):

- [x] Overwrite an edited task. Its title, priority, status and `updatedAt` match the backup. Its subtasks are the backup's (renamed back, newer one gone). Its ADO links are the backup's plus the newer one. Its events and linked Claude session survive.
- [x] Overwrite a changed project, note, quick link, saved view and ADO project link. Afterwards the diff lists none of them as changed, and a saved view added since stays.
- [x] Overwriting an unchanged id, an unknown id, or a missing-only section returns 400.
- [x] A mutation check (keeping newer subtasks, skipping the saved views write, skipping the overwrite id check) fails the matching tests.
- [x] Commit: `feat: overwrite selected items from a backup`

## Phase 5: Restore UI [Done]

**Status:** Done, committed `ad71410`. `tsc -b` is clean, 213/213 tests pass (3 new, plus a dry-run case), and `vite build` succeeds. Not tried in a browser; phase 6 checked the same flow through the API on real data, and the browser check was skipped by choice.

- [x] Settings panel, Backups section: each row of the backup list has a "Restore…" button, which opens `RestoreDialog` (`src/client/components/RestoreDialog.tsx`).
- [x] The dialog is a native `<dialog>` opened with `showModal()`, like `ConfirmDialog`, so focus is trapped and Escape closes it. It stops Escape from bubbling, so the settings panel underneath stays open.
- [x] It loads `GET /api/backups/:file/diff` and shows one collapsible group (`<details>`) per section with differences. A group is open by default when it has 10 items or fewer. The header shows counts such as "3 missing, 2 changed", and each state has its own select-all checkbox.
- [x] Each item shows a label, a badge with text (Missing or Changed, so not colour-only) and a labelled checkbox. A changed item has an expand button (`aria-expanded`) that shows one row per differing field, with backup and current values. Long values are truncated, with the full value on hover. Timestamps show as dates, and lists of records show their titles.
- [x] Settings get their own group with backup and current values inline. The scratchpad is a single checkbox with a preview of the backup's text.
- [x] Under changed tasks, a note explains that subtasks reset and newer links are kept.
- [x] Nothing is selected by default. The footer shows the selection count.
- [x] **Dependency warnings come from a server dry run** (decided in this phase). "Review restore" sends the request with `dryRun: true`. The server runs the same `planRestore`, returns the counts and warnings, and takes no safety backup and makes no change. The confirm step shows them and says a safety backup is taken first. Its Back button has focus, so Enter doesn't restore by accident.
- [x] When a restore finishes, every query is invalidated (data, settings and the backup list) and the dialog shows the counts and any warnings.
- [x] If nothing differs, the dialog says "This backup matches your current data."
- [x] Server errors (an unreadable backup, a stale selection) are shown in a `role="alert"` line.

Supporting changes:

- [x] `RestoreRequestSchema` gains `dryRun`. A route test checks that a dry run returns the same warnings as the real restore, and leaves the data and the backup list unchanged.
- [x] Warning messages are worded so they read the same before and after a restore, e.g. `Task "X": restored without its project "Y", which isn't in the database.`
- [x] `src/client/api.ts`: `fetchRestoreDiff` and `restoreFromBackup`.
- [x] `src/client/utils/restore.ts`: section labels, field labels, value formatting, building the request from the ticked items, and the result summary. Tested in `src/server/__tests__/restoreDialog.test.ts`, next to the other client util tests.
- [x] Commit: `feat: add selective restore dialog`

## Phase 6: Docs and final checks [Done]

**Status:** Done, not yet committed. `tsc -b` is clean, 213/213 tests pass, and `vite build` succeeds.

- [x] README, "Backups and restore": describes the in-app restore (missing and changed items, per-field settings, the scratchpad, Review restore, the safety backup, and that nothing added since is deleted). The manual file copy stays as the way to restore a whole snapshot, e.g. for a damaged database. The feature list mentions selective restore.
- [x] `backup.ts` header comment: mentions the safety backup before a restore, points to the in-app restore (`restore.ts`), and keeps the manual whole restore.
- [x] Tested on a copy of the real database, not the live one:
  - The live database was copied read-only with `VACUUM INTO`, and the 7 real backups were copied next to it.
  - A second server ran on port 3555 with `DB_PATH` pointing at the copy, so its backup folder was the copy's too. The live server's backup folder stayed at 7 files throughout.
- [x] Results on the copy:
  - **Diffs:** all 7 backups diff in about 25 ms each. They list only task edits (7 to 12 changed tasks per backup) and, for the oldest backup, one setting (`completionAnimation`). There was no ADO or `updatedAt` noise.
  - **Overwrite:** "Review: Round robin allocation" (status and `updatedAt` differed). The dry run reported 1 overwrite with no warnings and took no backup. After the restore, both fields matched the backup and the task was no longer listed as changed.
  - **Missing:** a task with 4 subtasks and 10 events was deleted on the copy. It was then listed as missing in the newest backup, and the restore brought it back with all 4 subtasks, all 10 events and its project.
  - **Setting:** `completionAnimation` from the oldest backup. `primaryColor` and `backupKeep` kept their values.
  - **Safety backups:** 3 restores added 3 safety backups (7 to 10 files), and none of the backups restored from was pruned.
- [x] Browser check of the dialog: skipped by choice. The API checks above cover the same requests the dialog sends.
- [x] Run `npx tsc -b && npm test && npx vite build`.
- [x] Commit: `docs: document selective restore`

Noted while testing: because safety backups don't prune, several restores in a row leave more than `backupKeep` files until the next daily or manual backup prunes them. That's intended (see phase 3), and harmless.

## Out of scope

- Restoring from JSON export files. The picker supports it later at little cost.
- Deleting items that were created after the backup.
- Restoring the widget config. It isn't in the export payload today.

## Risks

- **Big backups:** each diff copies and migrates the file, then serializes both databases. That's fine at the current size (around 400 KB). If it gets slow, cache the diff by file name and mtime.
- **Schema drift:** a migration that changes data, not just adds columns, could make an old backup's rows look changed. Run the older-schema test in phase 2 against every migration that rewrites data.
