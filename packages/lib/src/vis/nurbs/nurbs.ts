import { type NumArray } from '@h5web/shared/vis-models';

/* Algorithms A2.1, A2.2 and A4.1 of Piegl & Tiller, "The NURBS Book" (1997) */

export interface NurbsCurve {
  degree: number;
  dims: number; // 2 or 3
  points: NumArray; // control points, `n × dims` row-major
  weights: NumArray; // `n`, all positive
  knots: NumArray; // `n + degree + 1`, non-decreasing
}

export interface KnotSpan {
  index: number; // `k` such that `knots[k] <= u < knots[k + 1]`
  start: number; // `knots[k]`
  end: number; // `knots[k + 1]`
}

const MAX_ERROR_PX = 0.25; // largest distance between chords and curve, in pixels
const MAX_SEGMENTS_PER_SPAN = 4096;
const MAX_SEGMENTS = 2 ** 20; // in all, to bound memory of very long curves

/* Why the curve can't be drawn, if it can't */
export function getNurbsError(curve: NurbsCurve): string | undefined {
  const { degree, dims, points, weights, knots } = curve;
  const count = points.length / dims;

  if (!Number.isInteger(degree) || degree < 1) {
    return `Degree must be a positive integer (got ${degree})`;
  }
  if (!Number.isInteger(count) || count < degree + 1) {
    return `Expected at least ${degree + 1} control points for degree ${degree}`;
  }
  if (!points.every(Number.isFinite)) {
    return 'Control points must be finite';
  }
  if (weights.length !== count) {
    return `Expected ${count} weights (one per control point), got ${weights.length}`;
  }
  if (!weights.every((w) => Number.isFinite(w) && w > 0)) {
    return 'Weights must be positive';
  }
  if (knots.length !== count + degree + 1) {
    return `Expected ${count + degree + 1} knots (control points + degree + 1), got ${knots.length}`;
  }
  if (!knots.every(Number.isFinite)) {
    return 'Knots must be finite';
  }
  if (knots.some((u, i) => i > 0 && u < knots[i - 1])) {
    return 'Knots must be non-decreasing';
  }
  if (knots[degree] >= knots[count]) {
    return `Knots must increase between knots ${degree} and ${count} (the curve's domain)`;
  }

  // Beyond `degree` repeats, the curve breaks apart
  for (let i = degree + 1; i < count; i += 1) {
    if (knots[i] === knots[i + degree]) {
      return `Interior knot ${knots[i]} is repeated more than ${degree} times`;
    }
  }

  return undefined;
}

/* Spans of the curve's domain `[knots[degree], knots[n]]` that aren't empty */
export function getKnotSpans(curve: NurbsCurve): KnotSpan[] {
  const { degree, knots } = curve;
  const count = knots.length - degree - 1;

  const spans: KnotSpan[] = [];
  for (let k = degree; k < count; k += 1) {
    if (knots[k] < knots[k + 1]) {
      spans.push({ index: k, start: knots[k], end: knots[k + 1] });
    }
  }
  return spans;
}

