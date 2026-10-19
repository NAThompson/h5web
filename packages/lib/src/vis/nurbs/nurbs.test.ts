import { describe, expect, it } from 'vitest';

import {
  evaluateNurbs,
  findSpan,
  getBasisFunctions,
  getGpuParams,
  getKnotSpans,
  getNurbsError,
  getSegmentCounts,
  getSpanSteps,
  type KnotVector,
  type NurbsCurve,
  sampleBasis,
  sampleNurbs,
} from './nurbs';
import { getCached } from './utils';

const S = Math.SQRT1_2;

// Exact unit circle: 9 control points on a square, degree 2
const CIRCLE: NurbsCurve = {
  degree: 2,
  dims: 2,
  points: [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1, 1, 0],
  weights: [1, S, 1, S, 1, S, 1, S, 1],
  knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
};

// Non-uniform knots, all weights 1
const ARCH: NurbsCurve = {
  degree: 2,
  dims: 2,
  points: [0, 0, 1, 2, 3, 2, 4, 0],
  weights: [1, 1, 1, 1],
  knots: [0, 0, 0, 1, 4, 4, 4],
};

describe('evaluateNurbs', () => {
  it('should lie on the unit circle', () => {
    for (let i = 0; i <= 1000; i += 1) {
      const [x, y] = evaluateNurbs(CIRCLE, i / 1000);
      expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(1e-12);
    }
  });

  it('should interpolate end points of clamped knot vectors', () => {
    expect(evaluateNurbs(ARCH, 0)).toEqual([0, 0]);
    expect(evaluateNurbs(ARCH, 4)).toEqual([4, 0]);
    expect(evaluateNurbs(CIRCLE, 1)).toEqual([1, 0]);
  });

  it('should match hand-computed basis on non-uniform knots', () => {
    // On [0, 1): (1 - u)², u (1 - u) + u (4 - u) / 4, u² / 4
    expect([...getBasisFunctions(ARCH, 2, 0.5)]).toEqual([
      0.25, 0.6875, 0.0625,
    ]);
    expect(evaluateNurbs(ARCH, 0.5)).toEqual([0.875, 1.5]);
  });

  it('should pass through control point at knot repeated `degree` times', () => {
    const corner: NurbsCurve = {
      degree: 2,
      dims: 2,
      points: [0, 0, 1, 1, 2, 0, 3, 1, 4, 0],
      weights: [1, 1, 1, 1, 1],
      knots: [0, 0, 0, 1, 1, 2, 2, 2],
    };
    expect(getNurbsError(corner)).toBeUndefined();
    expect(evaluateNurbs(corner, 1)).toEqual([2, 0]);
  });

  it('should evaluate 3D curves', () => {
    const helix: NurbsCurve = {
      ...CIRCLE,
      dims: 3,
      points: [...CIRCLE.points].flatMap(
        (v, i) => (i % 2 === 1 ? [v, Math.floor(i / 2)] : [v]), // z: index of point
      ),
    };
    const [x, y, z] = evaluateNurbs(helix, 0.25);
    expect([x, y]).toEqual([0, 1]);
    expect(z).toBeCloseTo(2, 12);
  });
});

describe('findSpan', () => {
  it('should find span of parameter', () => {
    expect(findSpan(CIRCLE, 0)).toBe(2);
    expect(findSpan(CIRCLE, 0.3)).toBe(4);
    expect(findSpan(CIRCLE, 0.5)).toBe(6);
    expect(findSpan(CIRCLE, 1)).toBe(8); // last non-empty span
  });
});

describe('getKnotSpans', () => {
  it('should skip empty spans', () => {
    expect(getKnotSpans(CIRCLE).map(({ index }) => index)).toEqual([
      2, 4, 6, 8,
    ]);
  });

  it('should skip spans that are empty on the GPU (`f32`, cf. `getGpuParams`)', () => {
    const far = [1e9, 1e9, 1e9 + 2, 1e9 + 2]; // 10⁹ + 2 is 10⁹ in `f32`
    expect(getGpuParams({ degree: 1, knots: far })).toEqual(
      Float32Array.of(0, 0, 1, 1),
    );

    const knots = [0, 0, 1, 1 + 1e-9, 2, 2];
    expect(getKnotSpans({ degree: 1, knots })).toEqual([
      { index: 1, start: 0, end: 1 },
      { index: 3, start: 1 + 1e-9, end: 2 },
    ]);
  });
});

