import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { formatNumber } from '@h5web/shared/vis-utils';
import { type BoostMath, type Distribution } from 'boost-math-wasm';

/* eslint-disable new-cap -- Boost.Math's distribution names */

export const QQ_DISTRIBUTIONS = [
  'normal',
  'lognormal',
  'exponential',
  'uniform',
  'logistic',
  'gumbel',
] as const;
export type QQDistribution = (typeof QQ_DISTRIBUTIONS)[number];

const MAX_POINTS = 2000; // beyond, `SUBSAMPLE` evenly spaced quantiles of the data
const SUBSAMPLE = 1000;
const BAND = [0.025, 0.975]; // pointwise 95%

/* Finite and not invalid (`_FillValue`, out of `valid_range`, ...) */
export function isValidValue(val: number, ignoreValue?: IgnoreValue): boolean {
  return Number.isFinite(val) && !ignoreValue?.(val);
}

/* Why the Q-Q plot of a slice can't be shown, if it can't (one pass, no copy) */
export function getQQBlocker(
  array: NumArray,
  distribution: QQDistribution,
  ignoreValue?: IgnoreValue,
): string | undefined {
  let count = 0;
  let hasNonPositive = false;
  for (const val of array) {
    if (isValidValue(val, ignoreValue)) {
      count += 1;
      hasNonPositive = hasNonPositive || val <= 0;
    }
  }
  if (count < 3) {
    return 'Q-Q: needs at least 3 finite, valid values';
  }
  if (distribution === 'lognormal' && hasNonPositive) {
    return 'Q-Q (lognormal): needs positive values';
  }
  return undefined;
}

/* Ranks (1-based) of the order statistics plotted: all of them, or evenly spaced fractional ranks
 * whose plotting positions (r − ½)/n are (j − ½)/m */
export function getPlottingRanks(n: number): Float64Array {
  const m = n > MAX_POINTS ? SUBSAMPLE : n;
  return Float64Array.from({ length: m }, (_, j) => (n * (j + 0.5)) / m + 0.5);
}

/* Sorted values at fractional ranks, interpolated linearly */
export function getOrderStatistics(
  sorted: Float64Array,
  ranks: Float64Array,
): Float64Array {
  return ranks.map((r) => {
    const lo = Math.floor(r - 1);
    const t = r - 1 - lo;
    return t === 0 ? sorted[lo] : sorted[lo] * (1 - t) + sorted[lo + 1] * t;
  });
}

/* The standard distribution of the family (lognormal: normal, of the logs of the data) */
function getStandard(bm: BoostMath, dist: QQDistribution): Distribution {
  if (dist === 'exponential') {
    return new bm.exponential_distribution(1);
  }
  if (dist === 'uniform') {
    return new bm.uniform_distribution(0, 1);
  }
  if (dist === 'logistic') {
    return new bm.logistic_distribution(0, 1);
  }
  if (dist === 'gumbel') {
    return new bm.extreme_value_distribution(0, 1);
  }
  return new bm.normal_distribution(0, 1); // also of the logs, for the lognormal
}

/* y ≈ location + scale x, least squares */
export function fitLine(
  bm: BoostMath,
  x: Float64Array,
  y: Float64Array,
): { location: number; scale: number } {
  const { intercept, slope } = bm.simple_ordinary_least_squares(x, y);
  return { location: intercept, scale: slope };
}

export interface QQPlot {
  theoretical: Float64Array; // standard quantiles at the plotting positions
  ordered: Float64Array; // order statistics of the data (of its logs for the lognormal)
  line: Float64Array; // fitted line at `theoretical`
  lower: Float64Array; // pointwise 95% band, through the fitted line
  upper: Float64Array;
  location: number;
  scale: number;
  dropped: number; // values that are not finite, or invalid
}

export function getQQPlot(
  bm: BoostMath,
  array: NumArray,
  distribution: QQDistribution,
  ignoreValue?: IgnoreValue,
): QQPlot {
  const finite = Float64Array.from(
    array.filter((val) => isValidValue(val, ignoreValue)),
  );
  const values = distribution === 'lognormal' ? finite.map(Math.log) : finite;
  const sorted = values.sort();
  const n = sorted.length;
  const ranks = getPlottingRanks(n);

  // The r-th order statistic of n uniforms is Beta(r, n − r + 1)
  const [lowerPs, upperPs] = BAND.map((p) =>
    ranks.map((r) => bm.ibeta_inv(r, n - r + 1, p)),
  );
  const dist = getStandard(bm, distribution);
  const theoretical = dist.quantile_array(ranks.map((r) => (r - 0.5) / n));
  const lowerX = dist.quantile_array(lowerPs);
  const upperX = dist.quantile_array(upperPs);
  dist.delete(); // nothing throws for bad values

  const ordered = getOrderStatistics(sorted, ranks);
  // The exponential's scale is the mean of all values (maximum likelihood, through the origin), as
  // least squares is pulled by the long tail
  const { location, scale } =
    distribution === 'exponential'
      ? { location: 0, scale: sorted.reduce((sum, v) => sum + v, 0) / n }
      : fitLine(bm, theoretical, ordered);
  function onLine(q: number): number {
    return location + scale * q;
  }
  const [lower, upper] = [lowerX.map(onLine), upperX.map(onLine)];

  return {
    theoretical,
    ordered,
    line: theoretical.map(onLine),
    lower: lower.map((v, i) => Math.min(v, upper[i])), // ordered even if scale < 0
    upper: upper.map((v, i) => Math.max(v, lower[i])),
    location,
    scale,
    dropped: array.length - n,
  };
}

/* Parameters of the fitted distribution, e.g. `μ = 1.2, σ = 0.31` */
export function formatQQFit(
  distribution: QQDistribution,
  location: number,
  scale: number,
): string {
  const [loc, sc] = [location, scale].map((val) => formatNumber(val, 3));
  if (distribution === 'exponential') {
    return `λ = ${formatNumber(1 / scale, 3)}`;
  }
  if (distribution === 'uniform') {
    return `a = ${loc}, b = ${formatNumber(location + scale, 3)}`;
  }
  if (distribution === 'logistic') {
    return `μ = ${loc}, s = ${sc}`;
  }
  if (distribution === 'gumbel') {
    return `μ = ${loc}, β = ${sc}`;
  }
  return `μ = ${loc}, σ = ${sc}`; // normal, or of the logs for the lognormal
}
