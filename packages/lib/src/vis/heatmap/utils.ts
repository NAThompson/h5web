import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { createArrayFromView, toTypedNdArray } from '@h5web/shared/vis-utils';
import { range } from 'd3-array';
import { rgb } from 'd3-color';
import ndarray, { type NdArray } from 'ndarray';
import {
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  HalfFloatType,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  UVMapping,
} from 'three';

import {
  type CustomDomain,
  DomainError,
  type DomainErrors,
  type Size,
  type VisScaleType,
} from '../models';
import { extendDomain, SCALES_VALID_MINS } from '../utils';
import { INTERPOLATORS } from './interpolators';
import {
  type ChunkBounds,
  type ChunkRange,
  type ColorMap,
  type D3Interpolator,
  type TextureChunk,
  type TextureSafeTypedArray,
} from './models';

const GRADIENT_PRECISION = 1 / 20;
export const GRADIENT_RANGE = range(
  0,
  1 + GRADIENT_PRECISION,
  GRADIENT_PRECISION,
);

const SCALE_FNS: Record<ScaleType, (val: number, constant: number) => number> =
  {
    [ScaleType.Linear]: (val) => val,
    [ScaleType.Log]: Math.log10,
    [ScaleType.SymLog]: (val, constant) =>
      Math.sign(val) * Math.log1p(Math.abs(val) / constant) * Math.LOG10E,
    [ScaleType.Sqrt]: Math.sqrt,
    [ScaleType.Gamma]: (val) => val,
  };

const CMAP_SIZE = 256;

// GLSL implementations of scale functions, for use in shaders with a `float value` in scope
export const GLSL_SCALE: Partial<Record<ScaleType, string>> = {
  [ScaleType.Log]: 'log(value) * oneOverLog10',
  [ScaleType.SymLog]:
    'sign(value) * log1p(abs(value) / symlogConstant) * oneOverLog10', // `uniform float symlogConstant`, `GLSL_LOG1P`
  [ScaleType.Sqrt]: 'sqrt(value)',
};

// `log(1. + x)` is 0 in float32 for x below ~1e-7 (and imprecise up to ~1e-2): series there
export const GLSL_LOG1P =
  'float log1p(float x) { return x < 1e-2 ? x * (1. - x * (.5 - x * (1. / 3. - x * .25))) : log(1. + x); }';

export const GLSL_IS_SUPPORTED: Partial<Record<ScaleType, string>> = {
  [ScaleType.Log]: 'value > 0.',
  [ScaleType.Sqrt]: 'value >= 0.',
};

export const TEXTURE_TYPES = {
  float32: FloatType,
  uint16: HalfFloatType,
  uint8: UnsignedByteType,
  uint8_clamped: UnsignedByteType,
};

export function getVisDomain(
  customDomain: CustomDomain,
  dataDomain: Domain,
): Domain {
  return [customDomain[0] ?? dataDomain[0], customDomain[1] ?? dataDomain[1]];
}

/* Non-empty domain around a constant value (bounds that would overflow or underflow the scale
 * stay at the value) */
function getConstantDomain(
  value: number,
  scaleType: ScaleType,
  validMin: number,
): Domain {
  let lo: number;
  let hi: number;
  if (scaleType === ScaleType.SymLog && value !== 0) {
    const abs = Math.abs(value);
    const [absLo, absHi] = extendDomain([abs, abs], 0.5, ScaleType.Log);
    [lo, hi] = value < 0 ? [-absHi, -absLo] : [absLo, absHi];
  } else {
    const factor = scaleType === ScaleType.Log ? 0.5 : 0.05;
    const type = scaleType === ScaleType.Gamma ? ScaleType.Linear : scaleType;
    [lo, hi] = extendDomain([value, value], factor, type);
  }

  return [
    Number.isFinite(lo) && lo >= validMin ? lo : value,
    Number.isFinite(hi) ? hi : value,
  ];
}

