import crypto from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { AppDatabase } from './db/index.ts';
import { DbTask, taskEvents } from './db/schema.ts';
import { TaskEvent, TaskEventKind, TaskEventSource } from '../shared/types.ts';

export interface TaskEventChange {
  kind: TaskEventKind;
  from?: string | null;
  to?: string | null;
}

const str = (value: string | number | null) => (value === null ? null : String(value));

/** The logged fields that differ between two versions of a task. Description, tags and order are not logged. */
export function diffTask(before: DbTask, after: DbTask): TaskEventChange[] {
  const fields: [TaskEventKind, string | number | null, string | number | null][] = [
    ['title', before.title, after.title],
    ['status', before.status, after.status],
    ['due', before.dueDate, after.dueDate],
    ['priority', before.priority, after.priority],
    ['project', before.projectId, after.projectId],
  ];
  return fields
    .filter(([, from, to]) => from !== to)
    .map(([kind, from, to]) => ({ kind, from: str(from), to: str(to) }));
}

/** Call inside the transaction that makes the change. */
export function recordTaskEvents(
  db: AppDatabase,
  taskId: string,
  changes: TaskEventChange[],
  source: TaskEventSource = 'manual',
  at = Date.now()
): void {
  for (const change of changes) {
    db.insert(taskEvents)
      .values({
        id: crypto.randomUUID(),
        taskId,
        at,
        kind: change.kind,
        from: change.from ?? null,
        to: change.to ?? null,
        source,
      })
      .run();
  }
}

/** Events for one task, newest first; or every event, oldest first, for export. */
export function listTaskEvents(db: AppDatabase, taskId?: string): TaskEvent[] {
  if (taskId === undefined) {
    return db.select().from(taskEvents).orderBy(asc(taskEvents.at), asc(sql`rowid`)).all();
  }
  return db
    .select()
    .from(taskEvents)
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(desc(taskEvents.at), desc(sql`rowid`)) // rowid keeps one edit's events in order
    .all();
}

/** The newest status note of each task that has one. */
export function latestNotes(db: AppDatabase): Map<string, { text: string; at: number }> {
  const notes = new Map<string, { text: string; at: number }>();
  const rows = db
    .select({ taskId: taskEvents.taskId, text: taskEvents.to, at: taskEvents.at })
    .from(taskEvents)
    .where(eq(taskEvents.kind, 'status_note'))
    .orderBy(asc(taskEvents.at), asc(sql`rowid`)) // later rows overwrite earlier ones
    .all();
  for (const row of rows) notes.set(row.taskId, { text: row.text ?? '', at: row.at });
  return notes;
}
