import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';

import { type WorldTransform } from '../three-d/utils';

/* Above this number of grid lines in either direction, wireframes show only every n-th line */
const MAX_WIRES = 64;

/* Vertices closer than this (in world units, i.e. relative to a box of size 1) are considered
 * the same point, e.g. on the seam of a closed surface. */
const SEAM_TOLERANCE = 1e-5;

/** Parametric surfaces need coordinate grids of identical shape, with at least two rows and columns. */
export function isParamSurfaceSupported(
  ...arrays: NdArray<NumArray>[]
): boolean {
  if (arrays.length === 0) {
    return false;
  }

  const [{ shape }] = arrays;
  return (
    shape.length === 2 &&
    shape[0] >= 2 &&
    shape[1] >= 2 &&
    arrays.every(
      (arr) =>
        arr.shape.length === 2 &&
        arr.shape[0] === shape[0] &&
        arr.shape[1] === shape[1],
    )
  );
}

function areFinite(...vals: number[]): boolean {
  return vals.every((val) => Number.isFinite(val));
}

export interface ParamSurfaceBuffers {
  positions: Float32Array; // world positions, 3 floats per vertex (row-major grid)
  index: Uint32Array; // triangles
  edges: Uint32Array; // pairs of vertex indices forming the grid lines of the wireframe
}

interface BuildParams {
  x: NdArray<NumArray>; // 2D (rows x cols), already downsampled if needed
  y: NdArray<NumArray>;
  z: NdArray<NumArray>;
  values: NdArray<NumArray>;
  toWorld: WorldTransform;
  ignoreValue?: IgnoreValue;
}

/**
 * Build the vertices, triangles and wireframe edges of a surface defined on a grid of
 * parameters (u, v) by coordinate arrays x(u, v), y(u, v) and z(u, v).
 * Vertices with a non-finite coordinate or value (e.g. `NaN`), or an ignored value,
 * are left out together with the cells and edges touching them: they appear as holes.
 */
export function buildParamSurfaceBuffers(
  params: BuildParams,
): ParamSurfaceBuffers {
  const { x, y, z, values, toWorld, ignoreValue } = params;
  const [rows, cols] = x.shape;
  const count = rows * cols;

  const positions = new Float32Array(count * 3);
  const valid = new Uint8Array(count);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const xVal = x.get(row, col);
      const yVal = y.get(row, col);
      const zVal = z.get(row, col);
      const val = values.get(row, col);

      if (areFinite(xVal, yVal, zVal, val) && !ignoreValue?.(val)) {
        const i = row * cols + col;
        positions.set(toWorld(xVal, yVal, zVal), i * 3); // unused vertices stay at origin, so bounds remain finite
        valid[i] = 1;
      }
    }
  }

  const index = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let offset = 0;

  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;

      if (valid[a] && valid[b] && valid[c] && valid[d]) {
        index.set([a, b, c, b, d, c], offset);
        offset += 6;
      }
    }
  }

  const edges: number[] = [];
  for (const row of getWireIndices(rows)) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      if (valid[a] && valid[a + 1]) {
        edges.push(a, a + 1);
      }
    }
  }

  for (const col of getWireIndices(cols)) {
    for (let row = 0; row < rows - 1; row += 1) {
      const a = row * cols + col;
      if (valid[a] && valid[a + cols]) {
        edges.push(a, a + cols);
      }
    }
  }

  return {
    positions,
    index: index.slice(0, offset),
    edges: Uint32Array.from(edges),
  };
}

/** Rows (or columns) of the grid to draw in the wireframe: all of them, or every n-th plus the last. */
export function getWireIndices(length: number): number[] {
  const step = Math.ceil(length / MAX_WIRES);
  const indices: number[] = [];
  for (let i = 0; i < length; i += step) {
    indices.push(i);
  }

  if (indices[indices.length - 1] !== length - 1) {
    indices.push(length - 1);
  }

  return indices;
}

function isSamePoint(positions: Float32Array, a: number, b: number): boolean {
  return (
    Math.abs(positions[a * 3] - positions[b * 3]) < SEAM_TOLERANCE &&
    Math.abs(positions[a * 3 + 1] - positions[b * 3 + 1]) < SEAM_TOLERANCE &&
    Math.abs(positions[a * 3 + 2] - positions[b * 3 + 2]) < SEAM_TOLERANCE
  );
}

function mergeNormals(normals: Float32Array, a: number, b: number): void {
  const nx = normals[a * 3] + normals[b * 3];
  const ny = normals[a * 3 + 1] + normals[b * 3 + 1];
  const nz = normals[a * 3 + 2] + normals[b * 3 + 2];
  const length = Math.hypot(nx, ny, nz);

  if (length > 0) {
    normals.set([nx / length, ny / length, nz / length], a * 3);
    normals.set([nx / length, ny / length, nz / length], b * 3);
  }
}

/**
 * Closed surfaces (e.g. torus, cylinder) have duplicate vertices along their seams - first
 * and last columns and/or rows of the grid. Average the normals of such vertices, so
 * shading is smooth across the seam.
 */
export function weldSeamNormals(
  positions: Float32Array,
  normals: Float32Array,
  rows: number,
  cols: number,
): void {
  for (let row = 0; row < rows; row += 1) {
    const a = row * cols;
    const b = a + cols - 1;
    if (isSamePoint(positions, a, b)) {
      mergeNormals(normals, a, b);
    }
  }

  for (let col = 0; col < cols; col += 1) {
    const b = (rows - 1) * cols + col;
    if (isSamePoint(positions, col, b)) {
      mergeNormals(normals, col, b);
    }
  }
}
