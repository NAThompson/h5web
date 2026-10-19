import { type Domain, type NumArray } from '@h5web/shared/vis-models';
import { rgb } from 'd3-color';

import { type ColorMap } from '../heatmap/models';
import { getInterpolator } from '../heatmap/utils';

/* Point clouds (`ScatterPlotVis`, `Scatter3DVis`): points live in the unit square / cube, which
 * the `points` object scales to the vis box, so resizing or changing the box ratio never touches
 * the per-point buffers. Colours, sizes and the picking grid are computed once per change of
 * data, domain or colour map - never per frame. */

const LUT_SIZE = 256;

export type Rgb255 = [number, number, number];

/** Map a value to [0, 1] along an axis (`NaN` if it cannot be placed, e.g. ≤ 0 in log scale). */
export type UnitScale = (val: number) => number;

/** Linear map of a domain to [0, 1]; flat domains map finite values to the middle. */
export function getLinearUnitScale([min, max]: Domain): UnitScale {
  const extent = max - min;
  return extent === 0
    ? (val) => (Number.isFinite(val) ? 0.5 : Number.NaN)
    : (val) => (val - min) / extent;
}

/**
 * Positions in the unit square or cube, 3 per point (`z = 0` without third coordinate),
 * `NaN` where a coordinate cannot be placed.
 */
export function getUnitPositions(
  coords: [NumArray, NumArray, NumArray?],
  scales: [UnitScale, UnitScale, UnitScale?],
): Float32Array {
  const [x, y, z] = coords;
  const [sx, sy, sz] = scales;
  const count = Math.min(x.length, y.length, z?.length ?? Infinity);
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = sx(x[i]);
    positions[i * 3 + 1] = sy(y[i]);
    positions[i * 3 + 2] = z && sz ? sz(z[i]) : 0;
  }

  return positions;
}

/** Colour map lookup table in sRGB bytes, as drawn by the point shader. */
export function getSrgbLut(
  colorMap: ColorMap,
  invertColorMap: boolean,
): Uint8Array {
  const interpolator = getInterpolator(colorMap, invertColorMap);
  const lut = new Uint8Array(LUT_SIZE * 3);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const { r, g, b } = rgb(interpolator(i / (LUT_SIZE - 1)));
    lut.set([r, g, b], i * 3);
  }
  return lut;
}

/** CSS colour as sRGB bytes; `undefined` if invalid or not given. */
export function toRgb255(css: string | undefined): Rgb255 | undefined {
  if (!css) {
    return undefined;
  }
  const { r, g, b } = rgb(css);
  return [r, g, b].every(Number.isFinite)
    ? [Math.round(r), Math.round(g), Math.round(b)]
    : undefined;
}

export interface PointColorOptions {
  lut: Uint8Array;
  nan?: Rgb255; // colour of values that cannot be coloured; hidden if not given
  below?: Rgb255; // beyond the ends of the domain (default: colour of that end)
  above?: Rgb255;
}

/**
 * sRGB colours, 3 bytes per point, from positions on the colour map (cf. `getColorParams`), or a
 * single colour for all points. Colourless points (`NaN` without `nan` colour) stay black: they
 * are hidden by `getPointSizes`.
 */
export function getPointColors(
  count: number,
  params: Float32Array | undefined,
  options: PointColorOptions | Rgb255,
): Uint8Array {
  const colors = new Uint8Array(count * 3);
  if (!('lut' in options)) {
    for (let i = 0; i < count; i += 1) {
      colors.set(options, i * 3);
    }
    return colors;
  }
  if (!params) {
    return colors;
  }

  const { lut, nan, below, above } = options;
  const lutMax = lut.length / 3 - 1;
  for (let i = 0; i < count; i += 1) {
    const param = params[i];
    if (Number.isNaN(param)) {
      if (nan) {
        colors.set(nan, i * 3);
      }
    } else if (param < 0 && below) {
      colors.set(below, i * 3);
    } else if (param > 1 && above) {
      colors.set(above, i * 3);
    } else {
      const k = Math.round(Math.min(Math.max(param, 0), 1) * lutMax) * 3;
      colors[i * 3] = lut[k];
      colors[i * 3 + 1] = lut[k + 1];
      colors[i * 3 + 2] = lut[k + 2];
    }
  }
  return colors;
}