export function getSafeDomain(
  domain: Domain,
  fallbackDomain: Domain,
  scaleType: ScaleType,
): [Domain, DomainErrors] {
  if (domain[0] > domain[1]) {
    return [fallbackDomain, { minGreater: true }];
  }

  const [min, max] = domain;
  const validMin = SCALES_VALID_MINS[scaleType];

  // Constant data (flat data domain): finite, non-empty domain - one decade on log and symlog
  // scales, ±5% otherwise (a custom domain `[v, v]` on varying data stays a threshold)
  if (
    min === max &&
    fallbackDomain[0] === min &&
    fallbackDomain[1] === min &&
    Number.isFinite(min) &&
    min >= validMin
  ) {
    return [getConstantDomain(min, scaleType, validMin), {}];
  }

  const isMinSupported = min >= validMin;
  const isMaxSupported = max >= validMin;

  const safeMin = isMinSupported ? min : fallbackDomain[0];
  const safeMax = isMaxSupported ? max : fallbackDomain[1];
  const safeMinGreater = safeMin > safeMax;

  return [
    [safeMinGreater ? safeMax : safeMin, safeMax],
    {
      minError: safeMinGreater
        ? DomainError.CustomMaxFallback
        : !isMinSupported
          ? DomainError.InvalidMinWithScale
          : undefined,
      maxError: !isMaxSupported ? DomainError.InvalidMaxWithScale : undefined,
    },
  ];
}

function getColorStops(
  interpolator: D3Interpolator,
  minMaxOnly: boolean,
): string {
  if (minMaxOnly) {
    const min = interpolator(0);
    const max = interpolator(1);
    return `${min}, ${min} 50%, ${max} 50%, ${max}`;
  }

  return GRADIENT_RANGE.map(interpolator).join(', ');
}

export function getLinearGradient(
  interpolator: D3Interpolator,
  direction: 'top' | 'bottom' | 'right' | 'left',
  minMaxOnly = false,
): string {
  const colorStops = getColorStops(interpolator, minMaxOnly);
  return `linear-gradient(to ${direction}, ${colorStops})`;
}

export function getPixelEdgeValues(
  rawValues: NumArray | undefined,
  pixelCount: number,
): NumArray {
  const pixelEdgeCount = pixelCount + 1;

  if (!rawValues) {
    return range(pixelEdgeCount);
  }

  if (rawValues.length < pixelCount) {
    throw new Error(`Expected array to have length ${pixelCount} at least`);
  }

  if (rawValues.length === pixelCount) {
    // Add value at right-hand side of last pixel, assuming raw values are regularly spaced
    const deltaCoord = rawValues[1] - rawValues[0];
    return [...rawValues, rawValues[rawValues.length - 1] + deltaCoord];
  }

  return rawValues.slice(0, pixelEdgeCount);
}

/* Deviation of the steps from the mean step above which values are not evenly spaced: relative to
 * the mean step, but no less than float32 rounding of the values allows (e.g. a float32 linspace) */
const UNIFORMITY_TOLERANCE = 1e-2;
const FLOAT_PRECISION = 2 ** -20; // a few float32 ulps, relative to the largest value

/* Whether values are strictly monotonic but not evenly spaced (e.g. Chebyshev or log grid) */
export function isNonUniform(values: NumArray): boolean {
  const n = values.length;
  if (n < 3) {
    return false;
  }

  const meanStep = (values[n - 1] - values[0]) / (n - 1);
  if (meanStep === 0 || !Number.isFinite(meanStep)) {
    return false;
  }

  const maxAbs = Math.max(Math.abs(values[0]), Math.abs(values[n - 1]));
  const tolerance = Math.max(
    UNIFORMITY_TOLERANCE * Math.abs(meanStep),
    FLOAT_PRECISION * maxAbs,
  );

  let isUniform = true;
  for (let i = 1; i < n; i += 1) {
    const step = values[i] - values[i - 1];
    if (!(step / meanStep > 0)) {
      return false; // not strictly monotonic (or NaN): drawn as evenly spaced
    }
    if (Math.abs(step - meanStep) > tolerance) {
      isUniform = false;
    }
  }

  return !isUniform;
}

/*
 * Whether a heatmap axis of `pixelCount` pixels is drawn at non-uniform positions, from its values
 * (pixel centres, or edges): the one test of the mesh, its edges and contours, so they agree
 */
