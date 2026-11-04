---
name: dashboard-tasks
description: Read and manage tasks in the local Dashboard app (http://127.0.0.1:3444). Use when the user asks to add, find, update, start, complete or archive a Dashboard task, add a subtask or a note, or link this Claude session to a task.
---

# Dashboard tasks

The Dashboard runs on `http://127.0.0.1:3444` (localhost only). Call it with `curl`.

Send `-H 'X-Dashboard-Source: claude'` on every write, so the task's History shows the change came from Claude. Writes with JSON also need `-H 'Content-Type: application/json'`.

If the connection is refused, tell the user the Dashboard isn't running (`npm run dev` or `npm start` in the Dashboard repo) and stop.

## Rules

- Never delete tasks or subtasks. Archive a task instead (`status: "archived"`), which the user can restore.
- Before changing a task, find it by title and confirm with the user if more than one task matches.
- Keep notes to one line, 280 characters at most.

## Reading

```bash
curl -s http://127.0.0.1:3444/api/tasks      # all tasks with subtasks, including done and archived
curl -s http://127.0.0.1:3444/api/projects   # projects, for projectId
curl -s http://127.0.0.1:3444/api/tasks/<id>/events   # a task's history, newest first
```

Filter the task list yourself: by `title`, `status`, `projectId`, or `adoLinks[].externalId` (Azure DevOps ids such as `workitem/1234`).

## Fields

- `status`: `todo`, `in_progress`, `on_hold`, `done`, `archived`
- `priority`: `0` none, `1` low, `2` medium, `3` high, `4` urgent
- `dueDate`, `plannedFor`: `YYYY-MM-DD` or `null`
- `projectId`: a project id or `null`; `tags`: array of strings
- `holdReason`: text, used with `status: "on_hold"`
- `sourceUrls`: array of `https://` links (replaces the existing list on update)

## Writing

Create a task (only `title` is required):

```bash
curl -s -X POST http://127.0.0.1:3444/api/tasks -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"title":"Fix login redirect","priority":3,"projectId":null,"dueDate":"2026-11-10"}'
```

Update any fields, including completing (`"status":"done"`) or archiving (`"status":"archived"`):

```bash
curl -s -X PATCH http://127.0.0.1:3444/api/tasks/<id> -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"status":"in_progress"}'
```

Add a note (shows as the task's latest note):

```bash
curl -s -X POST http://127.0.0.1:3444/api/tasks/<id>/notes -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"text":"Root cause found in session middleware"}'
```

Add a subtask, then complete it:

```bash
curl -s -X POST http://127.0.0.1:3444/api/tasks/<id>/subtasks -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"title":"Write regression test"}'
curl -s -X PATCH http://127.0.0.1:3444/api/subtasks/<subtaskId> -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"isCompleted":true}'
```

## Linking this session

Link this Claude session to a task so the Dashboard shows it on the task. The next prompt then moves a `todo` task to `in_progress`.

```bash
curl -s -X PATCH http://127.0.0.1:3444/api/claude/sessions/${CLAUDE_SESSION_ID} -H 'Content-Type: application/json' -H 'X-Dashboard-Source: claude' \
  -d '{"taskId":"<id>"}'
```

A `404` means the Dashboard hasn't seen this session yet: the session hooks aren't set up (see "Claude session tracking" in the Dashboard README). Send `{"taskId":null}` to unlink.
