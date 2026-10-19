import { describe, expect, it } from 'vitest';

import {
  evaluateSurfaceAnalysis,
  getColorByDomain,
  NurbsColorBy,
} from './analysis';
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

describe('getBasisDerivatives (second)', () => {
  it('should differentiate basis functions twice', () => {
    const [vector] = getKnotVectors(WAVE);
    const h = 1e-4;
    const [basis, , second] = getBasisDerivatives(vector, 4, 0.5);
    const [below, above] = [0.5 - h, 0.5 + h].map((u) =>
      getBasisFunctions(vector, 4, u),
    );
    second.forEach((val, i) => {
      expect(val).toBeCloseTo((above[i] - 2 * basis[i] + below[i]) / h ** 2, 4);
    });
    expect(second.reduce((acc, val) => acc + val, 0)).toBeCloseTo(0, 10);
  });
});

describe('evaluateSurfaceAnalysis', () => {
  it('should find the curvatures of the torus', () => {
    // Tube of radius r = 0.5 around a circle of radius R = 2: K = cos θ / r (R + r cos θ)
    for (const u of grid(24)) {
      for (const v of grid(24)) {
        const [x, y] = evaluateNurbsSurface(TORUS, u, v).point;
        const cos = (Math.hypot(x, y) - 2) / 0.5;
        const analysis = evaluateSurfaceAnalysis(TORUS, u, v);
        const k = analysis[NurbsColorBy.GaussianCurvature];
        const h = analysis[NurbsColorBy.MeanCurvature];
        expect(Math.abs(k - cos / (0.5 * (2 + 0.5 * cos)))).toBeLessThan(1e-9);
        // H = (R + 2r cos θ) / 2r (R + r cos θ), up to the sign of the normal
        const expected = (2 + cos) / (2 * 0.5 * (2 + 0.5 * cos));
        expect(Math.abs(Math.abs(h) - expected)).toBeLessThan(1e-9);
      }
    }
  });

  it('should find K = 1/r² and H = ±1/r on the sphere, NaN at its poles', () => {
    const radius = 3;
    const sphere = {
      ...SPHERE,
      points: SPHERE.points.map((val) => val * radius),
    };
    for (const u of grid(20)) {
      for (const v of grid(20).slice(1, -1)) {
        const analysis = evaluateSurfaceAnalysis(sphere, u, v);
        const k = analysis[NurbsColorBy.GaussianCurvature];
        const h = analysis[NurbsColorBy.MeanCurvature];
        expect(Math.abs(k - 1 / radius ** 2)).toBeLessThan(1e-9);
        expect(Math.abs(Math.abs(h) - 1 / radius)).toBeLessThan(1e-9);
      }
    }
    const pole = evaluateSurfaceAnalysis(sphere, 0.3, 0);
    expect(pole[NurbsColorBy.GaussianCurvature]).toBeNaN();
    expect(pole[NurbsColorBy.HeightGradient]).toBeNaN();
  });

  it('should find the surface gradient of a linear field on a plane', () => {
    // Rational, non-uniform plane z = 0, with field 3 x − 4 y (|∇f| = 5): reproduced exactly
    const plane: NurbsSurface = {
      degrees: [2, 2],
      shape: [4, 3],
      points: Array.from({ length: 12 }, (_, i) => {
        const [r, c] = [Math.floor(i / 3), i % 3];
        return [r ** 1.5 + 0.2 * c, c * (1 + r / 3), 0];
      }).flat(),
      weights: Array.from({ length: 12 }, (_, i) => 1 + (i % 5) / 4),
      knots: [
        [0, 0, 0, 0.3, 1, 1, 1],
        [0, 0, 0, 2, 2, 2],
      ],
    };
    const field = Array.from(
      { length: 12 },
      (_, i) => 3 * plane.points[i * 3] - 4 * plane.points[i * 3 + 1],
    );
    for (const u of grid(10)) {
      for (const v of grid(10).map((t) => t * 2)) {
        const analysis = evaluateSurfaceAnalysis(plane, u, v, field);
        const [x, y] = evaluateNurbsSurface(plane, u, v).point;
        expect(analysis[NurbsColorBy.Field]).toBeCloseTo(3 * x - 4 * y, 12);
        expect(Math.abs(analysis[NurbsColorBy.FieldGradient] - 5)).toBeLessThan(
          1e-9,
        );
        expect(analysis[NurbsColorBy.HeightGradient]).toBe(0);
        expect(analysis[NurbsColorBy.GaussianCurvature]).toBe(0);
      }
    }
  });

  it('should find the height gradient of a tilted plane', () => {
    // z = x / 2 + y: |∇_S z| = |∇z| / sqrt(1 + |∇z|²) = sqrt(5/4) / sqrt(9/4)
    const plane: NurbsSurface = {
      degrees: [1, 1],
      shape: [2, 2],
      points: [0, 0, 0, 0, 1, 1, 1, 0, 0.5, 1, 1, 1.5],
      weights: [1, 1, 1, 1],
      knots: [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ],
    };
    const analysis = evaluateSurfaceAnalysis(plane, 0.3, 0.6);
    expect(analysis[NurbsColorBy.HeightGradient]).toBeCloseTo(
      Math.sqrt(5 / 9),
      12,
    );
  });
});

describe('getColorByDomain', () => {
  it('should ignore NaN and spikes of derived quantities', () => {
    const values = [
      Number.NaN,
      ...Array.from({ length: 99 }, (_, i) => i),
      1e9,
    ];
    expect(getColorByDomain(values, NurbsColorBy.Field)).toEqual([0, 1e9]);
    expect(getColorByDomain(values, NurbsColorBy.MeanCurvature)).toEqual([
      2, 97,
    ]);
  });

  it('should take percentiles by surface area', () => {
    // Small features of high curvature (many samples, little area) don't set the domain
    const values = [0.2, 0.25, 0.3, ...Array.from({ length: 20 }, () => 60)];
    const areas = [10, 10, 10, ...Array.from({ length: 20 }, () => 0.01)];
    expect(
      getColorByDomain(values, NurbsColorBy.GaussianCurvature, areas),
    ).toEqual([-0.3, 0.3]);
  });

  it('should be symmetric around 0 for Gaussian curvature', () => {
    const values = Array.from({ length: 101 }, (_, i) => i / 100 - 0.3);
    const [min, max] = getColorByDomain(values, NurbsColorBy.GaussianCurvature);
    expect(min).toBeCloseTo(-0.68, 12);
    expect(max).toBe(-min);
    expect(getColorByDomain([Number.NaN], NurbsColorBy.Height)).toEqual([
      -0.5, 0.5,
    ]);
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
    expect(getNurbsSurfaceError({ ...WAVE, fields: [[1, 2]] })).toBe(
      'Expected 5 × 6 finite values of field 0',
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

  it('should sample twisted patches of straight rows and columns', () => {
    const saddle: NurbsSurface = {
      degrees: [1, 1],
      shape: [2, 2],
      points: [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1], // z = x y
      weights: [1, 1, 1, 1],
      knots: [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ],
    };
    const saddleSpans = getKnotVectors(saddle).map((vec) =>
      getKnotSpans(vec),
    ) as typeof spans;
    const scale = 1000;
    const [[nu], [nv]] = getSurfaceSampleCounts(
      saddle,
      saddleSpans,
      Float64Array.from(saddle.points, (x) => x * scale),
    );

    // Facets of `nu × nv` cells are within `scale / 4 nu nv` of the patch (at their centres)
    expect(scale / (4 * nu * nv)).toBeLessThanOrEqual(0.5);
    expect(nu * nv).toBeLessThan(4 * 500);
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
