import {
  type Domain,
  type IgnoreValue,
  type NumArray,
} from '@h5web/shared/vis-models';
import ndarray, { type NdArray } from 'ndarray';

import { type VisScaleType } from '../models';
import { createScale, getAxisDomain, SCALES_VALID_MINS } from '../utils';

/* Above this number of vertices, the surface is downsampled (by decimation)
 * to keep geometry generation and rendering responsive (~1024 x 1024). */
export const DEFAULT_MAX_VERTICES = 1024 * 1024;

export interface SurfaceBuffers {
  positions: Float32Array; // normalized height: z in [0, 1]
  index: Uint32Array;
}

/** Check that arrays can be shown as a surface, coloured by `colorArray` if provided. */
export function assertSurfaceArrays(
  dataArray: NdArray<NumArray>,
  colorArray?: NdArray<NumArray>,
): void {
  if (dataArray.shape.length !== 2) {
    throw new Error('Expected two-dimensional array');
  }

  if (!isSurfaceSupported(dataArray.shape)) {
    throw new Error('Expected at least two rows and two columns');
  }

  if (
    colorArray &&
    (colorArray.shape.length !== 2 ||
      colorArray.shape[0] !== dataArray.shape[0] ||
      colorArray.shape[1] !== dataArray.shape[1])
  ) {
    throw new Error('Expected colour array of same shape as data array');
  }
}

/** Surfaces need at least two rows and two columns to have any triangle. */
export function isSurfaceSupported(shape: number[]): boolean {
  return shape.length === 2 && shape[0] >= 2 && shape[1] >= 2;
}

/**
 * Stride to apply along both dimensions so that the
 * number of vertices does not exceed `maxVertices`.
 */
export function getDownsamplingStride(
  rows: number,
  cols: number,
  maxVertices = DEFAULT_MAX_VERTICES,
): number {
  if (rows * cols <= maxVertices) {
    return 1;
  }

  // Initial estimate, then account for dimensions that cannot shrink proportionally
  // (e.g. very elongated arrays) and for last index always being sampled
  let stride = Math.ceil(Math.sqrt((rows * cols) / maxVertices));
  const maxStride = Math.max(rows, cols);

  while (
    stride < maxStride &&
    getSampledCount(rows, stride) * getSampledCount(cols, stride) > maxVertices
  ) {
    stride += 1;
  }

  return stride;
}

function getSampledCount(length: number, stride: number): number {
  return Math.ceil((length - 1) / stride) + 1;
}

/**
 * Indices `0, stride, 2 * stride, ...` along a dimension of given length,
 * always including the last index so the full extent of the data is preserved.
 */
export function getSampledIndices(length: number, stride: number): number[] {
  const indices: number[] = [];
  for (let i = 0; i < length; i += stride) {
    indices.push(i);
  }

  if (length > 0 && indices[indices.length - 1] !== length - 1) {
    indices.push(length - 1);
  }

  return indices;
}

/** Pick the given rows and columns of a 2D array (nearest-neighbour decimation). */
export function sampleArray(
  values: NdArray<NumArray>,
  rowIndices: number[],
  colIndices: number[],
): NdArray<NumArray> {
  const [rows, cols] = values.shape;
  if (rowIndices.length === rows && colIndices.length === cols) {
    return values;
  }

  const data = new Float64Array(rowIndices.length * colIndices.length);
  rowIndices.forEach((row, i) => {
    colIndices.forEach((col, j) => {
      data[i * colIndices.length + j] = values.get(row, col);
    });
  });

  return ndarray(data, [rowIndices.length, colIndices.length]);
}

/**
 * Coordinates of the centres of the data cells along a dimension of size `count`:
 * - indices if no axis values are provided;
 * - mid-points if axis values are pixel edges (i.e. `count + 1` values);
 * - axis values as is otherwise.
 */
export function getCellCenters(
  axisValues: NumArray | undefined,
  count: number,
): number[] {
  if (!axisValues || axisValues.length < count) {
    return Array.from({ length: count }, (_, i) => i);
  }

  if (axisValues.length > count) {
    return Array.from(
      { length: count },
      (_, i) => (axisValues[i] + axisValues[i + 1]) / 2,
    );
  }

  return [...axisValues];
}

