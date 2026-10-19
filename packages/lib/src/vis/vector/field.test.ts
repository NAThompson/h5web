import { describe, expect, it } from 'vitest';

import {
  differentiate,
  findInterval,
  getCurl2D,
  getDivergence,
  getEvenlySpacedStreamlines,
  getLatticeSeeds,
  getReferenceMagnitude,
  getSeededStreamlines3D,
  getStreamlineArrows,
  sampleBilinear,
  sampleField,
  sampleField3D,
  traceStreamline,
  type VectorField2D,
  type VectorField3D,
} from './field';

function linspace(start: number, end: number, n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) => start + ((end - start) * i) / (n - 1),
  );
}

// Chebyshev-like spacing: dense at both ends
function chebyshev(start: number, end: number, n: number): number[] {
  return Array.from(
    { length: n },
    (_, i) =>
      (start + end) / 2 -
      ((end - start) / 2) * Math.cos((Math.PI * i) / (n - 1)),
  );
}

function makeField(
  xs: number[],
  ys: number[],
  fn: (x: number, y: number) => [number, number],
): VectorField2D {
  const u = new Float64Array(xs.length * ys.length);
  const v = new Float64Array(xs.length * ys.length);
  ys.forEach((y, j) => {
    xs.forEach((x, i) => {
      [u[j * xs.length + i], v[j * xs.length + i]] = fn(x, y);
    });
  });
  return { xs, ys, u, v };
}

function bilinear(x: number, y: number): number {
  return 2 + 3 * x - y + 0.5 * x * y;
}

describe('findInterval', () => {
  it('should find the interval of ascending and descending axes', () => {
    expect(findInterval([0, 1, 3], 2)).toEqual({ i: 1, t: 0.5 });
    expect(findInterval([0, 1, 3], 3)).toEqual({ i: 1, t: 1 });
    expect(findInterval([3, 1, 0], 2)).toEqual({ i: 0, t: 0.5 });
    expect(findInterval([0, 1, 3], 3.1)).toBeUndefined();
    expect(findInterval([0, 1, 3], Number.NaN)).toBeUndefined();
  });
});

describe('sampleBilinear', () => {
  it('should be exact for bilinear functions on non-uniform grids', () => {
    const xs = [0, 0.1, 0.5, 2];
    const ys = [-1, 0, 4];
    const values = ys.flatMap((y) => xs.map((x) => bilinear(x, y)));
    for (const [x, y] of [
      [0.3, 1],
      [1.7, -0.5],
      [2, 4],
      [0, -1],
    ]) {
      expect(sampleBilinear(values, xs, ys, x, y)).toBeCloseTo(
        bilinear(x, y),
        12,
      );
    }
    expect(sampleBilinear(values, xs, ys, 2.5, 0)).toBeNaN();
  });

  it('should sample both components', () => {
    const field = makeField([0, 1], [0, 1], (x, y) => [x, y]);
    expect(sampleField(field, 0.25, 0.75)).toEqual([0.25, 0.75]);
  });
});

describe('differentiate', () => {
  it('should be exact for quadratics on non-uniform grids, ends included', () => {
    const xs = chebyshev(-1, 2, 9);
    const values = xs.map((x) => 3 * x * x - 2 * x + 1);
    const d = differentiate(values, xs, 1);
    xs.forEach((x, i) => {
      expect(d[i]).toBeCloseTo(6 * x - 2, 4);
    });
  });
});

describe('getDivergence and getCurl2D', () => {
  const xs = chebyshev(-1, 1, 41);
  const ys = linspace(-2, 2, 33).map((y) => y + 0.05 * Math.sin(3 * y)); // non-uniform

  it('should differentiate a solid-body rotation: no divergence, curl 2ω', () => {
    const field = makeField(xs, ys, (x, y) => [-1.5 * y, 1.5 * x]);
    for (const val of getDivergence(field)) {
      expect(val).toBeCloseTo(0, 5);
    }
    for (const val of getCurl2D(field)) {
      expect(val).toBeCloseTo(3, 5);
    }
  });

  it('should differentiate a smooth field to second order', () => {
    // u = sin x cos y, v = x² y: div = cos x cos y + x², curl = 2xy + sin x sin y
    const field = makeField(xs, ys, (x, y) => [
      Math.sin(x) * Math.cos(y),
      x * x * y,
    ]);
    const div = getDivergence(field);
    const curl = getCurl2D(field);
    let maxErr = 0;
    ys.forEach((y, j) => {
      xs.forEach((x, i) => {
        const k = j * xs.length + i;
        maxErr = Math.max(
          maxErr,
          Math.abs(div[k] - (Math.cos(x) * Math.cos(y) + x * x)),
          Math.abs(curl[k] - (2 * x * y + Math.sin(x) * Math.sin(y))),
        );
      });
    });
    expect(maxErr).toBeLessThan(0.02);
  });

  it('should add ∂w/∂z in 3D', () => {
    const zs = [0, 0.5, 2];
    const n = 4 * 3 * 3;
    const xs3 = [0, 1, 2, 4];
    const ys3 = [0, 1, 3];
    const u = new Float64Array(n);
    const v = new Float64Array(n);
    const w = new Float64Array(n);
    for (let k = 0; k < 3; k += 1) {
      for (let j = 0; j < 3; j += 1) {
        for (let i = 0; i < 4; i += 1) {
          const idx = (k * 3 + j) * 4 + i;
          [u[idx], v[idx], w[idx]] = [xs3[i], 2 * ys3[j], -zs[k]];
        }
      }
    }
    const field: VectorField3D = { xs: xs3, ys: ys3, zs, u, v, w };
    for (const val of getDivergence(field)) {
      expect(val).toBeCloseTo(2, 10);
    }
    expect(sampleField3D(field, 3, 2, 1)).toEqual([3, 4, -1]);
  });
});

