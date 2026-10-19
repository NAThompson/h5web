import { type Domain, type NumArray } from '@h5web/shared/vis-models';

import {
  findSpan,
  getBasisDerivatives,
  getKnotVectors,
  type NurbsSurface,
} from './nurbs';

/* What a NURBS surface is coloured by: height, a stored field (same basis as the geometry), or
 * quantities derived from the surface's first and second derivatives */
export enum NurbsColorBy {
  Height = 'height',
  Field = 'field',
  FieldGradient = 'field-gradient', // |∇_S f|
  HeightGradient = 'height-gradient', // |∇_S z|
  GaussianCurvature = 'gaussian-curvature', // K
  MeanCurvature = 'mean-curvature', // H, of normal `S_u × S_v`
}

/* Mode of the compute shader (cf. `webgpuSurface.ts`) */
export const COLOR_BY_MODES: Record<NurbsColorBy, number> = {
  [NurbsColorBy.Height]: 0,
  [NurbsColorBy.Field]: 1,
  [NurbsColorBy.FieldGradient]: 2,
  [NurbsColorBy.HeightGradient]: 3,
  [NurbsColorBy.GaussianCurvature]: 4,
  [NurbsColorBy.MeanCurvature]: 5,
};

/* Relative size of `|S_u × S_v|²` below which the metric is degenerate (e.g. at poles):
 * curvatures and gradients are `NaN` there */
export const DEGENERATE_METRIC = 1e-6;

const ROBUST_QUANTILE = 0.02; // derived quantities spike near degenerate points

export type SurfaceAnalysis = Record<NurbsColorBy, number>;

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/*
 * Everything a NURBS surface can be coloured by at `(u, v)`, as the compute shader evaluates it
 * (in `f64`, as reference): A4.4 up to second derivatives of `S = A / w`, then the fundamental
 * forms `E, F, G` and `L, M, N`: `K = (LN − M²) / (EG − F²)`, `H = (EN − 2FM + GL) / 2(EG − F²)`;
 * `f = Σ N_i N_j w_ij f_ij / w` and `|∇_S f|² = (G f_u² − 2F f_u f_v + E f_v²) / (EG − F²)`.
 */
