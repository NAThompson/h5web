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
  canAllocateVolumeTexture,
  getAxisLookup,
  getBoxSize,
  getBoxSizeFromAxes,
  getLookupTexture,
  getStepCount,
  getVolumeTexture,
  remapIsosurface,
  toContiguousArray,
  toNormalizedHalfFloats,
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

describe('toNormalizedHalfFloats', () => {
  it('should store values as half floats normalized over data bounds', () => {
    const arr = ndarray(
      Float32Array.from([1000, 1001, 1002, Number.NaN, 1004, Infinity]),
      [1, 2, 3],
    );
    const { values, offset, scale } = toNormalizedHalfFloats(arr);

    expect(values.dtype).toBe('uint16');
    expect(values.shape).toStrictEqual([1, 2, 3]);
    expect(offset).toBe(1000);
    expect(scale).toBe(4);

    const halfFloats = new Float16Array(values.data.buffer);
    const restored = [...halfFloats].map((val) => val * scale + offset);
    expect(restored).toStrictEqual([
      1000,
      1001,
      1002,
      Number.NaN,
      1004,
      Infinity,
    ]);
  });

  it('should handle constant and non-finite volumes', () => {
    const constant = toNormalizedHalfFloats(
      ndarray(Float32Array.from([5, 5, Infinity]), [1, 1, 3]),
    );
    expect(constant.offset).toBe(5);
    expect(constant.scale).toBe(1);
    expect([...new Float16Array(constant.values.data.buffer)]).toStrictEqual([
      0,
      0,
      Infinity,
    ]);

    const nonFinite = toNormalizedHalfFloats(
      ndarray(Float32Array.from([Number.NaN]), [1, 1, 1]),
    );
    expect(nonFinite.offset).toBe(0);
    expect(nonFinite.scale).toBe(1);
  });
});

// Fake WebGL context that records calls and fails `texStorage3D` with the given error
function fakeContext(storageError: number) {
  let error = 0;
  const calls: unknown[][] = [];
  const boundTexture = {};
  const ctx = {
    TEXTURE_3D: 1,
    TEXTURE_BINDING_3D: 2,
    R32F: 3,
    NO_ERROR: 0,
    getParameter: () => boundTexture,
    createTexture: () => ({}),
    bindTexture: (...args: unknown[]) => calls.push(['bindTexture', ...args]),
    deleteTexture: () => calls.push(['deleteTexture']),
    texStorage3D: (...args: unknown[]) => {
      calls.push(['texStorage3D', ...args]);
      error = storageError;
    },
    getError: () => {
      const err = error;
      error = 0;
      return err;
    },
  };
  return { ctx: ctx as unknown as WebGL2RenderingContext, calls, boundTexture };
}

describe('canAllocateVolumeTexture', () => {
  it('should allocate storage without uploading data, and restore binding', () => {
    const { ctx, calls, boundTexture } = fakeContext(0);
    expect(canAllocateVolumeTexture(ctx, [110, 200, 300], ctx.R32F)).toBe(true);
    expect(calls).toContainEqual(['texStorage3D', 1, 1, 3, 300, 200, 110]);
    expect(calls.slice(-2)).toStrictEqual([
      ['bindTexture', 1, boundTexture],
      ['deleteTexture'],
    ]);
  });

  it('should report failed allocations', () => {
    const { ctx, calls } = fakeContext(0x5_02); // INVALID_OPERATION, e.g. texture too large
    expect(canAllocateVolumeTexture(ctx, [110, 2048, 2048], ctx.R32F)).toBe(
      false,
    );
    expect(calls.at(-1)).toStrictEqual(['deleteTexture']);
  });
});

describe('getAxisLookup', () => {
  it('should give relative positions of voxel edges and centres of non-uniform axes', () => {
    expect(getAxisLookup([0, 1, 2, 3], 4)).toBeUndefined();

    // Voxel centres at 0, 1 and 10000: edges at -0.5, 0.5, 5000.5 and 15000
    const knots = getAxisLookup([0, 1, 10_000], 3);
    const span = 15_000.5;
    expect(knots).toHaveLength(7);
    expect(knots?.[2]).toBeCloseTo(1 / span); // edge 0.5
    expect(knots?.[3]).toBeCloseTo(1.5 / span); // centre 1, at texture coordinate 3 / 6

    // Rays step finer across the narrow voxels, up to 4 times
    expect(getStepCount(undefined, 3)).toBe(3);
    expect(getStepCount(knots, 3)).toBe(12);
    expect(getStepCount(getAxisLookup([0, 1, 3], 3), 3)).toBeCloseTo(4.5);
  });
});

describe('getLookupTexture', () => {
  it('should wrap long lookup tables onto rows', () => {
    expect(getLookupTexture(new Float32Array(7)).image).toMatchObject({
      width: 7,
      height: 1,
    });

    // Axis of 3000 voxels: 6001 knots, over 3 rows of 2048 texels
    const table = Float32Array.from({ length: 6001 }, (_, k) => k / 6000);
    const { width, height, data } = getLookupTexture(table).image;
    expect([width, height]).toEqual([2048, 3]);
    expect(data?.[2048 + 5]).toBe(table[2048 + 5]);
  });
});

describe('remapIsosurface', () => {
  it('should move vertices along non-uniform axes and tilt normals with them', () => {
    const positions = Float32Array.from([1, 1, 1]);
    const normals = Float32Array.from([Math.SQRT1_2, Math.SQRT1_2, 0]);
    expect(
      remapIsosurface(
        positions,
        normals,
        [3, 3, 3],
        [undefined, undefined, undefined],
      ),
    ).toBeUndefined();

    // x: voxel centres at 0, 1 and 3 (twice as stretched beyond the middle voxel)
    const remapped = remapIsosurface(
      Float32Array.from([1.5, 1, 1]),
      normals,
      [3, 3, 3],
      [[0, 1, 3], undefined, undefined],
    );
    // Halfway between the centres at 1 and 3 in value, in index-equivalent units of a 4.5-wide box
    expect(remapped?.positions[0]).toBeCloseTo((2.5 / 4.5) * 3 - 0.5);
    expect(remapped?.positions[1]).toBe(1);
    const [nx, ny] = remapped?.normals ?? [];
    expect(nx).toBeLessThan(ny); // stretched along x: normal turns towards y
    expect(Math.hypot(nx, ny)).toBeCloseTo(1);
  });
});

describe('getBoxSizeFromAxes (non-uniform)', () => {
  it('should size boxes of non-uniform axes from their first to last voxel edge', () => {
    expect(
      getBoxSizeFromAxes(
        [2, 2, 3],
        [
          [0, 1, 3],
          [0, 1],
          [0, 1],
        ],
      ),
    ).toEqual([4.5, 2, 2]);
  });
});
