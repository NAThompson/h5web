import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { createArrayFromView } from '@h5web/shared/vis-utils';
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

/**
 * Array whose `data` holds exactly its values in logical (C) order - i.e. the array itself if it
 * already does, or a copy of a transposed, reversed or sliced view - so `data` can be iterated
 * directly (colours, domains) consistently with `get`.
 */
export function toLogicalArray(arr: NdArray<NumArray>): NdArray<NumArray> {
  const { data, shape, stride, offset, size } = arr;
  let expectedStride = 1;
  for (let i = shape.length - 1; i >= 0; i -= 1) {
    if (shape[i] > 1 && stride[i] !== expectedStride) {
      return createArrayFromView(arr);
    }
    expectedStride *= shape[i];
  }

  return offset === 0 && data.length === size ? arr : createArrayFromView(arr);
}

export interface ParamSurfaceBuffers {
  positions: Float32Array; // world positions, 3 floats per vertex (row-major grid)
  valid: Uint8Array; // 1 for vertices with finite coordinates and value, 0 otherwise
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
  keepInvalidValues?: boolean; // vertices with a `NaN` or ignored value are kept (e.g. coloured apart)
}

/**
 * Build the vertices, triangles and wireframe edges of a surface defined on a grid of
 * parameters (u, v) by coordinate arrays x(u, v), y(u, v) and z(u, v).
 * Vertices with a non-finite coordinate or value (e.g. `NaN`), or an ignored value,
 * are left out together with the cells and edges touching them: they appear as holes (unless
 * `keepInvalidValues` is set: only non-finite coordinates leave holes).
 */
export function buildParamSurfaceBuffers(
  params: BuildParams,
): ParamSurfaceBuffers {
  const { x, y, z, values, toWorld, ignoreValue, keepInvalidValues } = params;
  const [rows, cols] = x.shape;
  const count = rows * cols;

  const positions = new Float32Array(count * 3);
  const valid = new Uint8Array(count);
  function isValidValue(val: number): boolean {
    return keepInvalidValues || (Number.isFinite(val) && !ignoreValue?.(val));
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const xVal = x.get(row, col);
      const yVal = y.get(row, col);
      const zVal = z.get(row, col);
      const val = values.get(row, col);

      if (areFinite(xVal, yVal, zVal) && isValidValue(val)) {
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
    valid,
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

function getBoundaryIndices(rows: number, cols: number): number[] {
  const indices = new Set<number>();
  for (let col = 0; col < cols; col += 1) {
    indices.add(col);
    indices.add((rows - 1) * cols + col);
  }
  for (let row = 0; row < rows; row += 1) {
    indices.add(row * cols);
    indices.add(row * cols + cols - 1);
  }
  return [...indices];
}

/**
 * Closed surfaces have duplicate vertices along the boundary of their grid: first and last
 * columns and/or rows (seams of a cylinder or torus, including the four corners of a torus),
 * or whole rows/columns collapsed onto a single point (poles of a sphere, apex of a cone).
 * Give all coincident valid boundary vertices the same normal - the normalised sum of their
 * normals, each vertex counting once - so shading is smooth across seams and at poles.
 */
export function weldSeamNormals(
  positions: Float32Array,
  normals: Float32Array,
  valid: Uint8Array,
  rows: number,
  cols: number,
): void {
  // Group coincident vertices by position, quantised to the seam tolerance
  const groups = new Map<string, number[]>();
  for (const index of getBoundaryIndices(rows, cols)) {
    if (!valid[index]) {
      continue;
    }

    const key = [0, 1, 2]
      .map((c) => Math.round(positions[index * 3 + c] / SEAM_TOLERANCE))
      .join(',');
    const group = groups.get(key);
    if (group) {
      group.push(index);
    } else {
      groups.set(key, [index]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    let [nx, ny, nz] = [0, 0, 0];
    for (const index of group) {
      nx += normals[index * 3];
      ny += normals[index * 3 + 1];
      nz += normals[index * 3 + 2];
    }

    const length = Math.hypot(nx, ny, nz);
    if (length > 0) {
      for (const index of group) {
        normals.set([nx / length, ny / length, nz / length], index * 3);
      }
    }
  }
}
