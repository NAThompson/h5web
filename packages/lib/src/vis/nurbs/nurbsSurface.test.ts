import { describe, expect, it } from 'vitest';

import {
  evaluateNurbsSurface,
  getBasisDerivatives,
  getBasisFunctions,
  getKnotSpans,
  getKnotVectors,
  getNurbsSurfaceError,
  getSurfaceSampleCounts,
  type NurbsSurface,
  sampleNurbsSurface,
} from './nurbs';

const S = Math.SQRT1_2;

// Unit circle: 9 control points on a square, degree 2
const CIRCLE = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
];
const CIRCLE_WEIGHTS = CIRCLE.map((_, i) => (i % 2 ? S : 1));
const CIRCLE_KNOTS = [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1];

/* Profile `(r, z)` (degree 2) revolved around `z` with the circle: `u` around, `v` along */
function revolve(
  profile: number[][],
  weights: number[],
  knots: number[],
): NurbsSurface {
  return {
    degrees: [2, 2],
    shape: [CIRCLE.length, profile.length],
    points: CIRCLE.flatMap(([cx, cy]) =>
      profile.flatMap(([r, z]) => [r * cx, r * cy, z]),
    ),
    weights: CIRCLE_WEIGHTS.flatMap((wu) => weights.map((wv) => wu * wv)),
    knots: [CIRCLE_KNOTS, knots],
  };
}

// Unit sphere: half circle from south to north pole, revolved
const SPHERE = revolve(
  [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  [1, S, 1, S, 1],
  [0, 0, 0, 0.5, 0.5, 1, 1, 1],
);

// Torus of radii 2 and 0.5: circle around `r = 2`, revolved
const TORUS = revolve(
  CIRCLE.map(([x, y]) => [2 + x / 2, y / 2]),
  CIRCLE_WEIGHTS,
  CIRCLE_KNOTS,
);

// Bicubic B-spline with non-uniform knots, clamped
const WAVE: NurbsSurface = {
  degrees: [3, 3],
  shape: [5, 6],
  points: Array.from({ length: 30 }, (_, i) => {
    const [r, c] = [Math.floor(i / 6), i % 6];
    return [r, c * 0.8, Math.sin(r + c) * (1 + c / 5)];
  }).flat(),
  weights: Array.from({ length: 30 }, () => 1),
  knots: [
    [0, 0, 0, 0, 0.3, 1, 1, 1, 1],
    [0, 0, 0, 0, 1, 1.5, 4, 4, 4, 4],
  ],
};

function grid(count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => i / count);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((acc, val, i) => acc + val * b[i], 0);
}

describe('evaluateNurbsSurface', () => {
  it('should lie on the unit sphere, with radial normals', () => {
    for (const u of grid(40)) {
      for (const v of grid(40)) {
        const { point, normal } = evaluateNurbsSurface(SPHERE, u, v);
        expect(Math.abs(Math.hypot(...point) - 1)).toBeLessThan(1e-12);
        expect(Math.abs(dot(normal, point))).toBeGreaterThan(1 - 1e-9);
      }
    }
  });

  it('should find radial normals at the poles', () => {
    const { point, normal } = evaluateNurbsSurface(SPHERE, 0.3, 0);
    expect(point[2]).toBeCloseTo(-1, 12);
    expect(Math.abs(normal[2])).toBeGreaterThan(1 - 1e-9);
  });

  it('should lie on the torus, with normals from the centre of the tube', () => {
    for (const u of grid(40)) {
      for (const v of grid(40)) {
        const { point, normal } = evaluateNurbsSurface(TORUS, u, v);
        const [x, y, z] = point;
        const r = Math.hypot(x, y);
        const fromTube = [x - (2 * x) / r, y - (2 * y) / r, z];
        expect(Math.abs(Math.hypot(...fromTube) - 0.5)).toBeLessThan(1e-12);
        expect(Math.abs(dot(normal, fromTube) / 0.5)).toBeGreaterThan(1 - 1e-9);
      }
    }
  });

  it('should interpolate bilinearly between four points', () => {
    const saddle: NurbsSurface = {
      degrees: [1, 1],
      shape: [2, 2],
      points: [0, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 0],
      weights: [1, 1, 1, 1],
      knots: [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ],
    };
    const { point, du, dv } = evaluateNurbsSurface(saddle, 0.25, 0.5);
    // z = u + v - 2 u v
    expect(point).toEqual([0.25, 0.5, 0.5]);
    expect(du).toEqual([1, 0, 0]);
    expect(dv).toEqual([0, 1, 0.5]);
  });

  it('should interpolate corner control points of clamped knot vectors', () => {
    function corner(i: number) {
      return WAVE.points.slice(i * 3, i * 3 + 3);
    }
    expect(evaluateNurbsSurface(WAVE, 0, 0).point).toEqual(corner(0));
    expect(evaluateNurbsSurface(WAVE, 0, 4).point).toEqual(corner(5));
    expect(evaluateNurbsSurface(WAVE, 1, 0).point).toEqual(corner(24));
    expect(evaluateNurbsSurface(WAVE, 1, 4).point).toEqual(corner(29));
  });

  it('should match finite differences of the surface', () => {
    const h = 1e-6;
    for (const surface of [WAVE, TORUS]) {
      const { du, dv } = evaluateNurbsSurface(surface, 0.4, 0.6);
      const [a, b, c, d] = [
        [0.4 - h, 0.6],
        [0.4 + h, 0.6],
        [0.4, 0.6 - h],
        [0.4, 0.6 + h],
      ].map(([u, v]) => evaluateNurbsSurface(surface, u, v).point);
      du.forEach((val, i) => {
        expect(val).toBeCloseTo((b[i] - a[i]) / (2 * h), 5);
        expect(dv[i]).toBeCloseTo((d[i] - c[i]) / (2 * h), 5);
      });
    }
  });
});

