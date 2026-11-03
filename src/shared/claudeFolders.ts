/**
 * Claude session folders mapped to projects. A mapped folder covers its subfolders too, and
 * the longest mapped folder wins. Shared so the client can show which mapping applies.
 */

/** Case and separators ignored, as on Windows, and no trailing separator. */
// ponytail: case-insensitive everywhere; two Linux folders differing only in case would collide
const normalize = (folder: string) => folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** The folder as stored: trimmed, without trailing separators. */
export const cleanFolder = (folder: string) => folder.trim().replace(/[\\/]+$/, '');

export const sameFolder = (a: string, b: string) => normalize(a) === normalize(b);

/** The mapping that covers `cwd`: the longest mapped folder that is it or contains it. */
export function matchFolderLink<T extends { path: string }>(cwd: string, links: T[]): T | null {
  const target = normalize(cwd);
  let best: T | null = null;
  for (const link of links) {
    const folder = normalize(link.path);
    if (!folder || (target !== folder && !target.startsWith(`${folder}/`))) continue;
    if (!best || folder.length > normalize(best.path).length) best = link;
  }
  return best;
}
