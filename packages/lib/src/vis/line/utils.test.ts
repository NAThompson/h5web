import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import { type LegendObstacle } from './models';
import {
  getHermiteExtent,
  getLegendCorner,
  getPchipSlopes,
  getSplineDomain,
  getSplineSlopes,
} from './utils';

// Irregularly spaced, non-monotonic data with flat runs
const xs = Float64Array.from({ length: 200 }, (_, i) => i + Math.sin(i) ** 2);
const ys = Float64Array.from(xs, (_, i) => Math.round(4 * Math.sin(i * i)));

describe('getPchipSlopes', () => {
  it('should match SciPy `PchipInterpolator`', () => {
    const slopes = getPchipSlopes([0, 1, 1.5, 4, 5, 7], [0, 2, 1, 1.2, 3, -1]);
    const expected = [14 / 3, 0, 0, 126 / 715, 0, -68 / 15];
    for (const [i, slope] of expected.entries()) {
      expect(slopes[i]).toBeCloseTo(slope, 12);
    }

    // Start slope is clamped to three times the first secant
    const clamped = getPchipSlopes([0, 1, 1.1], [0, 1, 0]);
    expect(clamped[0]).toBeCloseTo(3, 12);
    expect(clamped[2]).toBeCloseTo(-11, 12);
  });

  it.each([
    ['increasing', xs],
    ['decreasing', xs.map((x) => -x)],
    ['back-and-forth', xs.map((x, i) => (i % 3 === 2 ? x - 3 : x))],
  ])(
    'should keep every interval within the range of its end values, with %s abscissas',
    (_, abscissas) => {
      const slopes = getPchipSlopes(abscissas, ys);

      // Fritsch–Carlson sufficient condition: slopes are 0–3 times the secant
      for (let i = 0; i < abscissas.length - 1; i++) {
        const secant = (ys[i + 1] - ys[i]) / (abscissas[i + 1] - abscissas[i]);
        for (const slope of [slopes[i], slopes[i + 1]]) {
          expect(slope * secant).toBeGreaterThanOrEqual(0);
          expect(Math.abs(slope)).toBeLessThanOrEqual(3 * Math.abs(secant));
        }
      }
    },
  );

  it('should not depend on the direction of the data', () => {
    const reversed = getPchipSlopes(xs.toReversed(), ys.toReversed());
    expect(reversed.toReversed()).toStrictEqual(getPchipSlopes(xs, ys));
  });

  it('should treat non-finite values as breaks between independent curves', () => {
    const gap = [...ys.slice(0, 100), Number.NaN, ...ys.slice(101)];
    const slopes = getPchipSlopes(xs, gap);

    expect(slopes.slice(0, 100)).toStrictEqual(
      getPchipSlopes(xs.slice(0, 100), ys.slice(0, 100)),
    );
    expect(slopes.slice(101)).toStrictEqual(
      getPchipSlopes(xs.slice(101), ys.slice(101)),
    );
  });
});

// Second derivatives at the start and end of each interval of a cubic Hermite interpolant
function getCurvatures(
  abscissas: ArrayLike<number>,
  values: ArrayLike<number>,
  slopes: ArrayLike<number>,
): [number, number][] {
  return Array.from({ length: abscissas.length - 1 }, (_, i) => {
    const h = abscissas[i + 1] - abscissas[i];
    const secant = (values[i + 1] - values[i]) / h;
    return [
      (6 * secant - 4 * slopes[i] - 2 * slopes[i + 1]) / h,
      (-6 * secant + 2 * slopes[i] + 4 * slopes[i + 1]) / h,
    ];
  });
}

