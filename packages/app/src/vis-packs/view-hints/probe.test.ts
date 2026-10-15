import { describe, expect, it } from 'vitest';

import {
  getPixelEdges,
  getPixelIndex,
  getProbeDim,
  getProbeSelection,
} from './probe';

describe('getProbeDim', () => {
  it('probe along the hinted dimension if sliced, else the first sliced one', () => {
    expect(getProbeDim([3, 1, 'y', 'x'], 1)).toBe(1);
    expect(getProbeDim([3, 1, 'y', 'x'])).toBe(0);
    expect(getProbeDim([3, 'y', 'x', 1], 1)).toBe(0); // hinted dimension on an axis
    expect(getProbeDim(['y', 'x'])).toBeUndefined();
  });
});

describe('getProbeSelection', () => {
  it('select the pixel along the probe dimension, other sliced dimensions as they are', () => {
    // (k, p, i, j) stack: `k:,p,i,j`
    expect(getProbeSelection([3, 1, 'y', 'x'], 0, { 2: 10, 3: 20 })).toBe(
      ':,1,10,20',
    );
    expect(getProbeSelection([3, 1, 'y', 'x'], 1, { 2: 10, 3: 20 })).toBe(
      '3,:,10,20',
    );
    // Axes swapped since the click: same pixel
    expect(getProbeSelection([0, 'x', 'y'], 0, { 1: 4, 2: 5 })).toBe(':,4,5');
  });

  it('give no selection if the point misses a dimension on the axes', () => {
    expect(getProbeSelection(['x', 0, 'y'], 1, { 1: 4, 2: 5 })).toBeUndefined();
  });
});

describe('getPixelIndex', () => {
  it('find the pixel at a coordinate along an index axis', () => {
    const edges = getPixelEdges(undefined, 5);
    expect(edges).toEqual([0, 1, 2, 3, 4, 5]);
    expect(getPixelIndex(0, edges)).toBe(0);
    expect(getPixelIndex(2.5, edges)).toBe(2);
    expect(getPixelIndex(5, edges)).toBe(4); // last edge: last pixel
    expect(getPixelIndex(-0.1, edges)).toBeUndefined();
    expect(getPixelIndex(5.1, edges)).toBeUndefined();
  });

  it('find the pixel at a coordinate along an axis with values', () => {
    const edges = getPixelEdges([10, 20, 30], 3); // pixel values: extra edge added
    expect(edges).toEqual([10, 20, 30, 40]);
    expect(getPixelIndex(25, edges)).toBe(1);

    const descending = getPixelEdges([4, 3, 2, 1], 3); // bin edges
    expect(descending).toEqual([4, 3, 2, 1]);
    expect(getPixelIndex(3.5, descending)).toBe(0);
    expect(getPixelIndex(1.2, descending)).toBe(2);

    const centred = getPixelEdges([1, 2, 4, 8], 4); // non-uniform pixel values
    expect(centred).toEqual([0.5, 1.5, 3, 6, 10]);
    expect(getPixelIndex(5, centred)).toBe(2);
  });
});
