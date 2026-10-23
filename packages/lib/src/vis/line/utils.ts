import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type ThreeEvent } from '@react-three/fiber';
import { range } from 'd3-array';
import { schemeCategory10, schemeTableau10 } from 'd3-scale-chromatic';
import { useMemo } from 'react';

import { type VisScaleType } from '../models';
import { createScale } from '../utils';
import { type LegendObstacle } from './models';

// Categorical colour tables (e.g. of the curves of a multi-plot)
export const PALETTES = {
  Category10: schemeCategory10,
  Tableau10: schemeTableau10,
};

export function getAxisValues(
  rawValues: NumArray | undefined,
  axisLength: number,
): NumArray {
  if (!rawValues) {
    return range(axisLength);
  }

  if (rawValues.length < axisLength) {
    throw new Error(`Expected array to have length ${axisLength} at least`);
  }

  return rawValues.slice(0, axisLength);
}

export function useEventHandler<T extends MouseEvent | PointerEvent>(
  handler: ((index: number, evt: ThreeEvent<T>) => void) | undefined,
): ((evt: ThreeEvent<T>) => void) | undefined {
  return useMemo(() => {
    return (
      handler &&
      ((evt: ThreeEvent<T>) => {
        if (evt.index !== undefined) {
          handler(evt.index, evt);
        }
      })
    );
  }, [handler]);
}

/**
 * Slopes of the shape-preserving PCHIP interpolant (Fritsch–Carlson), as in Moler,
 * _Numerical Computing with MATLAB_, §3.4.
 * https://www.mathworks.com/content/dam/mathworks/mathworks-dot-com/moler/interp.pdf
 * Non-finite points split the curve into independent pieces.
 */
export function getPchipSlopes(xs: NumArray, ys: NumArray): Float64Array {
  function width(i: number): number {
    return xs[i + 1] - xs[i];
  }

  function secant(i: number): number {
    return i >= 0 && i < xs.length - 1
      ? (ys[i + 1] - ys[i]) / width(i)
      : Number.NaN;
  }

  function getSlope(i: number): number {
    const left = secant(i - 1);
    const right = secant(i);

    if (Number.isFinite(left) && Number.isFinite(right)) {
      if (left * right <= 0 || width(i - 1) * width(i) <= 0) {
        return 0; // local extremum, or abscissas reverse direction
      }
      const w1 = 2 * width(i) + width(i - 1);
      const w2 = width(i) + 2 * width(i - 1);
      return (w1 + w2) / (w1 / left + w2 / right);
    }

    if (Number.isFinite(right)) {
      return getPchipEndSlope(width(i), width(i + 1), right, secant(i + 1));
    }

    if (Number.isFinite(left)) {
      return getPchipEndSlope(width(i - 1), width(i - 2), left, secant(i - 2));
    }

    return 0;
  }

  const slopes = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    slopes[i] = getSlope(i);
  }
  return slopes;
}

// One-sided three-point estimate, clamped so the end interval cannot overshoot
function getPchipEndSlope(
  h1: number,
  h2: number,
  delta1: number,
  delta2: number,
): number {
  if (!Number.isFinite(delta2) || h1 * h2 <= 0) {
    return delta1;
  }

  const slope = ((2 * h1 + h2) * delta1 - h1 * delta2) / (h1 + h2);

  if (Math.sign(slope) !== Math.sign(delta1)) {
    return 0;
  }
  if (
    Math.sign(delta1) !== Math.sign(delta2) &&
    Math.abs(slope) > Math.abs(3 * delta1)
  ) {
    return 3 * delta1;
  }
  return slope;
}

/**
 * Slopes of the C² interpolating cubic spline with not-a-knot end conditions, like
 * MATLAB's `spline` (Moler, _Numerical Computing with MATLAB_, §3.5): through three
 * points, the parabola; through two, the line. Non-finite points and repeated abscissas
 * split the curve into independent splines; where abscissas reverse direction, the
 * splines on either side meet with slope 0, as with PCHIP.
 */
export function getSplineSlopes(xs: NumArray, ys: NumArray): Float64Array {
  const slopes = new Float64Array(xs.length);
  let start = 0;
  let clampStart = false;

  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
      start = i + 1;
      clampStart = false;
      continue;
    }

    const width = xs[i + 1] - xs[i];
    const isJoined =
      Number.isFinite(width) && width !== 0 && Number.isFinite(ys[i + 1]);
    const isReversal =
      isJoined &&
      i > start &&
      Math.sign(width) !== Math.sign(xs[i] - xs[i - 1]);

    if (isJoined && !isReversal) {
      continue;
    }

    slopes.set(
      getSplineRunSlopes(xs, ys, [start, i], [clampStart, isReversal]),
      start,
    );
    start = isReversal ? i : i + 1;
    clampStart = isReversal;
  }

  return slopes;
}