describe('getNurbsError', () => {
  it('should accept valid curves', () => {
    expect(getNurbsError(CIRCLE)).toBeUndefined();
    expect(getNurbsError(ARCH)).toBeUndefined();
  });

  it('should reject invalid curves', () => {
    expect(getNurbsError({ ...ARCH, knots: [0, 0, 0, 1, 4, 4] })).toBe(
      'Expected 7 knots (control points + degree + 1), got 6',
    );
    expect(getNurbsError({ ...ARCH, knots: [0, 0, 0, 5, 4, 4, 4] })).toBe(
      'Knots must be non-decreasing',
    );
    expect(getNurbsError({ ...ARCH, weights: [1, 0, 1, 1] })).toBe(
      'Weights must be positive',
    );
    expect(getNurbsError({ ...ARCH, weights: [1, 1] })).toBe(
      'Expected 4 weights (one per control point), got 2',
    );
    expect(getNurbsError({ ...ARCH, degree: 1.5 })).toBe(
      'Degree must be a positive integer (got 1.5)',
    );
    expect(getNurbsError({ ...ARCH, degree: 4 })).toBe(
      'Expected at least 5 control points for degree 4',
    );
    expect(getNurbsError({ ...ARCH, knots: [0, 0, 0, 0, 0, 0, 0] })).toBe(
      'Knots must increase between knots 2 and 4 (the domain)',
    );
    expect(
      getNurbsError({
        ...CIRCLE,
        knots: [0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.75, 0.75, 1, 1, 1],
      }),
    ).toBe('Interior knot 0.5 is repeated more than 2 times');
  });
});

describe('getSegmentCounts', () => {
  it('should keep chords within a quarter of a pixel of the curve', () => {
    const spans = getKnotSpans(CIRCLE);

    for (const radius of [10, 1000, 100_000]) {
      const counts = getSegmentCounts(CIRCLE, spans, [radius, radius]);
      const samples = sampleNurbs(CIRCLE, spans, counts);
      expect(samples).toHaveLength(2 * (counts.reduce((a, n) => a + n) + 1));

      let maxSag = 0;
      for (let i = 0; i + 3 < samples.length; i += 2) {
        const midX = (samples[i] + samples[i + 2]) / 2;
        const midY = (samples[i + 1] + samples[i + 3]) / 2;
        maxSag = Math.max(maxSag, 1 - Math.hypot(midX, midY));
      }
      expect(maxSag * radius).toBeLessThan(0.25);
    }
  });

  it('should draw straight spans with a single chord', () => {
    const line: NurbsCurve = {
      degree: 2,
      dims: 2,
      points: [0, 0, 1, 1, 2, 2],
      weights: [1, 1, 1],
      knots: [0, 0, 0, 1, 1, 1],
    };
    expect([...getSegmentCounts(line, getKnotSpans(line), [1e6, 1e6])]).toEqual(
      [1],
    );
  });
});

describe('sampleBasis', () => {
  // Cubic, non-uniform knots, knot 2 repeated 3 times
  const KINKED: KnotVector = {
    degree: 3,
    knots: [0, 0, 0, 0, 0.5, 2, 2, 2, 3, 3, 3, 3],
  };
  const vectors: KnotVector[] = [CIRCLE, ARCH, KINKED];

  function getSteps(vector: KnotVector) {
    const spans = getKnotSpans(vector);
    return getSpanSteps(spans, new Uint32Array(spans.length).fill(50));
  }

  it('should sum to 1 at every parameter (partition of unity)', () => {
    vectors.forEach((vector) => {
      const steps = getSteps(vector);
      const weights = vector === CIRCLE ? CIRCLE.weights : undefined;
      [undefined, weights].forEach((ws) => {
        const basis = sampleBasis(vector, steps, ws);
        steps.params.forEach((_, s) => {
          const sum = basis.reduce((acc, values) => acc + values[s], 0);
          expect(sum).toBeCloseTo(1, 12);
        });
      });
    });
  });

  it('should vanish outside of `[knots[i], knots[i + p + 1]]` (local support)', () => {
    vectors.forEach((vector) => {
      const { degree: p, knots } = vector;
      const steps = getSteps(vector);
      sampleBasis(vector, steps).forEach((values, i) => {
        expect(values.every((val) => val >= 0)).toBe(true);
        const outside = values.filter(
          (_, s) =>
            steps.params[s] < knots[i] || steps.params[s] > knots[i + p + 1],
        );
        expect(outside.every((val) => val === 0)).toBe(true);
      });
    });
  });

  it('should be 1 at a knot repeated `degree` times for its control point', () => {
    const steps = { params: [2], spans: Uint32Array.of(7) };
    expect(sampleBasis(KINKED, steps).map((values) => values[0])).toEqual([
      0, 0, 0, 0, 1, 0, 0, 0,
    ]);
  });

  it('should weigh rational basis functions', () => {
    const steps = { params: [0.125], spans: Uint32Array.of(2) };
    const [n0, n1, n2] = sampleBasis(CIRCLE, steps).map((vals) => vals[0]);
    const [r0, r1] = sampleBasis(CIRCLE, steps, CIRCLE.weights).map(
      (vals) => vals[0],
    );
    expect(r1).toBeCloseTo((S * n1) / (n0 + S * n1 + n2), 12);
    expect(r0).toBeCloseTo(n0 / (n0 + S * n1 + n2), 12);
  });
});

describe('getCached', () => {
  it('should compute again only once the key changes', () => {
    const ref = {};
    let calls = 0;
    function compute() {
      calls += 1;
      return calls;
    }
    expect(getCached(ref, [1, 2], compute)).toBe(1);
    expect(getCached(ref, [1, 2], compute)).toBe(1);
    expect(getCached(ref, [1, 3], compute)).toBe(2);
    expect(getCached(ref, [1, 3, 0], compute)).toBe(3);
  });
});