describe('getSplineSlopes', () => {
  it('should match SciPy `CubicSpline` and MATLAB `spline` (not-a-knot)', () => {
    const slopes = getSplineSlopes([0, 1, 1.5, 4, 5, 7], [0, 2, 1, 1.2, 3, -1]);
    const expected = [225_829, -48_143, -60_060.5, 53_017, 43_342, -219_566];
    for (const [i, slope] of expected.entries()) {
      expect(slopes[i]).toBeCloseTo(slope / 30_525, 10);
    }
  });

  it('should reproduce cubic polynomials exactly', () => {
    const abscissas = [-2, -1.5, 0, 0.3, 1, 2.5, 4];
    const cubic = abscissas.map((x) => x ** 3 - 2 * x ** 2 + 0.5 * x + 1);
    const slopes = getSplineSlopes(abscissas, cubic);
    for (const [i, x] of abscissas.entries()) {
      expect(slopes[i]).toBeCloseTo(3 * x ** 2 - 4 * x + 0.5, 10);
    }
  });

  it.each([
    ['increasing', xs],
    ['decreasing', xs.map((x) => -x)],
  ])(
    'should be twice continuously differentiable, with %s abscissas',
    (_, abscissas) => {
      const curvatures = getCurvatures(
        abscissas,
        ys,
        getSplineSlopes(abscissas, ys),
      );
      for (let i = 1; i < curvatures.length; i++) {
        expect(curvatures[i][0]).toBeCloseTo(curvatures[i - 1][1], 8);
      }
    },
  );

  it('should draw a line through two points and a parabola through three', () => {
    expect([...getSplineSlopes([1, 3], [0, 4])]).toStrictEqual([2, 2]);
    const parabola = getSplineSlopes([0, 1, 3], [1, 0, 4]); // SciPy: [-2, 0, 4]
    expect([...parabola]).toStrictEqual([-2, 0, 4]);
  });

  it('should treat non-finite values and repeated abscissas as breaks between independent curves', () => {
    const gap = [...ys.slice(0, 100), Number.NaN, ...ys.slice(101)];
    const slopes = getSplineSlopes(xs, gap);
    expect(slopes.slice(0, 100)).toStrictEqual(
      getSplineSlopes(xs.slice(0, 100), ys.slice(0, 100)),
    );
    expect(slopes.slice(101)).toStrictEqual(
      getSplineSlopes(xs.slice(101), ys.slice(101)),
    );

    const repeated = getSplineSlopes([0, 1, 2, 2, 3, 5], [0, 1, 0, 3, 4, 2]);
    expect([...repeated]).toStrictEqual([
      ...getSplineSlopes([0, 1, 2], [0, 1, 0]),
      ...getSplineSlopes([2, 3, 5], [3, 4, 2]),
    ]);
  });

  it('should join with slope 0 where abscissas reverse direction', () => {
    const slopes = getSplineSlopes(
      [0, 1, 2, 3, 2.5, 1, 0],
      [0, 1, 0, 1, 3, 2, 0],
    );
    expect(slopes[3]).toBe(0);

    // Each side is a spline, clamped at the reversal
    const curvatures = getCurvatures([0, 1, 2, 3], [0, 1, 0, 1], slopes);
    expect(curvatures[1][0]).toBeCloseTo(curvatures[0][1], 10);
    expect(curvatures[2][0]).toBeCloseTo(curvatures[1][1], 10);
  });

  it('should not depend on the direction of the data', () => {
    const reversed = getSplineSlopes(xs.toReversed(), ys.toReversed());
    const slopes = getSplineSlopes(xs, ys);
    for (const [i, slope] of reversed.toReversed().entries()) {
      expect(slope).toBeCloseTo(slopes[i], 8);
    }
  });
});

describe('getHermiteExtent', () => {
  it('should include extrema between the ends', () => {
    expect(getHermiteExtent(0, 0, 1, -1)).toStrictEqual([0, 0.25]);
    expect(getHermiteExtent(0, 1, 1, 1)).toStrictEqual([0, 1]); // line
    expect(getHermiteExtent(2, 0, 0, 0)).toStrictEqual([0, 2]); // smoothstep
  });
});

