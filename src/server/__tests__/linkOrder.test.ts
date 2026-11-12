import { describe, it, expect } from 'vitest';
import { dropBefore, placeBefore, stepBefore } from '../../client/utils/linkOrder.ts';

describe('link ordering', () => {
  const ids = ['a', 'b', 'c'];

  it('places an item before another, at the end, or in from another list', () => {
    expect(placeBefore(ids, 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(placeBefore(ids, 'a', null)).toEqual(['b', 'c', 'a']);
    expect(placeBefore(ids, 'x', 'b')).toEqual(['a', 'x', 'b', 'c']);
    expect(placeBefore(ids, 'b', 'b')).toBe(ids);
    expect(placeBefore(ids, 'b', 'gone')).toBe(ids);
  });

  it('turns a drop on the top or bottom half into a before', () => {
    expect(dropBefore(ids, 'b', false)).toBe('b');
    expect(dropBefore(ids, 'b', true)).toBe('c');
    expect(dropBefore(ids, 'c', true)).toBeNull();
    // Dropping just below the item above it is no move
    expect(placeBefore(ids, 'b', dropBefore(ids, 'a', true))).toBe(ids);
  });

  it('steps one place up or down, and not past either end', () => {
    expect(placeBefore(ids, 'b', stepBefore(ids, 'b', 'up')!)).toEqual(['b', 'a', 'c']);
    expect(placeBefore(ids, 'b', stepBefore(ids, 'b', 'down')!)).toEqual(['a', 'c', 'b']);
    expect(placeBefore(ids, 'a', stepBefore(ids, 'a', 'down')!)).toEqual(['b', 'a', 'c']);
    expect(stepBefore(ids, 'a', 'up')).toBeUndefined();
    expect(stepBefore(ids, 'c', 'down')).toBeUndefined();
  });
});