export function isNonUniformAxis(
  rawValues: NumArray | undefined,
  pixelCount: number,
): rawValues is NumArray {
  return (
    rawValues !== undefined &&
    rawValues.length >= pixelCount &&
    isNonUniform(rawValues.slice(0, pixelCount + 1))
  );
}

/*
 * Pixel edges of a heatmap axis: as `getPixelEdgeValues`, except for non-uniform pixel values,
 * which are taken as pixel centres (edges at mid-points, outer edges half a step out)
 */
export function getCellEdges(
  rawValues: NumArray | undefined,
  pixelCount: number,
): NumArray {
  if (
    rawValues?.length !== pixelCount ||
    !isNonUniformAxis(rawValues, pixelCount)
  ) {
    return getPixelEdgeValues(rawValues, pixelCount);
  }

  const n = pixelCount;
  return [
    rawValues[0] - (rawValues[1] - rawValues[0]) / 2,
    ...Array.from(
      { length: n - 1 },
      (_, i) => (rawValues[i] + rawValues[i + 1]) / 2,
    ),
    rawValues[n - 1] + (rawValues[n - 1] - rawValues[n - 2]) / 2,
  ];
}

/*
 * Relative positions (from 0 to 1) of the edges and centres of the pixels of a non-uniform axis,
 * interleaved: `[edge 0, centre 0, edge 1, ..., centre N-1, edge N]` (centres default to mid-points)
 */
export function getRelativePixels(
  edges: NumArray,
  centres?: NumArray,
): Float32Array {
  const count = edges.length - 1;
  const [first, last] = [edges[0], edges[count]];
  return Float32Array.from({ length: 2 * count + 1 }, (_, i) => {
    const k = Math.floor(i / 2);
    const val =
      i % 2 === 0 ? edges[k] : (centres?.[k] ?? (edges[k] + edges[k + 1]) / 2);
    return (val - first) / (last - first);
  });
}

/* Relative positions of pixels `start` to `end` (excluded), rescaled from 0 to 1 */
export function sliceRelativePixels(
  relPixels: Float32Array,
  start: number,
  end: number,
): Float32Array {
  const [first, last] = [relPixels[2 * start], relPixels[2 * end]];
  return relPixels
    .slice(2 * start, 2 * end + 1)
    .map((pos) => (pos - first) / (last - first));
}

/*
 * Position from 0 to 1 within a heatmap's non-uniform pixels of a pixel-edge index coordinate,
 * i.e. where the centre of pixel `i` is at `i + 0.5` (e.g. vertices of contour lines);
 * `undefined` if pixels are evenly spaced (index coordinates are then proportional to positions).
 * Between pixel centres, positions are interpolated from the pixel values, if given.
 */
export function getIndexToPosition(
  rawValues: NumArray | undefined,
  pixelCount: number,
): ((index: number) => number) | undefined {
  if (!isNonUniformAxis(rawValues, pixelCount)) {
    return undefined;
  }
  const edges = getCellEdges(rawValues, pixelCount);

  // Knots: outer edges and pixel centres (`k - 0.5` for knot `k`), e.g. bin centres of bin edges
  const relPixels = getRelativePixels(edges, getPixelCentres(rawValues, edges));
  function knotIndex(k: number): number {
    return Math.min(Math.max(k - 0.5, 0), pixelCount);
  }
  function knotPos(k: number): number {
    return relPixels[Math.min(Math.max(2 * k - 1, 0), 2 * pixelCount)];
  }

  return (index) => {
    const k = Math.min(Math.max(Math.floor(index + 0.5), 0), pixelCount);
    const [u0, u1] = [knotIndex(k), knotIndex(k + 1)];
    const [p0, p1] = [knotPos(k), knotPos(k + 1)];
    return p0 + ((index - u0) / (u1 - u0)) * (p1 - p0);
  };
}

