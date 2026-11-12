import { FastifyInstance } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppDatabase } from '../db/index.ts';
import { linkGroups, links } from '../db/schema.ts';
import { findBrowser, installedBrowsers, launchCommands, launchDetached, Launcher } from '../browsers.ts';
import {
  AddLinksInputSchema,
  BROWSER_LABELS,
  DeleteLinksInputSchema,
  LinkGroup,
  LinkGroupInputSchema,
  LinkInputSchema,
  OpenLinksInputSchema,
  OrderInputSchema,
  isFileUrl,
  isOpenableUrl,
} from '../../shared/types.ts';

const isExistingFile = (filePath: string) => fs.statSync(filePath, { throwIfNoEntry: false })?.isFile() ?? false;

/** Every group with its links, both in the order they were added. */
export function listLinkGroups(db: AppDatabase): LinkGroup[] {
  const allLinks = db.select().from(links).orderBy(asc(links.sortOrder), asc(links.id)).all();
  return db
    .select()
    .from(linkGroups)
    .orderBy(asc(linkGroups.sortOrder), asc(linkGroups.id))
    .all()
    .map((group) => ({
      ...group,
      links: allLinks.filter((l) => l.groupId === group.id).map(({ groupId: _groupId, ...link }) => link),
    }));
}

function insertLinks(db: AppDatabase, group: LinkGroup): void {
  for (const link of group.links) {
    // A link id already in another group stays there
    db.insert(links).values({ ...link, groupId: group.id }).onConflictDoNothing().run();
  }
}

/** Inserts a group with its links, unless a group with its id exists. Returns 1 if it was added. */
export function insertLinkGroup(db: AppDatabase, { links: groupLinks, ...group }: LinkGroup): number {
  const { changes } = db.insert(linkGroups).values(group).onConflictDoNothing().run();
  if (changes) insertLinks(db, { ...group, links: groupLinks });
  return changes;
}

/** Sets an existing group's name, order and links to `group`'s. */
export function overwriteLinkGroup(db: AppDatabase, group: LinkGroup): void {
  db.update(linkGroups).set({ name: group.name, sortOrder: group.sortOrder }).where(eq(linkGroups.id, group.id)).run();
  db.delete(links).where(eq(links.groupId, group.id)).run();
  insertLinks(db, group);
}