/** Finite extent of values; `undefined` if none is finite. */
export function getFiniteExtent(values: NumArray): Domain | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const val of values) {
    if (Number.isFinite(val)) {
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
  }
  return min <= max ? [min, max] : undefined;
}

/** Diameter of a point of given size value, so that its area grows linearly with the value. */
export function getSizePx(
  val: number,
  [minVal, maxVal]: Domain,
  [minPx, maxPx]: [number, number],
): number {
  const t = maxVal === minVal ? 0.5 : (val - minVal) / (maxVal - minVal);
  const clamped = Math.min(Math.max(t, 0), 1);
  return Math.sqrt(minPx ** 2 + clamped * (maxPx ** 2 - minPx ** 2));
}

/** Values of the size legend: smallest, middle and largest size values, rounded alike to a tenth
 * of their spacing (e.g. `0 0.5 1` rather than `6.05×10⁻⁶ 0.5 1`). */
export function getSizeLegendValues([min, max]: Domain): number[] {
  if (min === max) {
    return [min];
  }
  const unit = 10 ** (Math.floor(Math.log10((max - min) / 2)) - 1);
  const values = [min, (min + max) / 2, max].map((val) =>
    Number((Math.round(val / unit) * unit).toPrecision(12)),
  );
  return [...new Set(values)];
}

export interface PointSizeOptions {
  basePx: number; // without size values
  values?: NumArray; // size channel
  domain?: Domain; // of the size values
  range: [number, number]; // diameters in CSS pixels
  colorParams?: Float32Array; // points that cannot be coloured are hidden...
  showNan?: boolean; // ...unless they get a colour of their own
}

/**
 * Diameters of the points in CSS pixels; `0` hides points that cannot be placed (`NaN`
 * position), coloured (`NaN` colour without NaN colour) or sized (non-finite size, also when no
 * size is finite).
 */
export function getPointSizes(
  positions: Float32Array,
  options: PointSizeOptions,
): Float32Array {
  const { basePx, values, domain, range, colorParams, showNan } = options;
  const count = positions.length / 3;
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const isPlaced =
      Number.isFinite(positions[i * 3]) &&
      Number.isFinite(positions[i * 3 + 1]) &&
      Number.isFinite(positions[i * 3 + 2]);
    const isColored = !colorParams || showNan || !Number.isNaN(colorParams[i]);
    const val = values?.[i];
    if (!isPlaced || !isColored) {
      sizes[i] = 0;
    } else if (!values) {
      sizes[i] = basePx;
    } else {
      sizes[i] =
        val !== undefined && Number.isFinite(val) && domain
          ? getSizePx(val, domain, range)
          : 0;
    }
  }

  return sizes;
}

/** Default diameter of points without size values: smaller as clouds get denser. */
export function getAutoPointSize(count: number): number {
  return count <= 1000 ? 8 : count <= 10_000 ? 5 : count <= 100_000 ? 3 : 2;
}

/* Uniform grid over the unit square, built once per set of positions: points of each cell are
 * contiguous in `order`, from `cellStart[cell]` to `cellStart[cell + 1]` (counting sort) */
export interface PointGrid {
  cols: number;
  rows: number;
  cellStart: Uint32Array;
  order: Uint32Array;
}

const MAX_GRID_SIDE = 1024;

function toCell(t: number, side: number): number {
  return Math.min(Math.max(Math.floor(t * side), 0), side - 1);
}

/** Grid of the points of the unit square (`x` and `y` of `positions`) for nearest-point queries. */
export function buildPointGrid(positions: Float32Array): PointGrid {
  const count = positions.length / 3;
  const side = Math.min(
    Math.max(Math.ceil(Math.sqrt(count / 2)), 1),
    MAX_GRID_SIDE,
  ); // about two points per cell
  const cells = new Int32Array(count);
  const cellStart = new Uint32Array(side * side + 1);

  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const cell = toCell(y, side) * side + toCell(x, side);
      cells[i] = cell;
      cellStart[cell + 1] += 1;
    } else {
      cells[i] = -1;
    }
  }

  for (let c = 0; c < side * side; c += 1) {
    cellStart[c + 1] += cellStart[c];
  }

  const next = cellStart.slice(0, -1);
  const order = new Uint32Array(cellStart[side * side]);
  for (let i = 0; i < count; i += 1) {
    if (cells[i] >= 0) {
      order[next[cells[i]]] = i;
      next[cells[i]] += 1;
    }
  }

  return { cols: side, rows: side, cellStart, order };
}

