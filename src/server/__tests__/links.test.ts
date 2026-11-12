import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../index.ts';
import { LaunchCommand, launchCommands } from '../browsers.ts';
import type { LinkGroup } from '../../shared/types.ts';

describe('launchCommands', () => {
  const urls = ['https://a.test/', 'https://b.test/'];

  it('opens Chromium links as tabs, or together in one new window', () => {
    expect(launchCommands('chrome', 'chrome.exe', 'tab', urls)).toEqual([{ file: 'chrome.exe', args: urls }]);
    expect(launchCommands('edge', 'msedge.exe', 'window', urls)).toEqual([
      { file: 'msedge.exe', args: ['--new-window', ...urls] },
    ]);
  });

  it('opens private windows with each browser flag', () => {
    expect(launchCommands('chrome', 'c.exe', 'window', urls, true)).toEqual([
      { file: 'c.exe', args: ['--incognito', '--new-window', ...urls] },
    ]);
    expect(launchCommands('edge', 'e.exe', 'tab', urls, true)).toEqual([{ file: 'e.exe', args: ['--inprivate', ...urls] }]);
    expect(launchCommands('brave', 'b.exe', 'tab', urls, true)).toEqual([{ file: 'b.exe', args: ['--incognito', ...urls] }]);
    // One launch per URL: Firefox only acts on the first -private-window it is given
    expect(launchCommands('firefox', 'ff.exe', 'window', [...urls, 'https://c.test/'], true)).toEqual([
      { file: 'ff.exe', args: ['-private-window', urls[0]] },
      { file: 'ff.exe', args: ['-private-window', urls[1]], delayMs: 1500 },
      { file: 'ff.exe', args: ['-private-window', 'https://c.test/'], delayMs: 400 },
    ]);
    expect(() => launchCommands('default', '', 'tab', urls, true)).toThrow();
  });

  it('opens Firefox links with -new-tab, the first in a -new-window', () => {
    expect(launchCommands('firefox', 'ff.exe', 'tab', urls)).toEqual([
      { file: 'ff.exe', args: ['-new-tab', urls[0], '-new-tab', urls[1]] },
    ]);
    expect(launchCommands('firefox', 'ff.exe', 'window', urls)).toEqual([
      { file: 'ff.exe', args: ['-new-window', urls[0], '-new-tab', urls[1]] },
    ]);
  });

  it('opens each link through Windows for the system default, tabs only', () => {
    expect(launchCommands('default', '', 'tab', urls)).toEqual(
      urls.map((url) => ({ file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }))
    );
    expect(() => launchCommands('default', '', 'window', urls)).toThrow();
  });
});