describe('getSplineDomain', () => {
  const abscissas = [0, 1, 1.5, 4, 5, 7];
  const ordinates = [0, 2, 1, 1.2, 3, -1];

  it('should include overshoot between points', () => {
    const domain = getSplineDomain(abscissas, ordinates);
    expect(domain?.[0]).toBe(-1);
    expect(domain?.[1]).toBeCloseTo(3.460_103_791_7, 8); // SciPy, sampled finely
  });

  it('should follow the curve as drawn on log scales, and skip ignored values', () => {
    const domain = getSplineDomain(
      [...abscissas, 8],
      [...ordinates.map((y) => 10 ** y), 0], // 0 can't be drawn on a log scale
      ScaleType.Linear,
      ScaleType.Log,
      (val) => val === 10 ** 1.2 || val === 1000,
    );

    // Parabola through first three points, in log space, peaking at `x = 0.875`
    expect(domain?.[0]).toBeCloseTo(0.1, 8);
    expect(domain?.[1]).toBeCloseTo(10 ** (1.75 + (8 / 3) * 0.875 * 0.125), 8);
  });
});

function identity(val: number): number {
  return val;
}

function getCorner(...curves: number[][]): string {
  return getLegendCorner([0, 0.5, 1], curves, identity, identity);
}

describe('getLegendCorner', () => {
  it('should pick the corner with the fewest curve points', () => {
    expect(getCorner([0.5, 0.5, 0.5])).toBe('top-right'); // first if several
    expect(getCorner([0.5, 0.5, 1])).toBe('top-left');
    expect(getCorner([1, 0.5, 1], [0.5, 0.5, 0])).toBe('bottom-left');
    expect(getCorner([Number.NaN, 0.5, 1], [1, 0.5, Number.NaN])).toBe(
      'bottom-right',
    );
  });

  it('should count segments crossing the legend, not only points', () => {
    // A point in each corner (e.g. on log axes), and a segment through the top-right corner
    const abscissas = [0.1, 0.5, 0.9];
    const NAN = Number.NaN;
    const points = [
      [0.1, NAN, 0.9],
      [0.9, NAN, 0.1],
    ];
    const box = { width: 0.3, height: 0.3, marginX: 0.02, marginY: 0.02 };
    expect(getLegendCorner(abscissas, points, identity, identity, box)).toBe(
      'top-right',
    );
    expect(
      getLegendCorner(
        abscissas,
        [...points, [0.5, 0.5, 1.2]],
        identity,
        identity,
        box,
      ),
    ).toBe('top-left');
  });

  it('should test the region covered by the legend box', () => {
    // A curve along the top: a wide legend covers it in either top corner
    const curve = [0.7, 0.7, 0.7];
    const narrow = { width: 0.2, height: 0.2, marginX: 0, marginY: 0 };
    const tall = { ...narrow, height: 0.4 };
    expect(
      getLegendCorner([0, 0.5, 1], [curve], identity, identity, narrow),
    ).toBe('top-right');
    expect(
      getLegendCorner([0, 0.5, 1], [curve], identity, identity, tall),
    ).toBe('bottom-right');
  });

  it('should avoid reference lines and bands', () => {
    const curve = [0.5, 0.5, 0.5]; // in no corner
    const vline: LegendObstacle = { axis: 'x', range: [0.9, 0.9] };
    const hline: LegendObstacle = { axis: 'y', range: [0.1, 0.1] };
    function getWith(...obstacles: LegendObstacle[]): string {
      return getLegendCorner(
        [0, 0.5, 1],
        [curve],
        identity,
        identity,
        undefined,
        obstacles,
      );
    }

    expect(getWith(vline)).toBe('top-left');
    expect(getWith(vline, hline)).toBe('top-left');
    // A band covering both left corners outweighs a line in the top-right corner
    const band: LegendObstacle = { axis: 'x', range: [0, 0.3] };
    expect(getWith(band, { ...hline, range: [0.9, 0.9] })).toBe('bottom-right');
    // Not shown (e.g. non-positive on a log axis): ignored
    expect(getWith({ ...vline, range: [Number.NaN, Number.NaN] })).toBe(
      'top-right',
    );
  });
});
