import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import { getContourLevels, getLevelColors, parseLevels } from './utils';

describe('getContourLevels', () => {
  it('should return nice levels strictly within the domain', () => {
    expect(getContourLevels([0, 10], ScaleType.Linear, 5)).toStrictEqual([
      2, 4, 6, 8,
    ]);
    expect(getContourLevels([-1.3, 1.3], ScaleType.Linear, 5)).toStrictEqual([
      -1, -0.5, 0, 0.5, 1,
    ]);
  });

  it('should spread levels in the space of the scale', () => {
    expect(getContourLevels([1, 1e5], ScaleType.Log, 4)).toStrictEqual([
      10, 100, 1000, 10_000,
    ]);
    const dense = getContourLevels([1, 1e3], ScaleType.Log, 3);
    expect(dense.length).toBeLessThanOrEqual(5);
    expect(dense.every((val) => val > 1 && val < 1e3)).toBe(true);
  });

  it('should handle narrow, empty and reversed domains', () => {
    expect(getContourLevels([1, 1], ScaleType.Linear, 5)).toStrictEqual([]);
    expect(getContourLevels([10, 0], ScaleType.Linear, 5)).toStrictEqual([
      2, 4, 6, 8,
    ]);
    expect(getContourLevels([0, 10], ScaleType.Linear, 0)).toStrictEqual([]);
  });
});

describe('parseLevels', () => {
  it('should parse, deduplicate and sort numbers', () => {
    expect(parseLevels('3, 1;2  1e1, foo, 2')).toStrictEqual([1, 2, 3, 10]);
    expect(parseLevels('')).toStrictEqual([]);
  });
});

describe('getLevelColors', () => {
  it('should map levels to the colour map', () => {
    const colors = getLevelColors(
      [0, 5, 10],
      [0, 10],
      ScaleType.Linear,
      'Greys',
      false,
    );
    expect(colors).toHaveLength(3);
    expect(colors[0]).toBe('#000000');
    expect(colors[2]).toBe('#ffffff');
  });
});