describe('Links REST API', () => {
  let app: FastifyInstance;
  let launched: LaunchCommand[][];

  beforeEach(async () => {
    launched = [];
    app = (await buildApp({ dbPath: ':memory:', launch: (commands) => launched.push(commands) })).app;
  });

  afterEach(async () => {
    await app.close();
  });

  const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload });
  const groups = async () => (await request('GET', '/api/link-groups')).json().groups as LinkGroup[];
  const newGroup = async (name: string, urls: string[]) => {
    const group = (await request('POST', '/api/link-groups', { name })).json().group as LinkGroup;
    const res = await request('POST', `/api/link-groups/${group.id}/links`, { links: urls.map((url) => ({ url })) });
    expect(res.statusCode).toBe(201);
    return res.json().group as LinkGroup;
  };

  it('creates, renames, edits and deletes groups and links', async () => {
    const group = await newGroup(' Morning ', ['github.com', 'https://dev.azure.com/org']);
    expect(group.name).toBe('Morning');
    expect(group.links.map((l) => l.url)).toEqual(['https://github.com/', 'https://dev.azure.com/org']);

    expect((await request('PATCH', `/api/link-groups/${group.id}`, { name: 'Start of day' })).statusCode).toBe(200);
    const [first, second] = group.links;
    expect((await request('PATCH', `/api/links/${first.id}`, { title: 'Code', url: 'github.com/pulls' })).statusCode).toBe(204);
    expect((await groups())[0]).toMatchObject({
      name: 'Start of day',
      links: [{ id: first.id, title: 'Code', url: 'https://github.com/pulls' }, { id: second.id }],
    });

    expect((await request('POST', '/api/links/delete', { ids: [first.id] })).json().deletedCount).toBe(1);
    expect((await groups())[0].links.map((l) => l.id)).toEqual([second.id]);

    // Deleting a group deletes its links
    expect((await request('DELETE', `/api/link-groups/${group.id}`)).statusCode).toBe(204);
    expect(await groups()).toEqual([]);
    expect((await request('POST', '/api/links/delete', { ids: [second.id] })).json().deletedCount).toBe(0);
  });

  it('reorders groups, and reorders and moves links between groups', async () => {
    const a = await newGroup('A', ['a1.test', 'a2.test']);
    const b = await newGroup('B', ['b1.test']);
    const order = await request('POST', '/api/link-groups/order', { ids: [b.id, a.id] });
    expect(order.json().groups.map((g: LinkGroup) => g.id)).toEqual([b.id, a.id]);

    // a2 moves to the front of B; a1 stays in A
    const [a1, a2] = a.links;
    const [b1] = b.links;
    const moved = await request('POST', `/api/link-groups/${b.id}/links/order`, { ids: [a2.id, b1.id] });
    expect(moved.json().groups.map((g: LinkGroup) => [g.name, g.links.map((l) => l.id)])).toEqual([
      ['B', [a2.id, b1.id]],
      ['A', [a1.id]],
    ]);
    // Links added later go to the end
    const added = (await request('POST', `/api/link-groups/${b.id}/links`, { links: [{ url: 'b2.test' }] })).json().group as LinkGroup;
    expect(added.links.map((l) => l.url)).toEqual(['https://a2.test/', 'https://b1.test/', 'https://b2.test/']);

    expect((await request('POST', '/api/link-groups/missing/links/order', { ids: [a1.id] })).statusCode).toBe(404);
    expect((await request('POST', '/api/link-groups/order', { ids: [] })).statusCode).toBe(400);
  });

  it('stores local drive paths as file URLs', async () => {
    const group = await newGroup('Files', ['C:\\Docs\\My spec.pdf', '"D:\\a#1\\b.docx"', 'c:/x/y.txt', 'file:///E:/z.md']);
    expect(group.links.map((l) => l.url)).toEqual([
      'file:///C:/Docs/My%20spec.pdf',
      'file:///D:/a%231/b.docx',
      'file:///c:/x/y.txt',
      'file:///E:/z.md',
    ]);
  });

  it('rejects links that are not http(s) or local files, and unknown groups', async () => {
    const group = (await request('POST', '/api/link-groups', { name: 'G' })).json().group as LinkGroup;
    const refused = ['javascript:alert(1)', 'ftp://host/x', '', 'file://server/share/x.pdf', '\\\\server\\share\\x.pdf', '"\\\\server\\x"', 'file:///etc/passwd'];
    for (const url of refused) {
      const res = await request('POST', `/api/link-groups/${group.id}/links`, { links: [{ url }] });
      expect(res.statusCode, url).toBe(400);
    }
    expect((await request('POST', '/api/link-groups/missing/links', { links: [{ url: 'a.test' }] })).statusCode).toBe(404);
    expect((await request('POST', '/api/link-groups', { name: '  ' })).statusCode).toBe(400);
  });

  it.runIf(process.platform === 'win32')('opens picked links, in the order picked, percent-encoded', async () => {
    const group = await newGroup('G', ['https://a.test/x y', 'https://b.test/']);
    const [a, b] = group.links;
    const res = await request('POST', '/api/links/open', { ids: [b.id, a.id, 'gone'], browser: 'default', target: 'tab' });
    expect(res.json()).toEqual({ openedCount: 2 });
    expect(launched).toEqual([
      [
        { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'https://b.test/'] },
        { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', 'https://a.test/x%20y'] },
      ],
    ]);

    const window = await request('POST', '/api/links/open', { ids: [a.id], browser: 'default', target: 'window' });
    expect(window.statusCode).toBe(400);
    const privateDefault = await request('POST', '/api/links/open', { ids: [a.id], browser: 'default', target: 'tab', private: true });
    expect(privateDefault.statusCode).toBe(400);
    const missing = await request('POST', '/api/links/open', { ids: ['gone'], browser: 'chrome', target: 'tab' });
    expect(missing.statusCode).toBe(404);
    expect(launched).toHaveLength(1);
  });

  it.runIf(process.platform === 'win32')('opens files only in a named browser, and only if they exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-links-'));
    try {
      const existing = path.join(dir, 'tool.exe');
      fs.writeFileSync(existing, '');
      const group = await newGroup('Files', [existing, path.join(dir, 'gone.pdf')]);
      const [file, gone] = group.links;

      // The system default would run a program, so files never go to it
      const viaDefault = await request('POST', '/api/links/open', { ids: [file.id], browser: 'default', target: 'tab' });
      expect(viaDefault.statusCode).toBe(400);
      const notFound = await request('POST', '/api/links/open', { ids: [file.id, gone.id], browser: 'chrome', target: 'tab' });
      expect(notFound.statusCode).toBe(400);
      expect(notFound.json().error).toContain('gone.pdf');
      expect(launched).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips groups through export and import', async () => {
    const group = await newGroup('Docs', ['a.test', 'b.test']);
    const exported = (await request('GET', '/api/export')).json();
    expect(exported.linkGroups).toEqual([group]);

    const other = (await buildApp({ dbPath: ':memory:' })).app;
    try {
      expect((await other.inject({ method: 'POST', url: '/api/import', payload: exported })).json().importedLinkGroups).toBe(1);
      expect((await other.inject({ method: 'POST', url: '/api/import', payload: exported })).json().importedLinkGroups).toBe(0);
      expect((await other.inject({ method: 'GET', url: '/api/link-groups' })).json().groups).toEqual([group]);
    } finally {
      await other.close();
    }
  });
});