// Solves the tridiagonal system for the slopes of points `first` to `last` (Thomas algorithm)
function getSplineRunSlopes(
  xs: NumArray,
  ys: NumArray,
  [first, last]: [number, number],
  [clampFirst, clampLast]: [boolean, boolean], // slope 0 at that end
): Float64Array {
  function h(k: number): number {
    return xs[first + k + 1] - xs[first + k];
  }
  function delta(k: number): number {
    return (ys[first + k + 1] - ys[first + k]) / h(k);
  }

  const n = last - first + 1;
  if (n < 2) {
    return new Float64Array(n); // isolated point: slope 0
  }

  if (n === 2) {
    // Line, or parabola with a flat end
    return Float64Array.of(
      clampFirst ? 0 : clampLast ? 2 * delta(0) : delta(0),
      clampLast ? 0 : clampFirst ? 2 * delta(0) : delta(0),
    );
  }

  if (n === 3 && !clampFirst && !clampLast) {
    // Parabola, from its second divided difference
    const curvature = (delta(1) - delta(0)) / (h(0) + h(1));
    return Float64Array.of(
      delta(0) - curvature * h(0),
      delta(0) + curvature * h(0),
      delta(1) + curvature * h(1),
    );
  }

  // Sub-diagonal, diagonal, super-diagonal and right-hand side, as in Moler's `splinetx`
  const sub = new Float64Array(n);
  const diag = new Float64Array(n);
  const sup = new Float64Array(n);
  const rhs = new Float64Array(n);

  for (let k = 1; k < n - 1; k++) {
    sub[k] = h(k);
    diag[k] = 2 * (h(k - 1) + h(k));
    sup[k] = h(k - 1);
    rhs[k] = 3 * (h(k) * delta(k - 1) + h(k - 1) * delta(k));
  }

  // Not-a-knot: third derivative is continuous at the second and second-to-last points
  const [h0, h1, hm, hl] = [h(0), h(1), h(n - 3), h(n - 2)];
  diag[0] = clampFirst ? 1 : h1;
  sup[0] = clampFirst ? 0 : h0 + h1;
  rhs[0] = clampFirst
    ? 0
    : ((h0 + 2 * (h0 + h1)) * h1 * delta(0) + h0 ** 2 * delta(1)) / (h0 + h1);
  sub[n - 1] = clampLast ? 0 : hm + hl;
  diag[n - 1] = clampLast ? 1 : hm;
  rhs[n - 1] = clampLast
    ? 0
    : (hl ** 2 * delta(n - 3) + (2 * (hm + hl) + hl) * hm * delta(n - 2)) /
      (hm + hl);

  for (let k = 1; k < n; k++) {
    const factor = sub[k] / diag[k - 1];
    diag[k] -= factor * sup[k - 1];
    rhs[k] -= factor * rhs[k - 1];
  }

  const slopes = new Float64Array(n);
  slopes[n - 1] = rhs[n - 1] / diag[n - 1];
  for (let k = n - 2; k >= 0; k--) {
    slopes[k] = (rhs[k] - sup[k] * slopes[k + 1]) / diag[k];
  }
  return slopes;
}

/**
 * Lowest and highest values of the cubic Hermite from `y0` to `y1` with derivatives
 * `d0` and `d1` with respect to `t` in [0, 1], i.e. slopes times the interval's width.
 */
export function getHermiteExtent(
  y0: number,
  y1: number,
  d0: number,
  d1: number,
): Domain {
  const b = 3 * (y1 - y0) - 2 * d0 - d1;
  const c = d0 + d1 - 2 * (y1 - y0);
  const extent: Domain = [Math.min(y0, y1), Math.max(y0, y1)];

  // Derivative `3c t² + 2b t + d0` vanishes at (stable even for `c = 0`)
  const disc = b ** 2 - 3 * c * d0;
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
  const roots = disc >= 0 ? [q / (3 * c), d0 / q] : [];

  for (const t of roots) {
    if (t > 0 && t < 1) {
      const y = getHermiteY(y0, y1, d0, d1, t);
      extent[0] = Math.min(extent[0], y);
      extent[1] = Math.max(extent[1], y);
    }
  }
  return extent;
}

/* Value at `t` in [0, 1] of the cubic Hermite of `getHermiteExtent` */
export function getHermiteY(
  y0: number,
  y1: number,
  d0: number,
  d1: number,
  t: number,
): number {
  const b = 3 * (y1 - y0) - 2 * d0 - d1;
  const c = d0 + d1 - 2 * (y1 - y0);
  return y0 + t * (d0 + t * (b + t * c));
}

/**
 * Domain of the cubic spline through the points, as drawn on axes of the given scale
 * types: unlike the domain of the values, it includes the overshoot between points.
 */