describe('getReferenceMagnitude', () => {
  it('should ignore spikes and missing values', () => {
    const mags = [...Array.from({ length: 99 }, () => 1), 1000, Number.NaN];
    expect(getReferenceMagnitude(mags)).toBe(1);
    expect(getReferenceMagnitude([0, Number.NaN])).toBe(1);
  });
});

describe('traceStreamline', () => {
  const axis = linspace(-2, 2, 81);
  const rotation = makeField(axis, axis, (x, y) => [-y, x]);

  it('should close circles of a solid-body rotation', () => {
    const points = traceStreamline(rotation, [1, 0], 1, {
      step: 0.05,
      maxLength: 10,
    });
    // Closes onto the seed after one turn (2π), counter-clockwise
    const n = points.length / 2;
    expect(points.slice(-2)).toEqual([1, 0]);
    expect(n * 0.05).toBeGreaterThan(2 * Math.PI - 0.1);
    expect(n * 0.05).toBeLessThan(2 * Math.PI + 0.1);
    expect(points[3]).toBeGreaterThan(0); // first step goes up
    for (let k = 0; k < points.length; k += 2) {
      expect(Math.hypot(points[k], points[k + 1])).toBeCloseTo(1, 4);
    }
  });

  it('should keep radius with a mapped space and go backwards', () => {
    const map = { ax: 100, bx: 5, ay: 100, by: -3 }; // e.g. world pixels
    const points = traceStreamline(rotation, [0, 1.5], -1, {
      step: 2,
      maxLength: 400,
      map,
    });
    expect(points[2]).toBeGreaterThan(5); // clockwise from the top: towards +x
    for (let k = 0; k < points.length; k += 2) {
      const [x, y] = [(points[k] - 5) / 100, (points[k + 1] + 3) / 100];
      expect(Math.hypot(x, y)).toBeCloseTo(1.5, 4);
    }
  });

  it('should stop at the edge of the grid and at stagnation points', () => {
    const uniform = makeField(axis, axis, () => [1, 0]);
    const toEdge = traceStreamline(uniform, [0, 0], 1, {
      step: 0.1,
      maxLength: 100,
    });
    expect(toEdge.at(-2)).toBeLessThanOrEqual(2);
    expect(toEdge.at(-2)).toBeGreaterThan(1.8);
    expect(
      traceStreamline(rotation, [0, 0], 1, { step: 0.1, maxLength: 1 }),
    ).toEqual([0, 0]);
  });
});

describe('getEvenlySpacedStreamlines', () => {
  it('should fill the domain with separated concentric circles', () => {
    const axis = linspace(-1, 1, 65);
    const field = makeField(axis, axis, (x, y) => [-y, x]);
    const map = { ax: 200, bx: 0, ay: 200, by: 0 }; // 400 × 400 px
    const lines = getEvenlySpacedStreamlines(field, { map, separation: 20 });
    expect(lines.length).toBeGreaterThan(8);
    expect(lines.every((line) => line.length < 2 * 4000)).toBe(true); // one turn each

    // Circles at least `separation / 2` apart: radii of closed lines differ by > 9 px
    const radii = lines
      .map((line) => Math.hypot(line[0], line[1]))
      .filter((radius) => radius < 190) // closed circles, not corner arcs
      .sort((a, b) => a - b);
    for (let i = 1; i < radii.length; i += 1) {
      expect(radii[i] - radii[i - 1]).toBeGreaterThan(9);
    }
  });

  it('should place arrowheads along lines', () => {
    const arrows = getStreamlineArrows([[0, 0, 10, 0, 10, 10]], 6);
    expect(arrows.map(({ x, y }) => [x, y])).toEqual([
      [3, 0],
      [9, 0],
      [10, 5],
    ]);
    expect(arrows[2]).toMatchObject({ dx: 0, dy: 1 });
  });
});

describe('getSeededStreamlines3D', () => {
  it('should trace circles of a rotation about z', () => {
    const axis = linspace(-1, 1, 9);
    const n = 9 ** 3;
    const [u, v, w] = [
      new Float64Array(n),
      new Float64Array(n),
      new Float64Array(n),
    ];
    for (let k = 0; k < 9; k += 1) {
      for (let j = 0; j < 9; j += 1) {
        for (let i = 0; i < 9; i += 1) {
          const idx = (k * 9 + j) * 9 + i;
          [u[idx], v[idx], w[idx]] = [-axis[j], axis[i], 0];
        }
      }
    }
    const field = { xs: axis, ys: axis, zs: axis, u, v, w };
    const seeds = getLatticeSeeds(field, 2);
    expect(seeds).toHaveLength(8);
    expect(getLatticeSeeds(field, 3, { axis: 'z', value: 0.5 })).toHaveLength(
      9,
    );
    const lines = getSeededStreamlines3D(field, (x, y, z) => [x, y, z], {
      seeds,
      step: 0.02,
      maxSteps: 100,
    });
    expect(lines).toHaveLength(8);
    for (const line of lines) {
      const r0 = Math.hypot(line[0], line[1]);
      for (let k = 0; k < line.length; k += 3) {
        expect(Math.hypot(line[k], line[k + 1])).toBeCloseTo(r0, 3);
        expect(line[k + 2]).toBe(line[2]);
      }
    }
  });
});
