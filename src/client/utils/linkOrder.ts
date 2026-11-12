/**
 * `ids` with `moved` placed just before `before`, or at the end when `before` is null. `moved` may
 * come from another list. Returns `ids` unchanged when `before` is `moved` itself or not in `ids`.
 */
export function placeBefore(ids: string[], moved: string, before: string | null): string[] {
  if (before === moved) return ids;
  const rest = ids.filter((id) => id !== moved);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at < 0) return ids;
  return [...rest.slice(0, at), moved, ...rest.slice(at)];
}

/** The `before` that drops onto `target`'s top (`after` false) or bottom half. */
export const dropBefore = (ids: string[], target: string, after: boolean): string | null =>
  after ? (ids[ids.indexOf(target) + 1] ?? null) : target;

/** The `before` that moves `id` one place up or down, or undefined when it's already at that end. */
export function stepBefore(ids: string[], id: string, direction: 'up' | 'down'): string | null | undefined {
  const index = ids.indexOf(id);
  if (direction === 'up') return index > 0 ? ids[index - 1] : undefined;
  return index >= 0 && index < ids.length - 1 ? (ids[index + 2] ?? null) : undefined;
}