/* Non-uniform pixel values (i.e. pixel centres), if given */
export function getPixelCentres(
  rawValues: NumArray | undefined,
  edges: NumArray,
): NumArray | undefined {
  return rawValues?.length === edges.length - 1 &&
    isNonUniformAxis(rawValues, rawValues.length)
    ? rawValues
    : undefined;
}

/* Texture of the relative start and centre of each pixel along a non-uniform axis */
export function getPixelsTexture(
  relPixels: Float32Array | undefined,
): DataTexture | undefined {
  if (!relPixels) {
    return undefined;
  }

  const count = (relPixels.length - 1) / 2;
  const data = relPixels.slice(0, 2 * count); // interleaved starts and centres
  const texture = new DataTexture(data, count, 1, RGFormat, FloatType);
  texture.needsUpdate = true;
  return texture;
}

/*
 * GLSL remapping of the `coords` varying (linear across the mesh) to texture coordinates on
 * non-uniform axes, from `xPixels`/`yPixels` textures: centre of the texel of the pixel at a
 * relative position or, with linear filtering, linear between texel centres at pixel centres
 */
export function getGlslPixels(
  withX: boolean,
  withY: boolean,
  isLinear = false,
): { declarations: string; remapping: string } {
  if (!withX && !withY) {
    return { declarations: '', remapping: '' };
  }

  const x = withX ? 'toTexCoord(xPixels, coords.x)' : 'coords.x';
  const y = withY ? 'toTexCoord(yPixels, coords.y)' : 'coords.y';
  return {
    declarations: `
      uniform sampler2D xPixels;
      uniform sampler2D yPixels;

      float toTexCoord(sampler2D pixels, float pos) {
        int count = textureSize(pixels, 0).x;
        int lo = 0;
        int hi = count - 1;
        for (int k = 0; k < 24; k++) { // last pixel that starts (or is centred) before \`pos\`
          if (lo >= hi) break;
          int mid = (lo + hi + 1) / 2;
          if (texelFetch(pixels, ivec2(mid, 0), 0).${isLinear ? 'g' : 'r'} <= pos) { lo = mid; } else { hi = mid - 1; }
        }
        float t = 0.;
        ${
          isLinear
            ? `float centre = texelFetch(pixels, ivec2(lo, 0), 0).g;
        if (pos > centre && lo < count - 1) {
          t = (pos - centre) / (texelFetch(pixels, ivec2(lo + 1, 0), 0).g - centre);
        }`
            : ''
        }
        return (float(lo) + 0.5 + t) / float(count);
      }
    `,
    remapping: `vec2 coords = vec2(${x}, ${y}); // shadows varying (non-uniform axes)`,
  };
}

export function getInterpolator(
  colorMap: ColorMap,
  reverse: boolean,
): D3Interpolator {
  const interpolator = INTERPOLATORS[colorMap];
  return reverse ? (t: number) => interpolator(1 - t) : interpolator;
}