export async function registerLinkRoutes(app: FastifyInstance, db: AppDatabase, launch: Launcher = launchDetached) {
  const getGroup = (id: string) => listLinkGroups(db).find((g) => g.id === id);

  app.get('/api/link-groups', async () => ({ groups: listLinkGroups(db), browsers: installedBrowsers() }));

  app.post('/api/link-groups', async (request, reply) => {
    const parsed = LinkGroupInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid group', details: parsed.error.flatten() });
    const now = Date.now();
    const id = crypto.randomUUID();
    db.insert(linkGroups).values({ id, name: parsed.data.name, sortOrder: now, createdAt: now }).run();
    return reply.status(201).send({ group: getGroup(id) });
  });

  // Puts the groups in the given order
  app.post('/api/link-groups/order', async (request, reply) => {
    const parsed = OrderInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid order', details: parsed.error.flatten() });
    db.transaction(() => {
      parsed.data.ids.forEach((id, i) => db.update(linkGroups).set({ sortOrder: i }).where(eq(linkGroups.id, id)).run());
    });
    return { groups: listLinkGroups(db) };
  });

  // Sets a group's links to the given order. Links listed from another group move into this one.
  app.post<{ Params: { id: string } }>('/api/link-groups/:id/links/order', async (request, reply) => {
    const parsed = OrderInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid order', details: parsed.error.flatten() });
    const groupId = request.params.id;
    if (!getGroup(groupId)) return reply.status(404).send({ error: 'Group not found' });
    db.transaction(() => {
      parsed.data.ids.forEach((id, i) => db.update(links).set({ groupId, sortOrder: i }).where(eq(links.id, id)).run());
    });
    return { groups: listLinkGroups(db) };
  });

  app.patch<{ Params: { id: string } }>('/api/link-groups/:id', async (request, reply) => {
    const parsed = LinkGroupInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid group', details: parsed.error.flatten() });
    const { changes } = db.update(linkGroups).set(parsed.data).where(eq(linkGroups.id, request.params.id)).run();
    if (changes === 0) return reply.status(404).send({ error: 'Group not found' });
    return { group: getGroup(request.params.id) };
  });

  app.delete<{ Params: { id: string } }>('/api/link-groups/:id', async (request, reply) => {
    const { changes } = db.delete(linkGroups).where(eq(linkGroups.id, request.params.id)).run();
    if (changes === 0) return reply.status(404).send({ error: 'Group not found' });
    return reply.status(204).send();
  });

  // Adds one or more links to the end of a group
  app.post<{ Params: { id: string } }>('/api/link-groups/:id/links', async (request, reply) => {
    const parsed = AddLinksInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid link', details: parsed.error.flatten() });
    const groupId = request.params.id;
    if (!getGroup(groupId)) return reply.status(404).send({ error: 'Group not found' });
    const now = Date.now();
    db.transaction(() => {
      parsed.data.links.forEach((link, i) => {
        db.insert(links)
          .values({ ...link, id: crypto.randomUUID(), groupId, sortOrder: now + i, createdAt: now })
          .run();
      });
    });
    return reply.status(201).send({ group: getGroup(groupId) });
  });

  app.patch<{ Params: { id: string } }>('/api/links/:id', async (request, reply) => {
    const parsed = LinkInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid link', details: parsed.error.flatten() });
    const { changes } = db.update(links).set(parsed.data).where(eq(links.id, request.params.id)).run();
    if (changes === 0) return reply.status(404).send({ error: 'Link not found' });
    return reply.status(204).send();
  });

  app.post('/api/links/delete', async (request, reply) => {
    const parsed = DeleteLinksInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid link ids', details: parsed.error.flatten() });
    const { changes } = db.delete(links).where(inArray(links.id, parsed.data.ids)).run();
    return { deletedCount: changes };
  });

  // Opens saved links in a browser on this machine. Only ids are accepted, so only stored http(s)
  // and local file URLs ever reach the command line, and they're passed as arguments without a
  // shell. Files are only handed to a named browser, which shows or downloads them but never runs
  // them; the system default would open them with their app, which for a program means running it.
  app.post('/api/links/open', async (request, reply) => {
    const parsed = OpenLinksInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request', details: parsed.error.flatten() });
    const { ids, browser, target, private: isPrivate } = parsed.data;

    const rows = db.select().from(links).where(inArray(links.id, ids)).all();
    if (rows.length === 0) return reply.status(404).send({ error: 'Links not found' });
    // Keep the order they were picked in
    const byId = new Map(rows.map((r) => [r.id, r]));
    const picked = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    // Checked again here, since rows can also arrive by restoring a backup database
    const refused = picked.filter((l) => !isOpenableUrl(l.url));
    if (refused.length) return reply.status(400).send({ error: `Can't open ${refused.map((l) => l.title || l.url).join(', ')}` });
    // Re-serialised so the URL is percent-encoded: no spaces or quotes reach the command line
    const urls = picked.map((l) => new URL(l.url).href);

    if (process.platform !== 'win32') {
      return reply.status(501).send({ error: 'Opening links in a browser is only supported on Windows' });
    }
    if (browser === 'default' && urls.some(isFileUrl)) {
      return reply.status(400).send({ error: "Local files can't be opened with the system default browser; pick a named browser" });
    }
    const missing = picked.filter((l) => isFileUrl(l.url) && !isExistingFile(fileURLToPath(l.url)));
    if (missing.length) {
      return reply.status(400).send({ error: `File not found: ${missing.map((l) => fileURLToPath(l.url)).join(', ')}` });
    }
    if (browser === 'default' && target === 'window') {
      return reply.status(400).send({ error: 'The system default browser can only open links as tabs' });
    }
    if (browser === 'default' && isPrivate) {
      return reply.status(400).send({ error: "The system default browser can't open private windows" });
    }
    const exe = browser === 'default' ? '' : findBrowser(browser);
    if (exe === null) return reply.status(400).send({ error: `${BROWSER_LABELS[browser]} isn't installed` });

    launch(launchCommands(browser, exe, target, urls, isPrivate));
    return { openedCount: urls.length };
  });
}
