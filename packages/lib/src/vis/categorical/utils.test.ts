import { describe, expect, it } from 'vitest';

import { GLASBEY } from './glasbey';
import {
  findCategoryValues,
  formatCategoryValue,
  getCategories,
  getCategoryFormat,
  getCategoryIndices,
} from './utils';

const PALETTE = ['red', 'green', 'blue'];

describe('findCategoryValues', () => {
  it('should find distinct values, ascending, without NaN and ignored values', () => {
    const values = Float32Array.from([3, 3, 0, Number.NaN, -1, 255, 0, 3]);
    expect(findCategoryValues(values)).toEqual({ values: [-1, 0, 3, 255] });
    expect(findCategoryValues(values, 10, (v) => v === 255)).toEqual({
      values: [-1, 0, 3],
    });
  });

  it('should stop at non-integer values', () => {
    expect(findCategoryValues([1, 2, 2.5])).toEqual({ problem: 'not-integer' });
  });

  it('should stop beyond the maximum number of categories', () => {
    expect(findCategoryValues([1, 2, 3, 4], 3)).toEqual({
      problem: 'too-many',
    });
    expect(findCategoryValues([1, 2, 3, 3], 3)).toEqual({ values: [1, 2, 3] });
  });
});

describe('getCategories', () => {
  it('should color values by value, cycling through the palette', () => {
    expect(getCategories([0, 1, 4, -1], PALETTE)).toEqual([
      { value: 0, color: 'red' },
      { value: 1, color: 'green' },
      { value: 4, color: 'green' },
      { value: -1, color: 'blue' },
    ]);
  });

  it('should list listed values first, colored by rank and labelled', () => {
    const listed = { values: [10, 20], labels: ['land', 'sea'] };
    expect(getCategories([20, 2], PALETTE, listed)).toEqual([
      { value: 10, color: 'red', label: 'land' },
      { value: 20, color: 'green', label: 'sea' },
      { value: 2, color: 'blue' }, // after the listed ones
    ]);
  });
});

describe('getCategoryIndices', () => {
  const categories = getCategories([0, 5, 9], PALETTE);

  it('should map values to the index of their category, others to NaN', () => {
    const indices = getCategoryIndices(
      [9, 0, 5, 7, Number.NaN, 100],
      categories,
    );
    expect([...indices]).toEqual([2, 0, 1, Number.NaN, Number.NaN, Number.NaN]);
  });

  it('should look up categories far apart', () => {
    const sparse = getCategories([-1e9, 1e9, 0.5], PALETTE);
    const indices = getCategoryIndices([1e9, 0.5, 3, -1e9], sparse);
    expect([...indices]).toEqual([1, 2, Number.NaN, 0]);
  });

  it('should map ignored values to NaN, even if listed', () => {
    const indices = getCategoryIndices([0, 5, 9], categories, (v) => v === 5);
    expect([...indices]).toEqual([0, Number.NaN, 2]);
  });

  it('should handle no categories', () => {
    expect([...getCategoryIndices([1], [])]).toEqual([Number.NaN]);
  });
});

describe('formatCategoryValue', () => {
  it('should format integers in full, without e-notation', () => {
    expect(formatCategoryValue(123_456_789)).toBe('123456789');
    expect(formatCategoryValue(-3)).toBe('-3');
  });

  it('should label values of categories', () => {
    const format = getCategoryFormat(
      getCategories([], PALETTE, { values: [1], labels: ['cloud'] }),
    );
    expect(format?.(1)).toBe('1 cloud');
    expect(format?.(2)).toBe('2');
  });
});

describe('GLASBEY', () => {
  it('should have many distinct colors', () => {
    expect(GLASBEY.length).toBeGreaterThanOrEqual(64);
    expect(new Set(GLASBEY).size).toBe(GLASBEY.length);
  });
});