export function evaluateSurfaceAnalysis(
  surface: NurbsSurface,
  u: number,
  v: number,
  field?: NumArray, // `nu × nv` control values
): SurfaceAnalysis {
  const { degrees, shape, points, weights } = surface;
  const [vecU, vecV] = getKnotVectors(surface);
  const [ku, kv] = [findSpan(vecU, u), findSpan(vecV, v)];
  const bu = getBasisDerivatives(vecU, ku, u);
  const bv = getBasisDerivatives(vecV, kv, v);
  const [pu, pv] = degrees;

  // Homogeneous `(x w, y w, z w, w)` and its derivatives: `[u order][v order]`, then field `f w`
  const a = [0, 1, 2].map(() => [0, 1, 2].map(() => [0, 0, 0, 0]));
  const fw = [0, 0, 0]; // `F`, `F_u`, `F_v`
  for (let r = 0; r <= pu; r += 1) {
    for (let c = 0; c <= pv; c += 1) {
      const i = (ku - pu + r) * shape[1] + (kv - pv + c);
      const w = weights[i];
      const hom = [
        points[i * 3] * w,
        points[i * 3 + 1] * w,
        points[i * 3 + 2] * w,
        w,
      ];
      for (const [du, dv] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [2, 0],
        [1, 1],
        [0, 2],
      ]) {
        const n = bu[du][r] * bv[dv][c];
        hom.forEach((val, d) => {
          a[du][dv][d] += n * val;
        });
      }
      if (field) {
        fw[0] += bu[0][r] * bv[0][c] * field[i] * w;
        fw[1] += bu[1][r] * bv[0][c] * field[i] * w;
        fw[2] += bu[0][r] * bv[1][c] * field[i] * w;
      }
    }
  }

  const [w, wu, wv, wuu, wuv, wvv] = [
    a[0][0][3],
    a[1][0][3],
    a[0][1][3],
    a[2][0][3],
    a[1][1][3],
    a[0][2][3],
  ];
  const s = [0, 1, 2].map((d) => a[0][0][d] / w);
  const su = s.map((val, d) => (a[1][0][d] - wu * val) / w);
  const sv = s.map((val, d) => (a[0][1][d] - wv * val) / w);
  const suu = s.map((val, d) => (a[2][0][d] - 2 * wu * su[d] - wuu * val) / w);
  const svv = s.map((val, d) => (a[0][2][d] - 2 * wv * sv[d] - wvv * val) / w);
  const suv = s.map(
    (val, d) => (a[1][1][d] - wu * sv[d] - wv * su[d] - wuv * val) / w,
  );

  const [e, f, g] = [dot(su, su), dot(su, sv), dot(sv, sv)];
  const normal = cross(su, sv);
  const det = dot(normal, normal); // `EG − F²`
  const isDegenerate = det <= DEGENERATE_METRIC * Math.max(e, g) ** 2;
  const unit = normal.map((val) => val / Math.sqrt(det));
  const [l, m, n] = [suu, suv, svv].map((der) => dot(der, unit));

  const fieldValue = fw[0] / w;
  const [fu, fv] = [
    (fw[1] - wu * fieldValue) / w,
    (fw[2] - wv * fieldValue) / w,
  ];
  function gradient(du: number, dv: number): number {
    return isDegenerate
      ? Number.NaN
      : Math.sqrt(
          Math.max(g * du * du - 2 * f * du * dv + e * dv * dv, 0) / det,
        );
  }

  return {
    [NurbsColorBy.Height]: s[2],
    [NurbsColorBy.Field]: field ? fieldValue : Number.NaN,
    [NurbsColorBy.FieldGradient]: field ? gradient(fu, fv) : Number.NaN,
    [NurbsColorBy.HeightGradient]: gradient(su[2], sv[2]),
    [NurbsColorBy.GaussianCurvature]: isDegenerate
      ? Number.NaN
      : (l * n - m * m) / det,
    [NurbsColorBy.MeanCurvature]: isDegenerate
      ? Number.NaN
      : (e * n - 2 * f * m + g * l) / (2 * det),
  };
}

/*
 * Colour domain of values read back from the GPU (`NaN` where they can't be told): extent of
 * heights and stored fields; 2nd to 98th percentiles of derived quantities, by surface area
 * (`areas` of the values, default: equal), as they spike near degenerate points and small
 * features (e.g. the teapot's knob); symmetric around 0 for Gaussian curvature, whose sign tells
 * elliptic from hyperbolic regions.
 */
export function getColorByDomain(
  values: NumArray,
  colorBy: NurbsColorBy,
  areas?: NumArray,
): Domain {
  const indices = [...values.keys()]
    .filter((i) => Number.isFinite(values[i]))
    .sort((a, b) => values[a] - values[b]);
  if (indices.length === 0) {
    return [-0.5, 0.5];
  }

  const isRobust =
    colorBy !== NurbsColorBy.Height && colorBy !== NurbsColorBy.Field;
  const q = isRobust ? ROBUST_QUANTILE : 0;
  const weights = indices.map((i) => Math.max(areas?.[i] ?? 1, 0));
  const total = weights.reduce((acc, val) => acc + val, 0);

  // First values at which the cumulated area exceeds `q` and reaches `1 - q` of the total
  let sum = 0;
  let min = values[indices[0]];
  let max = values[indices.at(-1) ?? 0];
  let isMinFound = q === 0;
  for (const [k, i] of indices.entries()) {
    sum += weights[k];
    if (!isMinFound && sum > q * total) {
      min = values[i];
      isMinFound = true;
    }
    if (q > 0 && sum >= (1 - q) * total) {
      max = values[i];
      break;
    }
  }

  if (colorBy === NurbsColorBy.GaussianCurvature) {
    const bound = Math.max(Math.abs(min), Math.abs(max));
    return bound > 0 ? [-bound, bound] : [-0.5, 0.5];
  }
  return [min, max];
}
