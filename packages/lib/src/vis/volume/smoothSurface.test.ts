import { describe, expect, it } from 'vitest';

import { isosurfaceSteps, runSteps } from '../geometry-worker/jobs';
import { getRegionFraction } from './hooks';
import { type IsosurfaceGeometry } from './marchingCubes';
import { passRegionSteps } from './passRegion';
import { evaluateSpline, getSmoothField, getSpline } from './smoothSurface';

type Field = (x: number, y: number, z: number) => number;

function sampleField(n: number, fn: Field): Float64Array {
  const values = new Float64Array(n * n * n);
  values.forEach((_, p) => {
    values[p] = fn(p % n, Math.floor(p / n) % n, Math.floor(p / (n * n)));
  });
  return values;
}

function extract(
  values: Float64Array,
  n: number,
  level: number,
  smooth: boolean,
  scaleType?: string,
): IsosurfaceGeometry {
  return runSteps(
    isosurfaceSteps(
      values,
      [n, n, n],
      [undefined, undefined, undefined],
      level,
      scaleType,
      1,
      smooth,
    ),
  );
}

/* Number of triangles using each undirected edge */
function getEdgeCounts(indices: Uint32Array): number[] {
  const counts = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const [a, b] = [indices[t + e], indices[t + ((e + 1) % 3)]];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.values()];
}

/* RMS distance to the sphere of radius `r` around `(c, c, c)` of the vertices, or of the centroids of the triangles */
function getSphereError(
  geometry: IsosurfaceGeometry,
  c: number,
  r: number,
  centroids = false,
): number {
  const { positions, indices } = geometry;
  const count = centroids ? indices.length / 3 : positions.length / 3;
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const corners = centroids
      ? [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]]
      : [i];
    const [x, y, z] = [0, 1, 2].map(
      (axis) =>
        corners.reduce((acc, v) => acc + positions[v * 3 + axis], 0) /
        corners.length,
    );
    sum += (Math.hypot(x - c, y - c, z - c) - r) ** 2;
  }
  return Math.sqrt(sum / count);
}

function field(x: number, y: number, z: number): number {
  return Math.sin(x) * Math.cos(0.7 * y) + 0.1 * z * z;
}

describe('spline', () => {
  const n = 7;
  const spline = getSpline(sampleField(n, field), [n, n, n], 0);
  const out = new Float64Array(4);

  it('should interpolate the samples', () => {
    for (const p of [
      [0, 0, 0],
      [3, 2, 6],
      [6, 6, 1],
      [1, 5, 4],
    ]) {
      expect(evaluateSpline(spline, p, out)).toBe(true);
      expect(out[0]).toBeCloseTo(field(p[0], p[1], p[2]), 5);
    }
  });

  it('should have the gradient of its values', () => {
    const h = 1e-4;
    const p = [2.3, 3.7, 1.4];
    evaluateSpline(spline, p, out);
    const grad = out.slice(1);
    for (let axis = 0; axis < 3; axis += 1) {
      const [lo, hi] = [-h, h].map((d) => {
        const q = p.with(axis, p[axis] + d);
        evaluateSpline(spline, q, out);
        return out[0];
      });
      expect(grad[axis]).toBeCloseTo((hi - lo) / (2 * h), 4);
    }
  });

  it('should not be used near invalid samples', () => {
    const values = sampleField(n, field);
    values[3 * n * n + 3 * n + 3] = Number.NaN;
    const withNaN = getSpline(values, [n, n, n], 0);
    expect(evaluateSpline(withNaN, [4.5, 4.5, 4.5], out)).toBe(false);
    expect(evaluateSpline(withNaN, [0, 0, 0], out)).toBe(true);
    expect(out[0]).toBeCloseTo(field(0, 0, 0), 1);
  });
});

