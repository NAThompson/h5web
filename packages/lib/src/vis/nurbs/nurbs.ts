import { type NumArray } from '@h5web/shared/vis-models';

/* Algorithms A2.1-A2.3, A3.5, A4.1 and A4.4 (first derivatives) of Piegl & Tiller, "The NURBS Book" (1997) */

export interface NurbsCurve {
  degree: number;
  dims: number; // 2 or 3
  points: NumArray; // control points, `n × dims` row-major
  weights: NumArray; // `n`, all positive
  knots: NumArray; // `n + degree + 1`, non-decreasing
}

/* Degree and knots along one direction of a curve or surface */
export type KnotVector = Pick<NurbsCurve, 'degree' | 'knots'>;

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

  if (!points.every(Number.isFinite)) {
    return 'Control points must be finite';
  }
  return getKnotsError(degree, count, knots) ?? getWeightsError(weights, count);
}

/* Why `degree` and `knots` don't fit `count` control points along a direction (e.g. `u`) */
function getKnotsError(
  degree: number,
  count: number,
  knots: NumArray,
  along = '',
): string | undefined {
  if (!Number.isInteger(degree) || degree < 1) {
    return `Degree${along} must be a positive integer (got ${degree})`;
  }
  if (!Number.isInteger(count) || count < degree + 1) {
    return `Expected at least ${degree + 1} control points${along} for degree ${degree}`;
  }
  if (knots.length !== count + degree + 1) {
    return `Expected ${count + degree + 1} knots${along} (control points + degree + 1), got ${knots.length}`;
  }
  if (!knots.every(Number.isFinite)) {
    return `Knots${along} must be finite`;
  }
  if (knots.some((u, i) => i > 0 && u < knots[i - 1])) {
    return `Knots${along} must be non-decreasing`;
  }
  if (knots[degree] >= knots[count]) {
    return `Knots${along} must increase between knots ${degree} and ${count} (the domain)`;
  }

  // Beyond `degree` repeats, the curve breaks apart
  for (let i = degree + 1; i < count; i += 1) {
    if (knots[i] === knots[i + degree]) {
      return `Interior knot ${knots[i]}${along} is repeated more than ${degree} times`;
    }
  }

  return undefined;
}

function getWeightsError(weights: NumArray, count: number): string | undefined {
  if (weights.length !== count) {
    return `Expected ${count} weights (one per control point), got ${weights.length}`;
  }
  if (!weights.every((w) => Number.isFinite(w) && w > 0)) {
    return 'Weights must be positive';
  }
  return undefined;
}

