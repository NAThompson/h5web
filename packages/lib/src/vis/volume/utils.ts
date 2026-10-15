import { type NumArray } from '@h5web/shared/vis-models';
import { createArrayFromView } from '@h5web/shared/vis-utils';
import ndarray, { type NdArray } from 'ndarray';
import {
  Data3DTexture,
  DataTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  type WebGLRenderer,
} from 'three';

import { type TextureSafeTypedArray } from '../heatmap/models';
import {
  getCellEdges,
  getIndexToPosition,
  getPixelCentres,
  getRelativePixels,
  isNonUniformAxis,
  TEXTURE_TYPES,
} from '../heatmap/utils';
import { type AxisValues, VolumeQuality } from './models';
import { type HalfFloatChunk } from './prepare/client';
import {
  getFloat32Bounds,
  getHalfFloatNormalization,
  toHalfFloatBits,
} from './prepare/utils';

// Ray-marching samples per voxel (halved while the camera is moving)
export const SAMPLES_PER_VOXEL: Record<VolumeQuality, number> = {
  [VolumeQuality.Low]: 0.5,
  [VolumeQuality.Medium]: 1,
  [VolumeQuality.High]: 2,
};

/**
 * Size of the volume's bounding box, preserving the aspect ratio of the dataset
 * and normalized so that the largest side has a length of 1.
 * Dimensions `[depth, rows, cols]` are mapped to `[z, y, x]`.
 */
export function getBoxSize(shape: number[]): [x: number, y: number, z: number] {
  const [depth, rows, cols] = shape;
  const max = Math.max(depth, rows, cols);
  return [cols / max, rows / max, depth / max];
}

/* Normalize a physical box size so that the largest side has a length of 1 */
export function normalizeBoxSize(
  size: [number, number, number],
): [x: number, y: number, z: number] {
  const max = Math.max(...size);
  return max > 0 && Number.isFinite(max)
    ? [size[0] / max, size[1] / max, size[2] / max]
    : [1, 1, 1];
}

/*
 * Physical size of a volume along x, y and z given the coordinates of its grid points
 * (voxel centres) or of its bin edges, for dimensions `[depth, rows, cols]`.
 * Returns `undefined` unless all three axes have usable coordinates.
 */
export function getBoxSizeFromAxes(
  shape: number[],
  axisValues: [
    x: ArrayLike<number> | undefined,
    y: ArrayLike<number> | undefined,
    z: ArrayLike<number> | undefined,
  ],
): [number, number, number] | undefined {
  const [depth, rows, cols] = shape;
  const sizes = [cols, rows, depth];

  const extents = axisValues.map((axis, i) => {
    const n = sizes[i];
    if (!axis || (axis.length !== n + 1 && (axis.length !== n || n < 2))) {
      return undefined;
    }
    // From the first to the last voxel edge (as heatmaps: non-uniform values are voxel centres)
    const edges = getCellEdges(axis as NumArray, n);
    const extent = Math.abs(edges[n] - edges[0]);
    return Number.isFinite(extent) && extent > 0 ? extent : undefined;
  });

  return extents.every((extent) => extent !== undefined)
    ? (extents as [number, number, number])
    : undefined;
}

/*
 * Lookup table of a non-uniform volume axis: relative positions (from 0 to 1) of the voxel edges
 * and centres, interleaved, i.e. knot `k` is at texture coordinate `k / (2 count)` (cf.
 * `getRelativePixels`); `undefined` if the voxels are evenly spaced
 */
export function getAxisLookup(
  values: NumArray | undefined,
  count: number,
): Float32Array | undefined {
  if (!isNonUniformAxis(values, count)) {
    return undefined;
  }
  const edges = getCellEdges(values, count);
  return getRelativePixels(edges, getPixelCentres(values, edges));
}

const MAX_STEP_DENSITY = 4; // relative to evenly spaced voxels, to bound the cost of rays

/* Number of voxels along an axis for the ray marcher's step size: enough to sample the narrowest
 * voxel of a non-uniform axis (cf. `getAxisLookup`), up to `MAX_STEP_DENSITY` times more */
