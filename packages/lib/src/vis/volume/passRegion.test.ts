import { describe, expect, it } from 'vitest';

import { runSteps } from '../geometry-worker/jobs';
import { getRegionFraction } from './hooks';
import { type PassBounds, passRegionSteps } from './passRegion';

const N = 21;

/* Region of `fn(x, y, z)` (from 0 to 1 at the faces of the box) on an N³ grid of voxel centres */
function getRegion(
  fn: (x: number, y: number, z: number) => number,
  bounds: PassBounds,
  step = 1,
  shape: [number, number, number] = [N, N, N],
) {
  const [nz, ny, nx] = shape;
  const values = new Float32Array(nx * ny * nz);
  values.forEach((_, i) => {
    const x = ((i % nx) + 0.5) / nx;
    const y = ((Math.floor(i / nx) % ny) + 0.5) / ny;
    const z = (Math.floor(i / (nx * ny)) + 0.5) / nz;
    values[i] = fn(x, y, z);
  });

  const geometry = runSteps(passRegionSteps(values, shape, bounds, step));
  const fraction = getRegionFraction(geometry, shape, [
    undefined,
    undefined,
    undefined,
  ]);
  return { geometry, fraction };
}

function nanAbove(x: number): number {
  return x > 0.5 ? Number.NaN : x;
}

function infAbove(x: number): number {
  return x > 0.5 ? Infinity : x;
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

describe('pass region', () => {
  it('should be closed by caps on the walls of the box', () => {
    const { geometry } = getRegion((x, y) => x + 0.3 * y, { min: 0.4 });

    expect(geometry.indices.length).toBeGreaterThan(0);
    expect(getEdgeCounts(geometry.indices).every((n) => n === 2)).toBe(true);

    // Caps lie on the faces of the box, i.e. half a voxel beyond the outer grid points
    const xs = [...geometry.positions].filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs)).toBe(N - 0.5);
    expect(Math.min(...geometry.positions)).toBeGreaterThanOrEqual(-0.5);
    expect(Math.max(...geometry.positions)).toBeLessThanOrEqual(N - 0.5);

    // Cap on the +x face faces outwards
    const capNormals = xs.flatMap((x, v) =>
      x === N - 0.5 && geometry.normals[v * 3] === 1 ? [v] : [],
    );
    expect(capNormals.length).toBeGreaterThan(0);
  });

  it('should fill the passing fraction of the box', () => {
    expect(getRegion((x) => x, { min: 0.25 }).fraction).toBeCloseTo(0.75, 3);
    expect(getRegion((x) => x, { max: 0.25 }).fraction).toBeCloseTo(0.25, 3);
    expect(getRegion((x) => x, { min: 0.25, max: 0.6 }).fraction).toBeCloseTo(
      0.35,
      3,
    );
    expect(
      getRegion((x) => x, { min: 0.25, invert: true }).fraction,
    ).toBeCloseTo(0.25, 3);
    expect(getRegion((x) => x, { min: 2 }).fraction).toBe(0);
    expect(getRegion((x) => x, { min: -1 }).fraction).toBeCloseTo(1, 6);

    // Ball of radius 0.3 at the centre
    const ball = getRegion((x, y, z) => Math.hypot(x - 0.5, y - 0.5, z - 0.5), {
      max: 0.3,
    });
    expect(ball.fraction).toBeCloseTo((4 / 3) * Math.PI * 0.3 ** 3, 2);
    expect(getEdgeCounts(ball.geometry.indices).every((n) => n === 2)).toBe(
      true,
    );

    // Window across a corner of the box (spherical shell, an eighth of it inside)
    const shell = getRegion((x, y, z) => Math.hypot(x, y, z), {
      min: 0.4,
      max: 0.8,
    });
    expect(shell.fraction).toBeCloseTo(
      ((4 / 3) * Math.PI * (0.8 ** 3 - 0.4 ** 3)) / 8,
      2,
    );
  });

  it('should include values on a bound, and pass infinite values within', () => {
    expect(getRegion(() => 2, { min: 2 }).fraction).toBeCloseTo(1, 6);
    expect(getRegion(() => 2, { min: 2, invert: true }).fraction).toBe(0);
    expect(getRegion(() => 2, { min: 1, max: 2 }).fraction).toBeCloseTo(1, 6);

    const { geometry, fraction } = getRegion(infAbove, { min: 0 });
    expect(fraction).toBeCloseTo(1, 6);
    expect(getEdgeCounts(geometry.indices).every((n) => n === 2)).toBe(true);
    expect(getRegion(infAbove, { max: 1 }).fraction).toBeCloseTo(0.5, 1);
  });

  it('should keep caps on the faces when decimated', () => {
    const { geometry, fraction } = getRegion(
      () => 1,
      { min: 0 },
      2,
      [20, 21, 22],
    );
    expect(geometry.step).toBe(2);
    expect(fraction).toBeCloseTo(1, 6);
    expect(getEdgeCounts(geometry.indices).every((n) => n === 2)).toBe(true);

    const half = getRegion((x) => x, { min: 0.5 }, 3);
    expect(half.fraction).toBeCloseTo(0.5, 2);
    expect(getEdgeCounts(half.geometry.indices).every((n) => n === 2)).toBe(
      true,
    );
  });

  it('should fail NaN values, unless inverted', () => {
    expect(getRegion(nanAbove, { min: 0 }).fraction).toBeCloseTo(0.5, 1);
    expect(getRegion(nanAbove, { min: 0, invert: true }).fraction).toBeCloseTo(
      0.5,
      1,
    );
    const { geometry } = getRegion(nanAbove, { min: 0 });
    expect(getEdgeCounts(geometry.indices).every((n) => n === 2)).toBe(true);
  });

  it('should measure non-uniform axes along their coordinates', () => {
    const shape: [number, number, number] = [N, N, N];
    const values = new Float32Array(N ** 3).map((_, i) => i % N); // x index
    const geometry = runSteps(passRegionSteps(values, shape, { max: 9.5 }, 1));

    // Voxels 0 to 9 of 21 pass: from -0.5 to 54.5 (edge between 9 and 100) of an axis to 205
    const xs = Float32Array.from({ length: N }, (_, i) =>
      i < 10 ? i : 10 * i,
    );
    expect(
      getRegionFraction(geometry, shape, [xs, undefined, undefined]),
    ).toBeCloseTo(55 / 205.5, 3);
    expect(
      getRegionFraction(geometry, shape, [undefined, undefined, undefined]),
    ).toBeCloseTo(10 / N, 3);
  });
});
