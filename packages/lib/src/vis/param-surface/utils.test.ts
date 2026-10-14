import ndarray from 'ndarray';
import { type Vector3Tuple } from 'three';
import { describe, expect, it } from 'vitest';

import {
  buildParamSurfaceBuffers,
  getWireIndices,
  isParamSurfaceSupported,
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

describe('weldSeamNormals', () => {
  it('should average normals of duplicate vertices on first/last columns', () => {
    // 1 x 3 strip whose last vertex coincides with first one
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 0]);
    const normals = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 1, 0]);
    weldSeamNormals(positions, normals, 1, 3);

    const s = Math.SQRT1_2;
    expect(normals[0]).toBeCloseTo(s);
    expect(normals[1]).toBeCloseTo(s);
    expect(normals[6]).toBeCloseTo(s);
    expect(normals[7]).toBeCloseTo(s);
    expect(normals.slice(3, 6)).toEqual(Float32Array.from([0, 0, 1])); // untouched
  });

  it('should not touch normals of distinct vertices', () => {
    const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0]);
    const normals = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 1, 0]);
    weldSeamNormals(positions, normals, 1, 3);
    expect([...normals]).toEqual([1, 0, 0, 0, 0, 1, 0, 1, 0]);
  });
});