export function getStepCount(
  knots: Float32Array | undefined,
  count: number,
): number {
  if (!knots) {
    return count;
  }
  let minWidth = 1;
  for (let k = 2; k < knots.length; k += 2) {
    minWidth = Math.min(minWidth, knots[k] - knots[k - 2]);
  }
  return Math.min(Math.max(count, 1 / minWidth), MAX_STEP_DENSITY * count);
}

const SLOPE_STEP = 1e-3; // index units, to differentiate positions along non-uniform axes

/*
 * Vertices of an isosurface in index coordinates (voxel centres at integers), moved along
 * non-uniform axes to where the volume draws its voxels (cf. `getAxisLookup`), with normals
 * following the stretch of each axis; `undefined` if all axes are evenly spaced
 */
export function remapIsosurface(
  positions: Float32Array,
  normals: Float32Array,
  shape: number[],
  axisValues: AxisValues,
): { positions: Float32Array; normals: Float32Array } | undefined {
  const [depth, rows, cols] = shape;
  const sizes = [cols, rows, depth];
  const toPositions = axisValues.map((values, axis) =>
    getIndexToPosition(values, sizes[axis]),
  );
  if (toPositions.every((toPos) => !toPos)) {
    return undefined;
  }

  const newPositions = Float32Array.from(positions);
  const newNormals = Float32Array.from(normals);
  for (let i = 0; i < positions.length; i += 3) {
    toPositions.forEach((toPos, axis) => {
      if (toPos) {
        const n = sizes[axis];
        const index = positions[i + axis] + 0.5; // from the first voxel edge
        newPositions[i + axis] = toPos(index) * n - 0.5;
        const slope =
          ((toPos(index + SLOPE_STEP) - toPos(index - SLOPE_STEP)) * n) /
          (2 * SLOPE_STEP);
        newNormals[i + axis] = normals[i + axis] / slope;
      }
    });
    const len = Math.hypot(newNormals[i], newNormals[i + 1], newNormals[i + 2]);
    if (len > 0) {
      newNormals[i] /= len;
      newNormals[i + 1] /= len;
      newNormals[i + 2] /= len;
    }
  }
  return { positions: newPositions, normals: newNormals };
}

const LOOKUP_WIDTH = 2048; // WebGL 2's minimum `MAX_TEXTURE_SIZE`: longer tables wrap onto rows

/* Texture of a lookup table, knot `k` at texel (`k % width`, `k / width`) */
export function getLookupTexture(table: Float32Array): DataTexture {
  const width = Math.min(table.length, LOOKUP_WIDTH);
  const height = Math.ceil(table.length / width);
  const data = new Float32Array(width * height);
  data.set(table);
  const texture = new DataTexture(data, width, height, RedFormat, FloatType);
  texture.needsUpdate = true;
  return texture;
}

// Textures are uploaded straight from `data`, so views (transposed, sliced, etc.) must be copied first
export function toContiguousArray<T extends TextureSafeTypedArray>(
  arr: NdArray<T>,
): NdArray<T> {
  const [, rows, cols] = arr.shape;
  const isContiguous =
    arr.offset === 0 &&
    arr.data.length === arr.size &&
    arr.stride[0] === rows * cols &&
    arr.stride[1] === cols &&
    arr.stride[2] === 1;

  return isContiguous ? arr : createArrayFromView(arr);
}

export function getVolumeTexture(
  values: NdArray<TextureSafeTypedArray>,
  linear: boolean,
): Data3DTexture {
  const [depth, rows, cols] = values.shape;

  const texture = new Data3DTexture(values.data, cols, rows, depth);
  texture.format = RedFormat;
  texture.type = TEXTURE_TYPES[values.dtype];
  texture.minFilter = linear ? LinearFilter : NearestFilter;
  texture.magFilter = linear ? LinearFilter : NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  return texture;
}

/* Half-float texture whose storage is allocated without data, to be filled chunk by chunk
 * with `uploadHalfFloatChunks` once initialized (cf. `WebGLRenderer#initTexture`) */