describe('getBasisDerivatives', () => {
  it('should differentiate basis functions', () => {
    const [vector] = getKnotVectors(WAVE);
    const h = 1e-6;
    const [basis, ders] = getBasisDerivatives(vector, 4, 0.5);
    expect([...basis]).toEqual([...getBasisFunctions(vector, 4, 0.5)]);
    const [below, above] = [0.5 - h, 0.5 + h].map((u) =>
      getBasisFunctions(vector, 4, u),
    );
    ders.forEach((val, i) => {
      expect(val).toBeCloseTo((above[i] - below[i]) / (2 * h), 6);
    });
    expect(ders.reduce((acc, val) => acc + val, 0)).toBeCloseTo(0, 12);
  });
});

describe('getNurbsSurfaceError', () => {
  it('should accept valid surfaces', () => {
    for (const surface of [SPHERE, TORUS, WAVE]) {
      expect(getNurbsSurfaceError(surface)).toBeUndefined();
    }
  });

  it('should reject invalid surfaces', () => {
    expect(
      getNurbsSurfaceError({ ...WAVE, knots: [WAVE.knots[0], [0, 1]] }),
    ).toBe('Expected 10 knots along v (control points + degree + 1), got 2');
    expect(
      getNurbsSurfaceError({
        ...WAVE,
        knots: [[...WAVE.knots[0]].reverse(), WAVE.knots[1]],
      }),
    ).toBe('Knots along u must be non-decreasing');
    expect(getNurbsSurfaceError({ ...WAVE, degrees: [3, 6] })).toBe(
      'Expected at least 7 control points along v for degree 6',
    );
    expect(getNurbsSurfaceError({ ...WAVE, weights: [1] })).toBe(
      'Expected 30 weights (one per control point), got 1',
    );
    expect(getNurbsSurfaceError({ ...WAVE, points: [0, 0, 0] })).toBe(
      'Expected 5 × 6 × 3 control point coordinates, got 3',
    );
  });
});

describe('getSurfaceSampleCounts', () => {
  const spans: [
    ReturnType<typeof getKnotSpans>,
    ReturnType<typeof getKnotSpans>,
  ] = [
    getKnotSpans({ degree: 2, knots: CIRCLE_KNOTS }),
    getKnotSpans({ degree: 2, knots: SPHERE.knots[1] }),
  ];

  it('should sample more finely when larger on screen', () => {
    function scaled(k: number) {
      return Float64Array.from(SPHERE.points, (x) => x * k);
    }
    const [smallU, smallV] = getSurfaceSampleCounts(SPHERE, spans, scaled(100));
    const [largeU, largeV] = getSurfaceSampleCounts(
      SPHERE,
      spans,
      scaled(10_000),
    );
    expect(smallU).toHaveLength(4);
    expect(smallV).toHaveLength(2);
    expect(largeU[0]).toBeGreaterThan(5 * smallU[0]);
    expect(largeV[0]).toBeGreaterThan(5 * smallV[0]);
  });

  it('should keep facets within half a pixel of the sphere', () => {
    const scale = 1000;
    const counts = getSurfaceSampleCounts(
      SPHERE,
      spans,
      Float64Array.from(SPHERE.points, (x) => x * scale),
    );
    const samples = sampleNurbsSurface(SPHERE, spans, counts);
    const cols = counts[1].reduce((acc, n) => acc + n, 1);

    // Middle of each facet along the equator (furthest from the sphere)
    const [, [row]] = counts;
    for (let r = 0; r + 1 < samples.length / 3 / cols; r += 1) {
      const [a, b] = [r, r + 1].map((i) =>
        samples.slice((i * cols + row) * 3, (i * cols + row) * 3 + 3),
      );
      const mid = [0, 1, 2].map((d) => (a[d] + b[d]) / 2);
      expect((1 - Math.hypot(...mid)) * scale).toBeLessThan(0.5);
    }
  });
});