export function getColorMapTexture(
  colorMap: ColorMap,
  invertColorMap: boolean,
): DataTexture {
  const interpolator = getInterpolator(colorMap, invertColorMap);

  const colors = Array.from({ length: CMAP_SIZE }).flatMap((_, i) => {
    const { r, g, b } = rgb(interpolator(i / (CMAP_SIZE - 1)));
    return [r, g, b, 255];
  });

  const texture = new DataTexture(
    Uint8Array.from(colors),
    CMAP_SIZE,
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.needsUpdate = true;

  return texture;
}

/* Scale type, gamma exponent and symlog constant of a scale type for shaders */
export function getShaderScale(
  visScaleType: VisScaleType,
): [scaleType: ScaleType, gammaExponent: number, symlogConstant: number] {
  if (!Array.isArray(visScaleType)) {
    return [visScaleType, 1, 1];
  }
  const [scaleType, param] = visScaleType;
  return scaleType === ScaleType.SymLog
    ? [scaleType, 1, param]
    : [scaleType, param, 1];
}

export function scaleDomain(
  domain: Domain,
  scaleType = ScaleType.Linear,
  symlogConstant = 1,
): Domain {
  const scaleFn = SCALE_FNS[scaleType];
  return [
    scaleFn(domain[0], symlogConstant),
    scaleFn(domain[1], symlogConstant),
  ];
}

export function toTextureSafeNdArray(
  ndArr: NdArray<NumArray>,
): NdArray<TextureSafeTypedArray>;

export function toTextureSafeNdArray(
  ndArr: NdArray<NumArray> | undefined,
): NdArray<TextureSafeTypedArray> | undefined;

export function toTextureSafeNdArray(
  ndArr: NdArray<NumArray> | undefined,
): NdArray<TextureSafeTypedArray> | undefined {
  if (!ndArr) {
    return undefined;
  }

  if (ndArr.dtype === 'float32' || ndArr.dtype.startsWith('uint8')) {
    return ndArr as NdArray<TextureSafeTypedArray>;
  }

  // Pass float16 through as uint16 without copying
  if (ndArr.data instanceof Float16Array) {
    const { buffer, byteOffset, length } = ndArr.data;
    return ndarray(new Uint16Array(buffer, byteOffset, length), ndArr.shape);
  }

  return toTypedNdArray(ndArr, Float32Array);
}

/*
 * Since the shader of `HeatmapMesh` works with floats and expects a texture with a
 * single colour channel (red), we are limited to using the RED texture format.
 *
 * In WebGL 2.0 (https://www.khronos.org/registry/webgl/specs/latest/2.0/#3.7.6),
 * this format is compatible only with texture types FLOAT, HALF_FLOAT and UNSIGNED_BYTE,
 * which is why we support only Float32Array (FLOAT), Uint16Array (HALF_FLOAT) and
 * Uint8Array/Uint8ClampedArray (UNSIGNED_BYTE_TYPE).
 */
export function getDataTexture(
  values: NdArray<TextureSafeTypedArray>,
  magFilter?: MagnificationTextureFilter,
  minFilter?: MinificationTextureFilter,
): DataTexture;
export function getDataTexture(
  values: undefined,
  magFilter?: MagnificationTextureFilter,
  minFilter?: MinificationTextureFilter,
): undefined;
export function getDataTexture(
  values: NdArray<TextureSafeTypedArray> | undefined,
  magFilter?: MagnificationTextureFilter,
  minFilter?: MinificationTextureFilter,
): DataTexture | undefined;
export function getDataTexture(
  values: NdArray<TextureSafeTypedArray> | undefined,
  magFilter: MagnificationTextureFilter = NearestFilter,
  minFilter: MinificationTextureFilter = NearestFilter,
): DataTexture | undefined {
  if (!values) {
    return undefined;
  }
  const [rows, cols] = values.shape;

  const texture = new DataTexture(
    values.data,
    cols,
    rows,
    RedFormat,
    TEXTURE_TYPES[values.dtype],
    UVMapping,
    ClampToEdgeWrapping,
    ClampToEdgeWrapping,
    magFilter,
    minFilter,
  );
  texture.needsUpdate = true;

  return texture;
}

function getChunkRanges(length: number, maxTextureSize: number): ChunkRange[] {
  if (length <= maxTextureSize) {
    return [{ start: 0, end: length, texStart: 0, texEnd: length }];
  }

  // Leave room for one overlapping texel on each side, so linear filtering doesn't show seams
  const chunkLength = Math.ceil(
    length / Math.ceil(length / (maxTextureSize - 2)),
  );

  return range(0, length, chunkLength).map((start) => {
    const end = Math.min(start + chunkLength, length);
    return {
      start,
      end,
      texStart: Math.max(start - 1, 0),
      texEnd: Math.min(end + 1, length),
    };
  });
}

/*
 * Split a 2D array of the given shape into evenly-sized chunks whose textures
 * (including overlapping texels) fit within the GPU's `MAX_TEXTURE_SIZE`.
 */
export function getTextureChunks(
  shape: number[],
  maxTextureSize: number,
): TextureChunk[] {
  const [rows, cols] = shape;
  const colRanges = getChunkRanges(cols, maxTextureSize);

  return getChunkRanges(rows, maxTextureSize).flatMap((rowRange) =>
    colRanges.map((colRange) => ({ rows: rowRange, cols: colRange })),
  );
}

export function sliceTextureChunk<T extends TextureSafeTypedArray>(
  values: NdArray<T>,
  chunk: TextureChunk,
): NdArray<T> {
  const { rows, cols } = chunk;
  const view = values
    .lo(rows.texStart, cols.texStart)
    .hi(rows.texEnd - rows.texStart, cols.texEnd - cols.texStart);

  // Ranges of full rows in a row-major array are contiguous, so no need to copy
  const [, totalCols] = values.shape;
  const [rowStride, colStride] = values.stride;
  if (
    colStride === 1 &&
    rowStride === totalCols &&
    cols.texStart === 0 &&
    cols.texEnd === totalCols
  ) {
    const data = values.data.subarray(view.offset, view.offset + view.size);
    return ndarray(data as T, view.shape);
  }

  return createArrayFromView(view);
}

/*
 * Compute the corners of a chunk's quad within a mesh of the given size, and the
 * texture coordinates of its visible area (i.e. excluding overlapping texels).
 * Edges are computed from the same expression for adjacent chunks, so they match exactly.
 */
export function getChunkBounds(
  chunk: TextureChunk,
  shape: number[],
  size: Size,
  relX?: Float32Array, // relative pixels of non-uniform axes (cf. `getRelativePixels`)
  relY?: Float32Array,
): ChunkBounds {
  const [rows, cols] = shape;
  const { width, height } = size;
  const cellWidth = width / cols;
  const cellHeight = height / rows;

  const { rows: r, cols: c } = chunk;
  const texRows = r.texEnd - r.texStart;
  const texCols = c.texEnd - c.texStart;

  return {
    x: relX
      ? getNonUniformBounds(relX, c, width)
      : [c.start * cellWidth - width / 2, c.end * cellWidth - width / 2],
    y: relY
      ? getNonUniformBounds(relY, r, height)
      : [r.start * cellHeight - height / 2, r.end * cellHeight - height / 2],
    u: relX
      ? getNonUniformTexBounds(relX, c)
      : [(c.start - c.texStart) / texCols, (c.end - c.texStart) / texCols],
    v: relY
      ? getNonUniformTexBounds(relY, r)
      : [(r.start - r.texStart) / texRows, (r.end - r.texStart) / texRows],
  };
}

function getNonUniformBounds(
  relPixels: Float32Array,
  { start, end }: ChunkRange,
  size: number,
): [number, number] {
  return [
    (relPixels[2 * start] - 0.5) * size,
    (relPixels[2 * end] - 0.5) * size,
  ];
}

/* Relative positions within the chunk's texture, remapped to texels in the shader (`getGlslPixels`) */
function getNonUniformTexBounds(
  relPixels: Float32Array,
  { start, end, texStart, texEnd }: ChunkRange,
): [number, number] {
  const [first, last] = [relPixels[2 * texStart], relPixels[2 * texEnd]];
  return [
    (relPixels[2 * start] - first) / (last - first),
    (relPixels[2 * end] - first) / (last - first),
  ];
}

export function getChunkGeometry(bounds: ChunkBounds): BufferGeometry {
  const { x, y, u, v } = bounds;

  // Same vertex order as `PlaneGeometry`: top-left, top-right, bottom-left, bottom-right
  const geometry = new BufferGeometry();
  geometry.setIndex([0, 2, 1, 2, 3, 1]);
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [x[0], y[1], 0, x[1], y[1], 0, x[0], y[0], 0, x[1], y[0], 0],
      3,
    ),
  );
  geometry.setAttribute(
    'uv',
    new Float32BufferAttribute(
      [u[0], v[1], u[1], v[1], u[0], v[0], u[1], v[0]],
      2,
    ),
  );

  return geometry;
}

export function getMask(
  dataArray: NdArray<NumArray>,
  ignoreValue?: IgnoreValue,
): NdArray<Uint8Array> | undefined {
  if (!ignoreValue) {
    return undefined;
  }

  return ndarray(
    Uint8Array.from(dataArray.data.map((v) => (ignoreValue(v) ? 255 : 0))),
    dataArray.shape,
  );
}