export function getHalfFloatTexture(shape: number[]): Data3DTexture {
  const [depth, rows, cols] = shape;

  const texture = new Data3DTexture(null, cols, rows, depth);
  texture.format = RedFormat;
  texture.type = HalfFloatType;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.unpackAlignment = 1;
  texture.source.dataReady = false; // allocate storage only
  texture.needsUpdate = true;

  return texture;
}

/* Upload chunks of whole slices of half floats one after the other, which avoids
 * assembling them into a single large array first */
export function uploadHalfFloatChunks(
  renderer: WebGLRenderer,
  texture: Data3DTexture,
  chunks: HalfFloatChunk[],
): void {
  const ctx = renderer.getContext() as WebGL2RenderingContext;
  const { width, height } = texture.image;
  const { __webglTexture } = renderer.properties.get(texture) as {
    __webglTexture?: WebGLTexture;
  };
  if (!__webglTexture) {
    return; // texture failed to initialize
  }

  renderer.state.bindTexture(ctx.TEXTURE_3D, __webglTexture); // keep three.js' state cache valid
  ctx.pixelStorei(ctx.UNPACK_ALIGNMENT, 1);
  for (const { start, values } of chunks) {
    const depth = values.length / (width * height);
    ctx.texSubImage3D(
      ctx.TEXTURE_3D,
      0,
      0,
      0,
      start,
      width,
      height,
      depth,
      ctx.RED,
      ctx.HALF_FLOAT,
      values,
    );
  }
}

export interface NormalizedVolume {
  values: NdArray<Uint16Array>; // half floats
  offset: number;
  scale: number;
}

export function canUseHalfFloats(): boolean {
  return typeof Float16Array !== 'undefined';
}

/**
 * Fallback for volumes too large to upload as 32-bit floats (Chromium caps textures at 1 GiB):
 * store values as half floats, normalized to [0, 1] over the data's bounds so that precision
 * doesn't depend on the magnitude of the values. The original values are recovered in the
 * shader with `value * scale + offset`. NaN and infinite values are preserved.
 */
export function toNormalizedHalfFloats(
  arr: NdArray<Float32Array>,
): NormalizedVolume {
  const normalization = getHalfFloatNormalization(getFloat32Bounds(arr.data));
  return {
    values: ndarray(toHalfFloatBits(arr.data, normalization), arr.shape),
    ...normalization,
  };
}

/* Check whether a volume texture can be allocated, without uploading any data
 * (which, if allocation fails, would otherwise be sent to the GPU in vain). */
export function canAllocateVolumeTexture(
  ctx: WebGL2RenderingContext,
  shape: number[],
  internalFormat: GLenum,
): boolean {
  const [depth, rows, cols] = shape;
  const boundTexture = ctx.getParameter(
    ctx.TEXTURE_BINDING_3D,
  ) as WebGLTexture | null;
  const texture = ctx.createTexture();

  getGLErrors(ctx); // clear previous errors
  ctx.bindTexture(ctx.TEXTURE_3D, texture);
  ctx.texStorage3D(ctx.TEXTURE_3D, 1, internalFormat, cols, rows, depth);
  const canAllocate = getGLErrors(ctx).length === 0;

  ctx.bindTexture(ctx.TEXTURE_3D, boundTexture); // keep three.js' state cache valid
  ctx.deleteTexture(texture);
  return canAllocate;
}

/* Turn failed allocations of large typed arrays into a meaningful error */
export function withMemoryCheck<T>(allocate: () => T): T {
  try {
    return allocate();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('Not enough memory to load volume', { cause: error });
    }
    throw error;
  }
}

/* Drain WebGL error flags, as several may be set at once in no guaranteed order */
export function getGLErrors(
  ctx: WebGLRenderingContext | WebGL2RenderingContext,
): number[] {
  const errors: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const error = ctx.getError();
    if (error === ctx.NO_ERROR) {
      break;
    }
    errors.push(error);
  }
  return errors;
}
