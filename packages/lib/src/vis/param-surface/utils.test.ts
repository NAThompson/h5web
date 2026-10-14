import ndarray from 'ndarray';
import { type Vector3Tuple } from 'three';
import { describe, expect, it } from 'vitest';

import {
  buildParamSurfaceBuffers,
  getWireIndices,
  isParamSurfaceSupported,
  toLogicalArray,
  weldSeamNormals,
} from './utils';

function identity(x: number, y: number, z: number): Vector3Tuple {
  return [x, y, z];
}

function grid(values: number[], rows: number, cols: number) {
  return ndarray(Float64Array.from(values), [rows, cols]);
}

// Flat 2 x 3 grid in the z = 0 plane
const x = grid([0, 1, 2, 0, 1, 2], 2, 3);
const y = grid([0, 0, 0, 1, 1, 1], 2, 3);
const z = grid([0, 0, 0, 0, 0, 0], 2, 3);
const values = grid([1, 2, 3, 4, 5, 6], 2, 3);

describe('isParamSurfaceSupported', () => {
  it('should accept 2D arrays of same shape with at least two rows and columns', () => {
    expect(isParamSurfaceSupported(x, y, z, values)).toBe(true);
  });

  it('should reject arrays of different shapes', () => {
    expect(isParamSurfaceSupported(x, grid([0, 1, 2, 3], 2, 2))).toBe(false);
  });

  it('should reject grids with a single row or column', () => {
    expect(isParamSurfaceSupported(grid([0, 1, 2], 1, 3))).toBe(false);
    expect(isParamSurfaceSupported(ndarray([0, 1, 2, 3], [4]))).toBe(false);
    expect(isParamSurfaceSupported()).toBe(false);
  });
});

describe('buildParamSurfaceBuffers', () => {
  it('should create vertices from coordinates and two triangles per cell', () => {
    const { positions, index } = buildParamSurfaceBuffers({
      x,
      y,
      z,
      values,
      toWorld: identity,
    });

    expect([...positions]).toEqual([
      0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0,
    ]);
    expect([...index]).toEqual([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]);
  });

  it('should create wireframe edges along grid lines', () => {
    const { edges } = buildParamSurfaceBuffers({
      x,
      y,
      z,
      values,
      toWorld: identity,
    });

    expect([...edges]).toEqual([
      0,
      1,
      1,
      2, // first row
      3,
      4,
      4,
      5, // second row
      0,
      3,
      1,
      4,
      2,
      5, // columns
    ]);
  });

  it('should leave holes at NaN coordinates and NaN or ignored values', () => {
    const withNaNCoord = buildParamSurfaceBuffers({
      x: grid([0, 1, Number.NaN, 0, 1, 2], 2, 3),
      y,
      z,
      values,
      toWorld: identity,
    });
    expect([...withNaNCoord.index]).toEqual([0, 1, 3, 1, 4, 3]); // only first cell
    expect(withNaNCoord.edges).not.toContain(2);
    expect(withNaNCoord.positions.slice(6, 9)).toEqual(
      Float32Array.from([0, 0, 0]),
    ); // finite position

    const withNaNValue = buildParamSurfaceBuffers({
      x,
      y,
      z,
      values: grid([1, Number.NaN, 3, 4, 5, 6], 2, 3),
      toWorld: identity,
    });
    expect(withNaNValue.index).toHaveLength(0); // middle column touches both cells

    const withIgnored = buildParamSurfaceBuffers({
      x,
      y,
      z,
      values,
      toWorld: identity,
      ignoreValue: (val) => val === 6,
    });
    expect([...withIgnored.index]).toEqual([0, 1, 3, 1, 4, 3]);
  });

  it('should apply world transform', () => {
    const { positions } = buildParamSurfaceBuffers({
      x,
      y,
      z,
      values,
      toWorld: (xVal, yVal, zVal) => [xVal / 2, yVal - 1, zVal + 1],
    });
    expect(positions.slice(-3)).toEqual(Float32Array.from([1, 0, 1]));
  });
});

describe('getWireIndices', () => {
  it('should return all indices for small grids', () => {
    expect(getWireIndices(4)).toEqual([0, 1, 2, 3]);
  });

  it('should skip lines for large grids but keep last one', () => {
    const indices = getWireIndices(1000);
    expect(indices.length).toBeLessThanOrEqual(65);
    expect(indices[0]).toBe(0);
    expect(indices.at(-1)).toBe(999);
  });
});

function grid3(points: [number, number, number][]): Float32Array {
  return Float32Array.from(points.flat());
}

function normalAt(normals: Float32Array, index: number): number[] {
  return Array.from(
    normals.subarray(index * 3, index * 3 + 3),
    (val) => Math.round(val * 1000) / 1000,
  );
}

const ALL_VALID = new Uint8Array(9).fill(1);
const S = Math.round(Math.SQRT1_2 * 1000) / 1000;
const T = Math.round((1 / Math.sqrt(3)) * 1000) / 1000;

