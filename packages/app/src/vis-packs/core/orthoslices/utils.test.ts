import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import {
  getInitialPoint,
  getNormalAxis,
  getOrthoSlice,
  withIndex,
} from './utils';

// Value at (z, y, x) is 100 z + 10 y + x: shape [2, 3, 4]
const SHAPE = [2, 3, 4];
const VOLUME = ndarray(
  Float32Array.from({ length: 24 }, (_, i) => {
    const [z, y, x] = [Math.floor(i / 12), Math.floor(i / 4) % 3, i % 4];
    return 100 * z + 10 * y + x;
  }),
  SHAPE,
);

describe('getOrthoSlice', () => {
  it('should slice XY plane at z, rows along y', () => {
    const slice = getOrthoSlice(VOLUME, 'xy', [0, 0, 1]);
    expect(slice.shape).toStrictEqual([3, 4]);
    expect(slice.get(2, 3)).toBe(123);
  });

  it('should slice XZ plane at y, rows along z', () => {
    const slice = getOrthoSlice(VOLUME, 'xz', [0, 2, 0]);
    expect(slice.shape).toStrictEqual([2, 4]);
    expect(slice.get(1, 3)).toBe(123);
  });

  it('should slice YZ plane at x, rows along y and columns along z', () => {
    const slice = getOrthoSlice(VOLUME, 'yz', [3, 0, 0]);
    expect(slice.shape).toStrictEqual([3, 2]);
    expect(slice.get(2, 1)).toBe(123);
    expect(slice.get(1, 0)).toBe(13);
  });

  it('should copy views into contiguous arrays', () => {
    const slice = getOrthoSlice(VOLUME, 'yz', [1, 0, 0]);
    expect(slice.offset).toBe(0);
    expect(slice.data).toHaveLength(6);
  });
});

describe('getNormalAxis', () => {
  it('should return the axis a plane is sliced along', () => {
    expect(getNormalAxis('xy')).toBe(2);
    expect(getNormalAxis('xz')).toBe(1);
    expect(getNormalAxis('yz')).toBe(0);
  });
});

describe('getInitialPoint', () => {
  it('should default to the centre', () => {
    expect(getInitialPoint([5, 6, 7], undefined)).toStrictEqual([3, 2, 2]);
  });

  it('should read hinted indices in dataset order and clamp them', () => {
    expect(getInitialPoint(SHAPE, [1, 2, 3])).toStrictEqual([3, 2, 1]);
    expect(getInitialPoint(SHAPE, [9, -1, 1.6])).toStrictEqual([2, 0, 1]);
  });
});

describe('withIndex', () => {
  it('should replace and clamp one index', () => {
    expect(withIndex([0, 0, 0], 0, 2, SHAPE)).toStrictEqual([2, 0, 0]);
    expect(withIndex([0, 0, 0], 2, 5, SHAPE)).toStrictEqual([0, 0, 1]);
  });
});
