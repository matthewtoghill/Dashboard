import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Browser } from '../shared/types.ts';

/** One process to start: an executable and its arguments, passed without a shell. */
export interface LaunchCommand {
  file: string;
  args: string[];
}

export type Launcher = (commands: LaunchCommand[]) => void;

type NamedBrowser = Exclude<Browser, 'default'>;

// Where each browser installs on Windows, under Program Files (machine-wide) or LocalAppData (per-user)
const INSTALL_PATHS: Record<NamedBrowser, string> = {
  chrome: 'Google\\Chrome\\Application\\chrome.exe',
  edge: 'Microsoft\\Edge\\Application\\msedge.exe',
  brave: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  firefox: 'Mozilla Firefox\\firefox.exe',
};

/** The browser's executable, or null when it isn't installed. */
export function findBrowser(browser: NamedBrowser, env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== 'win32') return null;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((r): r is string => !!r);
  return roots.map((root) => path.win32.join(root, INSTALL_PATHS[browser])).find((p) => fs.existsSync(p)) ?? null;
}

/** Browsers that can be picked on this machine. The system default is always offered on Windows. */
export function installedBrowsers(): Browser[] {
  if (process.platform !== 'win32') return [];
  return [...(Object.keys(INSTALL_PATHS) as NamedBrowser[]).filter((b) => findBrowser(b)), 'default'];
}

/** The flag that opens a Chromium browser's private window. */
const PRIVATE_FLAGS: Record<Exclude<NamedBrowser, 'firefox'>, string> = {
  chrome: '--incognito',
  brave: '--incognito',
  edge: '--inprivate',
};

/**
 * The processes that open `urls` in `browser`, as tabs in a running window or together in one new
 * window, optionally private (incognito). `exe` is the browser's executable (unused for the system
 * default). The system default browser is opened through Windows, which can't ask for a new or
 * private window, so it only opens normal tabs.
 */
export function launchCommands(
  browser: Browser,
  exe: string,
  target: 'tab' | 'window',
  urls: string[],
  isPrivate = false
): LaunchCommand[] {
  if (browser === 'default') {
    if (target === 'window') throw new Error('The system default browser can only open links as tabs');
    if (isPrivate) throw new Error("The system default browser can't open private windows");
    return urls.map((url) => ({ file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }));
  }
  if (browser === 'firefox' && isPrivate) {
    // Firefox has no private tab flag: each URL joins the open private window, or starts one.
    // ponytail: "new window" isn't forced here; Firefox decides whether to reuse a private window.
    return [{ file: exe, args: urls.flatMap((url) => ['-private-window', url]) }];
  }
  if (browser === 'firefox') {
    const [first, ...rest] = urls;
    const tabs = (list: string[]) => list.flatMap((url) => ['-new-tab', url]);
    return [{ file: exe, args: target === 'window' ? ['-new-window', first, ...tabs(rest)] : tabs(urls) }];
  }
  // Chromium: listed URLs open as tabs, all in one new window with --new-window. Private tabs join
  // the open private window, or start one.
  const flags = [...(isPrivate ? [PRIVATE_FLAGS[browser]] : []), ...(target === 'window' ? ['--new-window'] : [])];
  return [{ file: exe, args: [...flags, ...urls] }];
}

/** Starts each command detached, so the browser outlives the Dashboard server. */
export const launchDetached: Launcher = (commands) => {
  for (const { file, args } of commands) {
    const child = spawn(file, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); // a missing executable is checked beforehand; never crash the server
    child.unref();
  }
};