describe('weldSeamNormals', () => {
  it('should average normals of duplicate vertices on first/last columns (column seam)', () => {
    // 3 x 3 grid whose last column coincides with first column
    // prettier-ignore
    const positions = grid3([
      [0, 0, 0], [1, 0, 0], [0, 0, 0],
      [0, 1, 0], [1, 1, 0], [0, 1, 0],
      [0, 2, 0], [1, 2, 0], [0, 2, 0],
    ]);
    // prettier-ignore
    const normals = grid3([
      [1, 0, 0], [0, 0, 1], [0, 1, 0],
      [1, 0, 0], [0, 0, 1], [0, 1, 0],
      [1, 0, 0], [0, 0, 1], [0, 1, 0],
    ]);

    weldSeamNormals(positions, normals, ALL_VALID, 3, 3);

    for (const row of [0, 1, 2]) {
      expect(normalAt(normals, row * 3)).toEqual([S, S, 0]);
      expect(normalAt(normals, row * 3 + 2)).toEqual([S, S, 0]);
      expect(normalAt(normals, row * 3 + 1)).toEqual([0, 0, 1]); // untouched
    }
  });

  it('should average normals of duplicate vertices on first/last rows (row seam)', () => {
    // prettier-ignore
    const positions = grid3([
      [0, 0, 0], [1, 0, 0], [2, 0, 0],
      [0, 1, 0], [1, 1, 0], [2, 1, 0],
      [0, 0, 0], [1, 0, 0], [2, 0, 0],
    ]);
    // prettier-ignore
    const normals = grid3([
      [1, 0, 0], [1, 0, 0], [1, 0, 0],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [0, 1, 0], [0, 1, 0], [0, 1, 0],
    ]);

    weldSeamNormals(positions, normals, ALL_VALID, 3, 3);

    expect(normalAt(normals, 1)).toEqual([S, S, 0]);
    expect(normalAt(normals, 7)).toEqual([S, S, 0]);
    expect(normalAt(normals, 4)).toEqual([0, 0, 1]);
  });

  it('should weld the four corners of a double seam (torus) with even weights', () => {
    // All four corners coincide, as do first/last rows and columns
    // prettier-ignore
    const positions = grid3([
      [0, 0, 0], [1, 0, 0], [0, 0, 0],
      [0, 1, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 0], [1, 0, 0], [0, 0, 0],
    ]);
    // prettier-ignore
    const normals = grid3([
      [1, 0, 0], [0, 0, 1], [0, 1, 0],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [0, 0, 1], [0, 0, 1], [1, 0, 0],
    ]);

    weldSeamNormals(positions, normals, ALL_VALID, 3, 3);

    // (1, 0, 0) + (0, 1, 0) + (0, 0, 1) + (1, 0, 0), each corner counted once
    const expected = [2, 1, 1].map(
      (val) => Math.round((val / Math.sqrt(6)) * 1000) / 1000,
    );
    for (const corner of [0, 2, 6, 8]) {
      expect(normalAt(normals, corner)).toEqual(expected);
    }
  });

  it('should give a shared averaged normal to all vertices of a pole row', () => {
    // First row collapsed onto a single point (e.g. pole of a sphere)
    // prettier-ignore
    const positions = grid3([
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [1, 0, 0], [0, 1, 0], [-1, 0, 0],
      [2, 0, 0], [0, 2, 0], [-2, 0, 0],
    ]);
    // prettier-ignore
    const normals = grid3([
      [1, 0, 0], [0, 1, 0], [0, 0, 1],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
    ]);

    weldSeamNormals(positions, normals, ALL_VALID, 3, 3);

    for (const index of [0, 1, 2]) {
      expect(normalAt(normals, index)).toEqual([T, T, T]);
    }
  });

  it('should ignore invalid vertices', () => {
    // Invalid vertices stay at the origin, where a valid boundary vertex also is
    // prettier-ignore
    const positions = grid3([
      [0, 0, 0], [1, 0, 0], [0, 0, 0],
      [0, 1, 0], [1, 1, 0], [2, 1, 0],
      [0, 2, 0], [1, 2, 0], [2, 2, 0],
    ]);
    // prettier-ignore
    const normals = grid3([
      [1, 0, 0], [0, 0, 1], [0, 0, 0],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
      [0, 0, 1], [0, 0, 1], [0, 0, 1],
    ]);
    const valid = Uint8Array.from([1, 1, 0, 1, 1, 1, 1, 1, 1]);

    weldSeamNormals(positions, normals, valid, 3, 3);

    expect(normalAt(normals, 0)).toEqual([1, 0, 0]);
    expect(normalAt(normals, 2)).toEqual([0, 0, 0]);
  });

  it('should not touch normals of distinct vertices', () => {
    // prettier-ignore
    const positions = grid3([
      [0, 0, 0], [1, 0, 0], [2, 0, 0],
      [0, 1, 0], [1, 1, 0], [2, 1, 0],
      [0, 2, 0], [1, 2, 0], [2, 2, 0],
    ]);
    const normals = grid3(
      Array.from({ length: 9 }, (_, i): [number, number, number] => [
        i % 2,
        0,
        1,
      ]),
    );
    const before = [...normals];
    weldSeamNormals(positions, normals, ALL_VALID, 3, 3);
    expect([...normals]).toEqual(before);
  });
});

describe('toLogicalArray', () => {
  it('should return contiguous array as is', () => {
    const arr = ndarray(Float64Array.from([0, 1, 2, 3, 4, 5]), [2, 3]);
    expect(toLogicalArray(arr)).toBe(arr);
  });

  it('should materialise transposed, reversed and sliced views in logical order', () => {
    const arr = ndarray(Float64Array.from([0, 1, 2, 3, 4, 5]), [2, 3]);
    expect([...toLogicalArray(arr.transpose(1, 0)).data]).toEqual([
      0, 3, 1, 4, 2, 5,
    ]);
    expect([...toLogicalArray(arr.step(-1, 1)).data]).toEqual([
      3, 4, 5, 0, 1, 2,
    ]);
    expect([...toLogicalArray(arr.hi(2, 2)).data]).toEqual([0, 1, 3, 4]);
    expect([...toLogicalArray(arr.lo(1, 0)).data]).toEqual([3, 4, 5]);
  });
});