/**
 * Domain of an axis, kept descending if the axis values are descending (like in `HeatmapVis`),
 * so that the surface is not mirrored compared to the heatmap.
 */
export function getCoordsDomain(coords: number[]): Domain {
  const domain = getAxisDomain(coords) ?? [-0.5, 0.5];
  const [first, last] = domain;
  if (first !== last) {
    return domain;
  }

  return [first - 0.5, last + 0.5];
}

/**
 * Size of the surface's footprint in world units - the longest side always measures 1.
 * When `keepRatio` is true, the ratio between the axis extents is respected.
 */
export function getFootprint(
  xDomain: Domain,
  yDomain: Domain,
  keepRatio: boolean,
): [number, number] {
  if (!keepRatio) {
    return [1, 1];
  }

  const ratio = Math.abs((xDomain[1] - xDomain[0]) / (yDomain[1] - yDomain[0]));
  return ratio >= 1 ? [1, 1 / ratio] : [ratio, 1];
}

interface BuildParams {
  values: NdArray<NumArray>; // 2D (rows x cols)
  xCoords: number[]; // world x of each column
  yCoords: number[]; // world y of each row
  domain: Domain;
  scaleType: VisScaleType;
  ignoreValue?: IgnoreValue;
}

/**
 * Build the vertex positions and triangle indices of the surface.
 * Height is normalized to [0, 1] with the same scale and domain as the colour,
 * so height and colour always tell the same story.
 * Cells touching a NaN, an ignored value or a value that is not supported
 * by the scale (e.g. negative values in log) are left out: they appear as holes.
 */
export function buildSurfaceBuffers(params: BuildParams): SurfaceBuffers {
  const { values, xCoords, yCoords, domain, scaleType } = params;
  const { ignoreValue } = params;
  const [rows, cols] = values.shape;
  const count = rows * cols;

  const scale = createScale(scaleType, { domain, range: [0, 1], clamp: true });
  const validMin =
    SCALES_VALID_MINS[Array.isArray(scaleType) ? scaleType[0] : scaleType];

  const positions = new Float32Array(count * 3);
  const valid = new Uint8Array(count);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i = row * cols + col;
      const val = values.get(row, col);

      const x = xCoords[col];
      const y = yCoords[row];

      // Keep positions of unused vertices finite, so bounds and normals stay valid
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue; // e.g. NaN in axis values
      }

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;

      if (!Number.isFinite(val) || val < validMin || ignoreValue?.(val)) {
        continue;
      }

      const height = scale(val);
      if (!Number.isFinite(height)) {
        continue;
      }

      valid[i] = 1;
      positions[i * 3 + 2] = height;
    }
  }

  const index = new Uint32Array(
    Math.max(rows - 1, 0) * Math.max(cols - 1, 0) * 6,
  );
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

  return { positions, index: index.slice(0, offset) };
}

/**
 * Vertex colours (linear RGB) from normalized heights: since height and colour share
 * the same scale and domain, colours can be updated without rebuilding the geometry.
 */
export function getSurfaceColors(
  positions: Float32Array,
  colorLut: Float32Array,
): Float32Array {
  const count = positions.length / 3;
  const colors = new Float32Array(count * 3);
  const lutMax = colorLut.length / 3 - 1;

  for (let i = 0; i < count; i += 1) {
    const lutIndex = Math.round(positions[i * 3 + 2] * lutMax) * 3;
    colors[i * 3] = colorLut[lutIndex];
    colors[i * 3 + 1] = colorLut[lutIndex + 1];
    colors[i * 3 + 2] = colorLut[lutIndex + 2];
  }

  return colors;
}

/** Values of a 2D array in row-major order, whatever its strides (e.g. transposed view). */
export function flattenArray(values: NdArray<NumArray>): NumArray {
  const [rows, cols] = values.shape;
  const isContiguous =
    values.offset === 0 &&
    values.stride[0] === cols &&
    values.stride[1] === 1 &&
    values.data.length === rows * cols;

  if (isContiguous) {
    return values.data;
  }

  const flat = new Float64Array(rows * cols);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      flat[row * cols + col] = values.get(row, col);
    }
  }

  return flat;
}