describe('smooth isosurfaces', () => {
  // Coarse sphere: distance to the centre of an 8³ grid
  const n = 8;
  const c = 3.5;
  const r = 2.6;
  const values = sampleField(n, (x, y, z) => Math.hypot(x - c, y - c, z - c));

  it('should be much closer to the sphere than marching cubes', () => {
    const plain = extract(values, n, r, false);
    const smooth = extract(values, n, r, true);

    // Vertices of marching cubes are close already (the field is linear along edges), not their triangles
    expect(getSphereError(smooth, c, r)).toBeLessThan(
      getSphereError(plain, c, r) / 10,
    );
    expect(getSphereError(smooth, c, r, true)).toBeLessThan(
      getSphereError(plain, c, r, true) / 4,
    );
    expect(smooth.gradients.every((val) => Math.abs(val - 1) < 0.05)).toBe(
      true,
    );
  });

  it('should stay watertight with normals pointing outwards', () => {
    const { positions, normals, indices } = extract(values, n, r, true);
    expect(getEdgeCounts(indices).every((count) => count === 2)).toBe(true);

    for (let v = 0; v < positions.length; v += 3) {
      const dot = [0, 1, 2].reduce(
        (acc, a) => acc + (positions[v + a] - c) * normals[v + a],
        0,
      );
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('should stay watertight when sags tie at the split budget', () => {
    const small = sampleField(4, (x, y, z) =>
      Math.hypot(x - 1.5, y - 1.5, z - 1.5),
    );
    const { indices } = extract(small, 4, 1, true);
    expect(getEdgeCounts(indices).every((count) => count === 2)).toBe(true);
  });

  it('should keep open surfaces on the faces of the box', () => {
    const { positions, indices } = extract(values, n, 4.5, true); // sphere cut by the box
    expect(positions.every((val) => val >= 0 && val <= n - 1)).toBe(true);
    expect(getEdgeCounts(indices).every((count) => count <= 2)).toBe(true);
  });

  it('should smooth in the space of the scale', () => {
    const exp = values.map(Math.exp);
    const smooth = extract(exp, n, Math.exp(r), true, 'log');
    expect(getSphereError(smooth, c, r)).toBeLessThan(0.002);
    const expected = Math.exp(r); // of the data, not of its log
    expect(
      smooth.gradients.every((val) => Math.abs(val / expected - 1) < 0.05),
    ).toBe(true);
  });

  it('should keep small variations on large values', () => {
    const offset = 1e10;
    const shifted = values.map((val) => offset + val);
    const smooth = extract(shifted, n, offset + r, true);
    expect(getSphereError(smooth, c, r)).toBeLessThan(0.002);
  });

  it('should get gradients at the edge of the scale domain', () => {
    const smooth = extract(
      values.map((val) => val - r),
      n,
      0,
      true,
      'sqrt',
    );
    expect(smooth.gradients.every(Number.isFinite)).toBe(true);
  });

  it('should leave invalid values out', () => {
    const withNaN = values.map((val, p) => (p % n < 2 ? Number.NaN : val));
    const { positions, indices } = extract(withNaN, n, r, true);
    expect(indices.length).toBeGreaterThan(0);
    expect(positions.every((val) => Number.isFinite(val))).toBe(true);
    expect(positions.every((val, i) => i % 3 !== 0 || val >= 2)).toBe(true);
  });
});

describe('smooth pass region', () => {
  // Ball of radius 0.8 centred on a corner of the box, from 0 to 1 along each axis
  const N = 9;
  const shape: [number, number, number] = [N, N, N];
  const values = new Float32Array(N ** 3);
  values.forEach((_, i) => {
    const [x, y, z] = [i % N, Math.floor(i / N) % N, Math.floor(i / N ** 2)];
    values[i] = Math.hypot(x + 0.5, y + 0.5, z + 0.5) / N;
  });
  const exact = (Math.PI * 0.8 ** 3) / 6;

  function extractRegion(invert: boolean, smooth: boolean) {
    const geometry = runSteps(
      passRegionSteps(values, shape, { max: 0.8, invert }, 1, smooth),
    );
    expect(getEdgeCounts(geometry.indices).every((n) => n === 2)).toBe(true);
    expect(
      geometry.positions.every((val) => val >= -0.5 && val <= N - 0.5),
    ).toBe(true);
    const fraction = getRegionFraction(geometry, shape, [
      undefined,
      undefined,
      undefined,
    ]);
    return { geometry, fraction };
  }

  it('should stay closed, with caps on the faces of the box', () => {
    const plain = extractRegion(false, false).fraction;
    const smooth = extractRegion(false, true).fraction;
    expect(Math.abs(smooth - exact)).toBeLessThan(Math.abs(plain - exact) / 2);
    expect(smooth).toBeCloseTo(exact, 2);
  });

  /* Fraction of the vertices off the faces of the box that are on the spline's level set */
  function getProjectedFraction({ positions }: IsosurfaceGeometry): number {
    const { spline, ref } = getSmoothField(values, shape, undefined, 1);
    const out = new Float64Array(4);
    let [onLevel, count] = [0, 0];
    for (let v = 0; v < positions.length; v += 3) {
      const p = positions.subarray(v, v + 3);
      if (p.every((val) => val > -0.5 && val < N - 0.5)) {
        evaluateSpline(spline, p, out);
        onLevel += Math.abs(out[0] + ref - 0.8) < 1e-5 ? 1 : 0;
        count += 1;
      }
    }
    return onLevel / count;
  }

  it('should smooth the failing part too', () => {
    const plain = extractRegion(true, false);
    const smooth = extractRegion(true, true);
    expect(getProjectedFraction(smooth.geometry)).toBeGreaterThan(0.9);
    expect(smooth.geometry.indices.length).toBeGreaterThan(
      plain.geometry.indices.length,
    );
    expect(Math.abs(smooth.fraction - (1 - exact))).toBeLessThan(
      Math.abs(plain.fraction - (1 - exact)) / 2,
    );
  });
});