/* Spans of the curve's domain `[knots[degree], knots[n]]` that aren't empty */
export function getKnotSpans(curve: KnotVector): KnotSpan[] {
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
export function findSpan(curve: KnotVector, u: number): number {
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
  curve: KnotVector,
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
  maxError = MAX_ERROR_PX,
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
      (length * turning * maxWeight) / minWeight / (8 * maxError),
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

/*
 * Basis functions `N(i,p)` of all `n` control points at each of `params` (in knot spans
 * `spans`, cf. `getSpanSteps`): `n` arrays, zero outside `[knots[i], knots[i + p + 1]]`. With
 * `weights`, rational basis functions `R(i,p) = w(i) N(i,p) / Σ w(j) N(j,p)` instead.
 */
export function sampleBasis(
  vector: KnotVector,
  steps: { params: NumArray; spans: Uint32Array },
  weights?: NumArray,
): Float64Array[] {
  const { degree, knots } = vector;
  const { params, spans } = steps;
  const count = knots.length - degree - 1;
  const values = Array.from(
    { length: count },
    () => new Float64Array(params.length),
  );

  params.forEach((u, s) => {
    const k = spans[s];
    const basis = getBasisFunctions(vector, k, u);
    if (weights) {
      basis.forEach((val, j) => {
        basis[j] = val * weights[k - degree + j];
      });
    }
    const sum = weights ? basis.reduce((acc, val) => acc + val, 0) : 1;
    basis.forEach((val, j) => {
      values[k - degree + j][s] = val / sum;
    });
  });
  return values;
}

export interface NurbsSurface {
  degrees: [number, number]; // along `u` and `v`
  shape: [number, number]; // `nu × nv` control points
  points: NumArray; // `nu × nv × 3` row-major
  weights: NumArray; // `nu × nv`, all positive
  knots: [NumArray, NumArray]; // `nu + degree_u + 1` and `nv + degree_v + 1`, non-decreasing
}

export interface SurfacePoint {
  point: number[];
  du: number[]; // partial derivatives
  dv: number[];
  normal: number[]; // unit, along `du × dv` (`[0, 0, 0]` if it can't be told)
}

const MAX_SURFACE_ERROR_PX = 0.5; // shading hides smaller facets
const MAX_SAMPLES_PER_SPAN = 256;
const MAX_SURFACE_VERTICES = 2 ** 20;
const NORMAL_NUDGE = 1e-6; // fraction of span, cf. `evaluateNurbsSurface`

/* Degree and knots along `u` and `v` */
export function getKnotVectors(
  surface: NurbsSurface,
): [KnotVector, KnotVector] {
  const { degrees, knots } = surface;
  return [
    { degree: degrees[0], knots: knots[0] },
    { degree: degrees[1], knots: knots[1] },
  ];
}

/* Why the surface can't be drawn, if it can't */
export function getNurbsSurfaceError(
  surface: NurbsSurface,
): string | undefined {
  const { degrees, shape, points, weights, knots } = surface;
  const [nu, nv] = shape;

  if (points.length !== nu * nv * 3) {
    return `Expected ${nu} × ${nv} × 3 control point coordinates, got ${points.length}`;
  }
  if (!points.every(Number.isFinite)) {
    return 'Control points must be finite';
  }
  return (
    getKnotsError(degrees[0], nu, knots[0], ' along u') ??
    getKnotsError(degrees[1], nv, knots[1], ' along v') ??
    getWeightsError(weights, nu * nv)
  );
}

/* A2.3 (first derivatives): basis functions of span `k` at `u` and their derivatives, from
 * those of degree `p - 1`: `N'(i,p) = p N(i,p-1) / (u(i+p) - u(i)) - p N(i+1,p-1) / (u(i+p+1) - u(i+1))` */
export function getBasisDerivatives(
  vector: KnotVector,
  k: number,
  u: number,
): [Float64Array, Float64Array] {
  const { degree: p, knots } = vector;
  const basis = getBasisFunctions(vector, k, u);
  const lower =
    p > 1
      ? getBasisFunctions({ degree: p - 1, knots }, k, u)
      : Float64Array.of(1);

  const ders = Float64Array.from({ length: p + 1 }, (_, r) => {
    const left = r > 0 ? lower[r - 1] / (knots[k + r] - knots[k - p + r]) : 0;
    const right =
      r < p ? lower[r] / (knots[k + r + 1] - knots[k - p + r + 1]) : 0;
    return p * (left - right);
  });
  return [basis, ders];
}

/*
 * A3.5 + A4.4: point of the surface at `(u, v)` and its first partial derivatives, from the
 * homogeneous point `A(u, v), w(u, v)`: `S = A / w`, `S_u = (A_u - w_u S) / w`. Where they are
 * parallel or vanish (e.g. at the poles of a sphere), the normal is that a hair inside the span.
 */
export function evaluateNurbsSurface(
  surface: NurbsSurface,
  u: number,
  v: number,
  spans?: [number, number],
): SurfacePoint {
  const [vecU, vecV] = getKnotVectors(surface);
  const [ku, kv] = spans ?? [findSpan(vecU, u), findSpan(vecV, v)];
  const result = evaluateDerivatives(surface, u, v, ku, kv);

  if (result.normal.every((val) => val === 0)) {
    const [uMid, vMid] = [
      (vecU.knots[ku] + vecU.knots[ku + 1]) / 2,
      (vecV.knots[kv] + vecV.knots[kv + 1]) / 2,
    ];
    const { normal } = evaluateDerivatives(
      surface,
      u + (uMid - u) * NORMAL_NUDGE,
      v + (vMid - v) * NORMAL_NUDGE,
      ku,
      kv,
    );
    return { ...result, normal };
  }
  return result;
}

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((acc, val, i) => acc + val * b[i], 0);
}

function evaluateDerivatives(
  surface: NurbsSurface,
  u: number,
  v: number,
  ku: number,
  kv: number,
): SurfacePoint {
  const { degrees, shape, points, weights } = surface;
  const [vecU, vecV] = getKnotVectors(surface);
  const [nu, dnu] = getBasisDerivatives(vecU, ku, u);
  const [nv, dnv] = getBasisDerivatives(vecV, kv, v);
  const [pu, pv] = degrees;

  // Homogeneous `(x w, y w, z w, w)` and its derivatives along `u` and `v`
  const a = [0, 0, 0, 0];
  const au = [0, 0, 0, 0];
  const av = [0, 0, 0, 0];
  for (let r = 0; r <= pu; r += 1) {
    for (let c = 0; c <= pv; c += 1) {
      const i = (ku - pu + r) * shape[1] + (kv - pv + c);
      const w = weights[i];
      for (let d = 0; d < 4; d += 1) {
        const val = d < 3 ? points[i * 3 + d] * w : w;
        a[d] += nu[r] * nv[c] * val;
        au[d] += dnu[r] * nv[c] * val;
        av[d] += nu[r] * dnv[c] * val;
      }
    }
  }

  const point = a.slice(0, 3).map((val) => val / a[3]);
  const du = point.map((val, d) => (au[d] - au[3] * val) / a[3]);
  const dv = point.map((val, d) => (av[d] - av[3] * val) / a[3]);
  const cross = [
    du[1] * dv[2] - du[2] * dv[1],
    du[2] * dv[0] - du[0] * dv[2],
    du[0] * dv[1] - du[1] * dv[0],
  ];

  // Parallel or vanishing within rounding errors: no normal
  const length = Math.hypot(...cross);
  const isDegenerate =
    length <= 1e-9 * Math.max(dotProduct(du, du), dotProduct(dv, dv));
  return {
    point,
    du,
    dv,
    normal: isDegenerate ? [0, 0, 0] : cross.map((val) => val / length),
  };
}

/*
 * Number of steps per knot span along `u` and `v`, so that the facets stay within half a pixel
 * of the surface: each row (column) of control points is taken as a curve (cf.
 * `getSegmentCounts`) and the span gets the most steps any row needs. On screen, `points` are
 * projected control points in pixels, and `weights` the weights times clip-space `w`: the
 * perspective projection of a NURBS is the NURBS of those (rows bound the iso-curves between
 * them only roughly, as they are not convex combinations of rows for rational surfaces).
 */
export function getSurfaceSampleCounts(
  surface: NurbsSurface,
  spans: [KnotSpan[], KnotSpan[]],
  points: NumArray, // `nu × nv × dims`, in pixels
  weights: NumArray = surface.weights,
  dims = 3,
): [Uint32Array, Uint32Array] {
  const { degrees, shape, knots } = surface;
  const [nu, nv] = shape;
  const pixelsPerUnit = Array.from({ length: dims }, () => 1);

  const counts = ([0, 1] as const).map((dir) => {
    const [count, rows] = dir === 0 ? [nu, nv] : [nv, nu];
    const max = new Uint32Array(spans[dir].length);
    const rowPoints = new Float64Array(count * dims);
    const rowWeights = new Float64Array(count);

    for (let row = 0; row < rows; row += 1) {
      for (let i = 0; i < count; i += 1) {
        const index = dir === 0 ? i * nv + row : row * nv + i;
        rowWeights[i] = weights[index];
        for (let d = 0; d < dims; d += 1) {
          rowPoints[i * dims + d] = points[index * dims + d];
        }
      }
      const rowCounts = getSegmentCounts(
        {
          degree: degrees[dir],
          dims,
          points: rowPoints,
          weights: rowWeights,
          knots: knots[dir],
        },
        spans[dir],
        pixelsPerUnit,
        MAX_SURFACE_ERROR_PX,
      );
      rowCounts.forEach((n, s) => {
        max[s] = Math.max(max[s], Math.min(n, MAX_SAMPLES_PER_SPAN));
      });
    }
    return max;
  });

  // Fewer steps all over (keeping their ratios), beyond the vertex budget
  const [totalU, totalV] = counts.map((arr) => arr.reduce((a, n) => a + n, 1));
  const factor = Math.sqrt(MAX_SURFACE_VERTICES / (totalU * totalV));
  if (factor >= 1) {
    return [counts[0], counts[1]];
  }
  return [
    counts[0].map((n) => Math.max(Math.floor(n * factor), 1)),
    counts[1].map((n) => Math.max(Math.floor(n * factor), 1)),
  ];
}

/* Parameters at `counts[s]` even steps of each span `s`, then the end of the domain */
export function getSpanSteps(
  spans: KnotSpan[],
  counts: Uint32Array,
): { params: Float64Array; spans: Uint32Array } {
  const total = counts.reduce((acc, n) => acc + n, 1);
  const params = new Float64Array(total);
  const indices = new Uint32Array(total); // knot span of each step
  let offset = 0;
  spans.forEach(({ index, start, end }, s) => {
    const steps = s === spans.length - 1 ? counts[s] + 1 : counts[s];
    for (let j = 0; j < steps; j += 1) {
      params[offset] = start + ((end - start) * j) / counts[s];
      indices[offset] = index;
      offset += 1;
    }
  });
  return { params, spans: indices };
}

/* Points of the surface on the grid of steps of `getSpanSteps` along `u` (rows) and `v` */
export function sampleNurbsSurface(
  surface: NurbsSurface,
  spans: [KnotSpan[], KnotSpan[]],
  counts: [Uint32Array, Uint32Array],
): Float64Array {
  const [stepsU, stepsV] = [0, 1].map((dir) =>
    getSpanSteps(spans[dir], counts[dir]),
  );
  const rows = stepsU.params.length;
  const cols = stepsV.params.length;

  const samples = new Float64Array(rows * cols * 3);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const { point } = evaluateDerivatives(
        surface,
        stepsU.params[r],
        stepsV.params[c],
        stepsU.spans[r],
        stepsV.spans[c],
      );
      samples.set(point, (r * cols + c) * 3);
    }
  }
  return samples;
}
