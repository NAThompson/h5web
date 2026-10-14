import ndarray from 'ndarray';
import {
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  UnsignedByteType,
} from 'three';
import { describe, expect, it } from 'vitest';

import {
  getBoxSize,
  getBoxSizeFromAxes,
  getVolumeTexture,
  toContiguousArray,
} from './utils';

describe('getBoxSize', () => {
  it('should map dimensions to axes and normalize largest side to 1', () => {
    expect(getBoxSize([10, 20, 40])).toStrictEqual([1, 0.5, 0.25]);
    expect(getBoxSize([64, 64, 64])).toStrictEqual([1, 1, 1]);
  });
});

describe('getVolumeTexture', () => {
  it('should create 3D texture with appropriate size, type and filtering', () => {
    const texture = getVolumeTexture(
      ndarray(new Float32Array(24), [2, 3, 4]),
      true,
    );

    expect(texture.image).toMatchObject({ width: 4, height: 3, depth: 2 });
    expect(texture.type).toBe(FloatType);
    expect(texture.magFilter).toBe(LinearFilter);
  });

  it('should support other texture-safe types', () => {
    const uint8 = ndarray(new Uint8Array(8), [2, 2, 2]);
    const uint16 = ndarray(new Uint16Array(8), [2, 2, 2]);

    expect(getVolumeTexture(uint8, true).type).toBe(UnsignedByteType);
    expect(getVolumeTexture(uint16, true).type).toBe(HalfFloatType);
  });

  it('should fall back to nearest filtering', () => {
    const texture = getVolumeTexture(
      ndarray(new Float32Array(8), [2, 2, 2]),
      false,
    );
    expect(texture.minFilter).toBe(NearestFilter);
  });
});

describe('toContiguousArray', () => {
  it('should return contiguous arrays as is', () => {
    const arr = ndarray(new Float32Array(8), [2, 2, 2]);
    expect(toContiguousArray(arr)).toBe(arr);
  });

  it('should copy views into contiguous arrays', () => {
    const arr = ndarray(
      Float32Array.from({ length: 8 }, (_, i) => i),
      [2, 2, 2],
    );
    const copy = toContiguousArray(arr.transpose(2, 1, 0));
    expect([...copy.data]).toStrictEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });
});

describe('getBoxSizeFromAxes', () => {
  it('should use physical extents of voxel centres or bin edges', () => {
    // 3 voxels along each axis
    expect(
      getBoxSizeFromAxes(
        [3, 3, 3],
        [
          [0, 1, 2],
          [0, 2, 4, 6],
          [10, 9, 8],
        ],
      ),
    ).toStrictEqual([3, 6, 3]);
    expect(
      getBoxSizeFromAxes([3, 3, 3], [[0, 1, 2], undefined, [0, 1, 2]]),
    ).toBeUndefined();
  });
});