describe('Link group restore', () => {
  it('brings back a deleted group and resets a changed one to its backed-up links', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-links-'));
    const { app } = await buildApp({ dbPath: path.join(dir, 'test.db') });
    try {
      const request = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
        app.inject({ method, url, payload });
      const create = async (name: string, url: string) => {
        const group = (await request('POST', '/api/link-groups', { name })).json().group as LinkGroup;
        return (await request('POST', `/api/link-groups/${group.id}/links`, { links: [{ url }] })).json().group as LinkGroup;
      };
      const kept = await create('Kept', 'a.test');
      const deleted = await create('Deleted', 'b.test');
      const file = (await request('POST', '/api/backups')).json().backup.file as string;

      await request('DELETE', `/api/link-groups/${deleted.id}`);
      await request('POST', '/api/links/delete', { ids: [kept.links[0].id] });
      await request('POST', `/api/link-groups/${kept.id}/links`, { links: [{ url: 'c.test' }] });

      const diff = (await request('GET', `/api/backups/${encodeURIComponent(file)}/diff`)).json();
      expect(diff.sections.linkGroups.map((i: { id: string; state: string }) => [i.id, i.state])).toEqual([
        [kept.id, 'changed'],
        [deleted.id, 'missing'],
      ]);

      const restored = await request('POST', `/api/backups/${encodeURIComponent(file)}/restore`, {
        add: { linkGroups: [deleted.id] },
        overwrite: { linkGroups: [kept.id] },
      });
      expect(restored.statusCode).toBe(200);
      expect((await request('GET', '/api/link-groups')).json().groups).toEqual([kept, deleted]);
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