export function getSplineDomain(
  abscissas: NumArray,
  ordinates: NumArray,
  abscissaScaleType: VisScaleType = ScaleType.Linear,
  ordinateScaleType: VisScaleType = ScaleType.Linear,
  ignoreValue?: IgnoreValue,
): Domain | undefined {
  // Splines are drawn in axis space, whatever its (affine) mapping to the canvas
  const xScale = createScale(abscissaScaleType, {});
  const yScale = createScale(ordinateScaleType, {});

  const xs = new Float64Array(ordinates.length);
  const ys = new Float64Array(ordinates.length);
  for (const [i, value] of ordinates.entries()) {
    xs[i] = xScale(abscissas[i]);
    ys[i] = ignoreValue?.(value) ? Number.NaN : yScale(value);
  }

  const slopes = getSplineSlopes(xs, ys);
  let [min, max] = [Infinity, -Infinity];
  for (let i = 0; i < ordinates.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
      continue;
    }
    const width = xs[i + 1] - xs[i];
    const [low, high] = Number.isFinite(width + ys[i + 1])
      ? getHermiteExtent(
          ys[i],
          ys[i + 1],
          slopes[i] * width,
          slopes[i + 1] * width,
        )
      : [ys[i], ys[i]];
    min = Math.min(min, low);
    max = Math.max(max, high);
  }

  return min <= max ? [yScale.invert(min), yScale.invert(max)] : undefined;
}

const LEGEND_CORNERS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
const CORNER_SIZE = 0.35; // fraction of each axis, without a legend size

/* Size of a legend and its margin from the edges, as fractions of the canvas */
export interface LegendBox {
  width: number;
  height: number;
  marginX: number;
  marginY: number;
}

const CORNER_BOX = {
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  marginX: 0,
  marginY: 0,
};

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function getCornerRect(corner: string, box: LegendBox): Rect {
  const { width, height, marginX, marginY } = box;
  const isRight = corner.endsWith('right');
  const isTop = corner.startsWith('top');
  const x0 = isRight ? 1 - marginX - width : marginX;
  const y0 = isTop ? 1 - marginY - height : marginY;
  return { x0, x1: x0 + width, y0, y1: y0 + height };
}

/* Whether segment (x0, y0)-(x1, y1) crosses a rectangle (Liang–Barsky clipping) */
function crossesRect(
  [x0, y0]: [number, number],
  [x1, y1]: [number, number],
  rect: Rect,
): boolean {
  let [tMin, tMax] = [0, 1];
  for (const [p, q] of [
    [x0 - x1, x0 - rect.x0],
    [x1 - x0, rect.x1 - x0],
    [y0 - y1, y0 - rect.y0],
    [y1 - y0, rect.y1 - y0],
  ]) {
    if (p === 0) {
      if (q < 0) {
        return false; // parallel to this edge, outside
      }
    } else if (p < 0) {
      tMin = Math.max(tMin, q / p);
    } else {
      tMax = Math.min(tMax, q / p);
    }
  }
  return tMin <= tMax;
}

/* How much a rectangle covers a reference line (1) or band (1 to 5, by overlap), else 0 */
function getObstacleCover(
  { axis, range: ends }: LegendObstacle,
  rect: Rect,
  toRelative: (val: number) => number,
): number {
  const [lo, hi] = ends.map(toRelative).sort((a, b) => a - b);
  const [r0, r1] = axis === 'x' ? [rect.x0, rect.x1] : [rect.y0, rect.y1];
  const overlap = Math.min(hi, r1) - Math.max(lo, r0); // NaN if not shown (e.g. on a log axis)
  return overlap >= 0 ? 1 + (4 * overlap) / (r1 - r0) : 0; // line: overlap of 0
}

/* Corner of the plot whose legend box covers the fewest curve points and segments, and reference
 * lines and bands, which weigh more (top right if several) */
export function getLegendCorner(
  abscissas: NumArray,
  curves: NumArray[],
  toRelativeX: (val: number) => number, // to [0, 1]
  toRelativeY: (val: number) => number,
  box: LegendBox = CORNER_BOX,
  obstacles: LegendObstacle[] = [],
): string {
  const rects = LEGEND_CORNERS.map((corner) => getCornerRect(corner, box));
  const counts = [0, 0, 0, 0];
  const xs = Array.from(abscissas, toRelativeX);

  // A covered reference line weighs as a tenth of the curve points (at least 10); a band more
  const weight = Math.max(10, (abscissas.length * curves.length) / 10);
  for (const obstacle of obstacles) {
    const toRelative = obstacle.axis === 'x' ? toRelativeX : toRelativeY;
    for (const [k, rect] of rects.entries()) {
      counts[k] += weight * getObstacleCover(obstacle, rect, toRelative);
    }
  }

  for (const ordinates of curves) {
    let prev: [number, number] | undefined;
    for (const [i, val] of ordinates.entries()) {
      const pt: [number, number] = [xs[i], toRelativeY(val)];
      if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) {
        prev = undefined; // gap in the curve
        continue;
      }
      for (const [k, rect] of rects.entries()) {
        const isIn =
          pt[0] >= rect.x0 &&
          pt[0] <= rect.x1 &&
          pt[1] >= rect.y0 &&
          pt[1] <= rect.y1;
        counts[k] +=
          (isIn ? 1 : 0) + (prev && crossesRect(prev, pt, rect) ? 1 : 0);
      }
      prev = pt;
    }
  }
  return LEGEND_CORNERS[counts.indexOf(Math.min(...counts))];
}
