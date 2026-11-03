import { type BoostMath } from 'boost-math-wasm';
import { assert, expect, test } from 'vitest';

import {
  formatQQFit,
  getOrderStatistics,
  getPlottingRanks,
  getQQBlocker,
  getQQPlot,
} from './qq';
import { getBoostMath } from './spectrum';

async function loadBoostMath(): Promise<BoostMath> {
  const bm = await getBoostMath();
  assert(!(bm instanceof Error));
  return bm;
}

/* Deterministic, evenly spread uniforms in (0, 1) (golden-ratio sequence) */
function uniforms(n: number, seed = 0.5): Float64Array {
  return Float64Array.from({ length: n }, (_, i) => (seed + i * 0.618_034) % 1);
}

test('plotting positions (i − ½)/n, or 1000 evenly spaced quantiles past 2000', () => {
  const ranks = getPlottingRanks(4);
  expect(ranks).toEqual(Float64Array.from([1, 2, 3, 4]));
  expect(ranks.map((r) => (r - 0.5) / 4)).toEqual(
    Float64Array.from([0.125, 0.375, 0.625, 0.875]),
  );
  expect(getPlottingRanks(2000)).toHaveLength(2000);

  const many = getPlottingRanks(10_000);
  expect(many).toHaveLength(1000);
  expect((many[0] - 0.5) / 10_000).toBeCloseTo(0.0005); // (j − ½)/m
  expect((many[999] - 0.5) / 10_000).toBeCloseTo(0.9995);

  const sorted = Float64Array.from({ length: 10_000 }, (_, i) => i);
  expect(getOrderStatistics(sorted, many)[0]).toBeCloseTo(4.5); // between ranks 5 and 6
});

test('fit recovers μ and σ of normal data, and the band is ordered', async () => {
  const bm = await loadBoostMath();
  const std = new bm.normal_distribution(2, 0.5); // eslint-disable-line new-cap
  const data = std.quantile_array(uniforms(5000));
  std.delete();

  const qq = getQQPlot(bm, [...data, Number.NaN], 'normal');
  expect(qq.theoretical).toHaveLength(1000);
  expect(qq.dropped).toBe(1);
  expect(qq.location).toBeCloseTo(2, 1);
  expect(qq.scale).toBeCloseTo(0.5, 1);
  expect(qq.lower.every((v, i) => v < qq.upper[i])).toBe(true);
  expect(qq.lower.every((v, i) => v < qq.line[i])).toBe(true);
  expect(qq.upper.every((v, i) => v > qq.line[i])).toBe(true);
  expect(formatQQFit('normal', qq.location, qq.scale)).toMatch(
    /^μ = 2(\.\d+)?, σ = 0\.\d+$/u,
  );
});

test('exponential fit is the mean, through the origin', async () => {
  const bm = await loadBoostMath();
  const data = uniforms(500, 0.3).map((u) => -3 * Math.log(1 - u)); // scale 3
  const qq = getQQPlot(bm, data, 'exponential');
  expect(qq.location).toBe(0);
  expect(qq.scale).toBeCloseTo(data.reduce((a, b) => a + b) / data.length, 12);
  expect(formatQQFit('exponential', 0, 2)).toBe('λ = 0.5');

  // Mean of all values, not of the 1000 plotted order statistics
  const outlier = [...Array.from({ length: 9999 }, () => 1), 1e6];
  expect(getQQPlot(bm, outlier, 'exponential').scale).toBeCloseTo(100.9999, 9);
});

test('invalid values are dropped like values that are not finite', async () => {
  const bm = await loadBoostMath();
  const values = [1, -9, 2, Number.NaN, 3, 4];
  const qq = getQQPlot(bm, values, 'normal', (val) => val === -9); // fill value
  expect(qq.dropped).toBe(2);
  expect(qq.ordered).toEqual(Float64Array.from([1, 2, 3, 4]));
});

test('no Q-Q plot of too few valid values, or lognormal of values ≤ 0', () => {
  expect(getQQBlocker([1, 2, 3], 'normal')).toBeUndefined();
  expect(getQQBlocker([1, 2, Number.NaN], 'normal')).toBeDefined();
  expect(getQQBlocker([1, 2, 3], 'normal', (val) => val === 3)).toBeDefined();
  expect(getQQBlocker([1, 2, 3], 'lognormal')).toBeUndefined();
  expect(getQQBlocker([1, 0, 3], 'lognormal')).toMatch('positive');
  expect(
    getQQBlocker([1, 0, 2, 3], 'lognormal', (val) => val === 0),
  ).toBeUndefined();
});