/* A2.1: knot span of `u`, the last non-empty one at the end of the domain */
export function findSpan(curve: NurbsCurve, u: number): number {
  const { degree, knots } = curve;
  const count = knots.length - degree - 1;

  if (u >= knots[count]) {
    let k = count - 1;
    while (knots[k] === knots[k + 1]) {
      k -= 1;
    }
    return k;
  }
  if (u <= knots[degree]) {
    let k = degree;
    while (knots[k] === knots[k + 1]) {
      k += 1;
    }
    return k;
  }

  let low = degree;
  let high = count;
  let mid = Math.floor((low + high) / 2);
  while (u < knots[mid] || u >= knots[mid + 1]) {
    if (u < knots[mid]) {
      high = mid;
    } else {
      low = mid;
    }
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}

/* A2.2: the `degree + 1` B-spline basis functions that don't vanish on span `k`, at `u` */
export function getBasisFunctions(
  curve: NurbsCurve,
  k: number,
  u: number,
): Float64Array {
  const { degree, knots } = curve;
  const basis = new Float64Array(degree + 1);
  const left = new Float64Array(degree + 1);
  const right = new Float64Array(degree + 1);

  basis[0] = 1;
  for (let j = 1; j <= degree; j += 1) {
    left[j] = u - knots[k + 1 - j];
    right[j] = knots[k + j] - u;
    let saved = 0;
    for (let r = 0; r < j; r += 1) {
      const temp = basis[r] / (right[r + 1] + left[j - r]);
      basis[r] = saved + right[r + 1] * temp;
      saved = left[j - r] * temp;
    }
    basis[j] = saved;
  }
  return basis;
}

/* A4.1: point of the curve at `u`, from the basis of span `k` (default: span of `u`) */
export function evaluateNurbs(
  curve: NurbsCurve,
  u: number,
  k = findSpan(curve, u),
): number[] {
  const { degree, dims, points, weights } = curve;
  const basis = getBasisFunctions(curve, k, u);

  const point = Array.from({ length: dims }, () => 0);
  let weight = 0;
  for (let j = 0; j <= degree; j += 1) {
    const i = k - degree + j;
    const nw = basis[j] * weights[i];
    for (let d = 0; d < dims; d += 1) {
      point[d] += nw * points[i * dims + d];
    }
    weight += nw;
  }
  return point.map((val) => val / weight);
}

/*
 * Number of chords drawn per span, so they stay within `MAX_ERROR_PX` of the curve. An arc of
 * length `L` turning by `θ` is within `L θ / 8n²` of `n` chords of it (circle: `r θ² / 8n²`).
 * The span's control points (on screen) bound both: the curve is no longer than their polygon
 * and turns no more. Rational curves may bunch up chords where the weights change, by up to
 * the ratio of the weights.
 */
export function getSegmentCounts(
  curve: NurbsCurve,
  spans: KnotSpan[],
  pixelsPerUnit: number[], // along each dimension
): Uint32Array {
  const { degree, dims, points, weights } = curve;

  const counts = Float64Array.from(spans, ({ index: k }) => {
    let length = 0;
    let turning = 0;
    let prevEdge: number[] | undefined;
    let minWeight = weights[k];
    let maxWeight = weights[k];

    for (let i = k - degree + 1; i <= k; i += 1) {
      const edge = pixelsPerUnit.map(
        (ppu, d) => ppu * (points[i * dims + d] - points[(i - 1) * dims + d]),
      );
      const edgeLength = Math.hypot(...edge);
      const prev = prevEdge;
      if (prev && edgeLength > 0) {
        const dot = edge.reduce((acc, val, d) => acc + val * prev[d], 0);
        const cos = dot / (edgeLength * Math.hypot(...prev));
        turning += Math.acos(Math.min(Math.max(cos, -1), 1));
      }
      if (edgeLength > 0) {
        prevEdge = edge;
      }
      length += edgeLength;
      minWeight = Math.min(minWeight, weights[i - 1]);
      maxWeight = Math.max(maxWeight, weights[i - 1]);
    }

    return Math.sqrt(
      (length * turning * maxWeight) / minWeight / (8 * MAX_ERROR_PX),
    );
  });

  const total = counts.reduce((acc, n) => acc + Math.ceil(n), 0);
  const factor = Math.min(MAX_SEGMENTS / total, 1);
  return Uint32Array.from(
    counts,
    (n) => Math.min(Math.ceil(n * factor) || 1, MAX_SEGMENTS_PER_SPAN), // at least 1, e.g. if `NaN`
  );
}

/* Points at `counts[s]` even steps of each span `s`, then the end of the curve: `dims` per point */
export function sampleNurbs(
  curve: NurbsCurve,
  spans: KnotSpan[],
  counts: Uint32Array,
): Float64Array {
  const { dims } = curve;
  const total = counts.reduce((acc, n) => acc + n, 1);

  const samples = new Float64Array(total * dims);
  let offset = 0;
  spans.forEach(({ index, start, end }, s) => {
    const steps = s === spans.length - 1 ? counts[s] + 1 : counts[s];
    for (let j = 0; j < steps; j += 1) {
      const u = start + ((end - start) * j) / counts[s];
      samples.set(evaluateNurbs(curve, u, index), offset);
      offset += dims;
    }
  });
  return samples;
}
