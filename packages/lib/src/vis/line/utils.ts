import { type NumArray } from '@h5web/shared/vis-models';
import { type ThreeEvent } from '@react-three/fiber';
import { range } from 'd3-array';
import { useMemo } from 'react';

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

/* Corner of the plot whose legend box covers the fewest curve points and segments (top right if
 * several) */
export function getLegendCorner(
  abscissas: NumArray,
  curves: NumArray[],
  toRelativeX: (val: number) => number, // to [0, 1]
  toRelativeY: (val: number) => number,
  box: LegendBox = CORNER_BOX,
): string {
  const rects = LEGEND_CORNERS.map((corner) => getCornerRect(corner, box));
  const counts = [0, 0, 0, 0];
  const xs = Array.from(abscissas, toRelativeX);

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