export interface PickParams {
  sizes: Float32Array; // diameters in CSS pixels (`0`: hidden)
  sizeScale: number;
  minRadius: number; // in CSS pixels, so that tiny points can be picked
}

export function getMaxSize(sizes: Float32Array): number {
  let max = 0;
  for (const size of sizes) {
    max = Math.max(max, size);
  }
  return max;
}

/**
 * Index of the visible point of the unit square nearest to `[x, y]` among those whose disc
 * (at least `minRadius` px) contains it; `pxPerUnit` is the number of CSS pixels per unit along
 * each axis at the current zoom.
 */
export function findNearestPoint(
  grid: PointGrid,
  positions: Float32Array,
  [x, y]: [number, number],
  [pxPerUnitX, pxPerUnitY]: [number, number],
  { sizes, sizeScale, minRadius, maxSize }: PickParams & { maxSize: number }, // largest size bounds the search
): number | undefined {
  const maxRadius = Math.max((maxSize * sizeScale) / 2, minRadius);

  const { cols, rows, cellStart, order } = grid;
  const [rx, ry] = [maxRadius / pxPerUnitX, maxRadius / pxPerUnitY];
  const [c0, c1] = [toCell(x - rx, cols), toCell(x + rx, cols)];
  const [r0, r1] = [toCell(y - ry, rows), toCell(y + ry, rows)];
  if (x + rx < 0 || x - rx > 1 || y + ry < 0 || y - ry > 1) {
    return undefined;
  }

  let nearest: number | undefined;
  let nearestDist = Infinity;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const cell = r * cols + c;
      for (let k = cellStart[cell]; k < cellStart[cell + 1]; k += 1) {
        const i = order[k];
        const dx = (positions[i * 3] - x) * pxPerUnitX;
        const dy = (positions[i * 3 + 1] - y) * pxPerUnitY;
        const dist = Math.hypot(dx, dy);
        const radius = Math.max((sizes[i] * sizeScale) / 2, minRadius);
        if (sizes[i] > 0 && dist <= radius && dist < nearestDist) {
          nearest = i;
          nearestDist = dist;
        }
      }
    }
  }

  return nearest;
}

/**
 * Index of the frontmost visible point whose disc (at least `minRadius` px) contains the pixel
 * `[px, py]`, by projecting every point with `mvp` (column-major, unit cube to clip space) into a
 * viewport of `width` by `height` CSS pixels. Linear in the number of points: run on demand
 * (e.g. once per animation frame while the pointer moves), not per frame.
 */
export function findProjectedPoint(
  positions: Float32Array,
  mvp: ArrayLike<number>,
  [px, py]: [number, number],
  [width, height]: [number, number],
  { sizes, sizeScale, minRadius }: PickParams,
): number | undefined {
  const m = mvp;
  const count = positions.length / 3;
  let picked: number | undefined;
  let pickedDepth = Infinity;

  for (let i = 0; i < count; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const radius = Math.max((sizes[i] * sizeScale) / 2, minRadius);
    if (sizes[i] <= 0 || w <= 0) {
      continue; // hidden, or behind the camera
    }

    const sx = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * width) / 2;
    const sy =
      ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * height) / 2;
    if (Math.abs(sx - px) > radius || Math.abs(sy - py) > radius) {
      continue; // cheap rejection
    }

    const depth = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    if (
      Math.hypot(sx - px, sy - py) <= radius &&
      depth >= -1 &&
      depth <= 1 && // within the near and far planes
      depth < pickedDepth
    ) {
      picked = i;
      pickedDepth = depth;
    }
  }

  return picked;
}
