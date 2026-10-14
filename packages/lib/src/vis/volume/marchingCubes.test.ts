/* eslint-disable no-bitwise -- cube corner bitmasks */
import { describe, expect, it } from 'vitest';

import {
  CENTROID_BASE,
  CUBE_EDGES,
  CUBE_FACES,
  getCaseTriangles,
  getDecimationStep,
  getSampleIndices,
  type IsosurfaceGeometry,
  marchingCubes,
} from './marchingCubes';

type Field = (x: number, y: number, z: number) => number;

function sampleField(size: [number, number, number], fn: Field): Float32Array {
  const [nz, ny, nx] = size;
  const values = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        values[k * nx * ny + j * nx + i] = fn(i, j, k);
      }
    }
  }
  return values;
}

function vertex(geom: IsosurfaceGeometry, idx: number): number[] {
  return [0, 1, 2].map((c) => geom.positions[idx * 3 + c]);
}

/* Map each undirected edge to the number of triangles using it, and count directed edges */
function getEdgeStats(geom: IsosurfaceGeometry) {
  const undirected = new Map<string, number>();
  const directed = new Map<string, number>();
  const { indices } = geom;
  for (let t = 0; t < indices.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[t + e];
      const b = indices[t + ((e + 1) % 3)];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      undirected.set(key, (undirected.get(key) ?? 0) + 1);
      directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  return { undirected, directed };
}

function expectClosedManifold(geom: IsosurfaceGeometry) {
  const { undirected, directed } = getEdgeStats(geom);
  expect(undirected.size).toBeGreaterThan(0);
  for (const count of undirected.values()) {
    expect(count).toBe(2); // no cracks, no fins
  }
  for (const [key, count] of directed) {
    expect(count).toBe(1); // consistent winding
    const [a, b] = key.split('>');
    expect(directed.has(`${b}>${a}`)).toBe(true);
  }
  return { edges: undirected.size };
}

function countComponents(geom: IsosurfaceGeometry): number {
  const vertexCount = geom.positions.length / 3;
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  function find(i: number): number {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i]; // eslint-disable-line no-param-reassign
    }
    return i;
  }
  for (let t = 0; t < geom.indices.length; t += 3) {
    const r = find(geom.indices[t]);
    parent[find(geom.indices[t + 1])] = r;
    parent[find(geom.indices[t + 2])] = r;
  }
  const roots = new Set<number>();
  for (let i = 0; i < vertexCount; i += 1) {
    roots.add(find(i));
  }
  return roots.size;
}

function corner(n: number): number[] {
  return [n & 1, (n >> 1) & 1, (n >> 2) & 1];
}

function countCaseTriangles(caseIndex: number): number {
  return getCaseTriangles(caseIndex).triangles.length / 3;
}

function makeAmbiguousCube(saddleLow: boolean): Float32Array {
  const low = saddleLow ? -3 : -1;
  // Corners: 0 (0,0,0) and 3 (1,1,0) inside; the rest outside
  const corners = [low, 1, 1, low, 2, 2, 2, 2];
  return Float32Array.from(corners);
}

describe('cube tables', () => {
  it('should list faces counter-clockwise when seen from outside', () => {
    CUBE_FACES.forEach(([c0, c1, c2]) => {
      const [p0, p1, p2] = [c0, c1, c2].map(corner);
      const u = p1.map((v, i) => v - p0[i]);
      const v = p2.map((val, i) => val - p1[i]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const centre = [0, 1, 2].map((i) => p0[i] - 0.5);
      const outward = normal.reduce((acc, n, i) => acc + n * centre[i], 0);
      expect(outward).toBeGreaterThan(0);
    });
  });

  it('should only use edges crossed by the surface', () => {
    for (let caseIndex = 0; caseIndex < 256; caseIndex += 1) {
      for (const edge of getCaseTriangles(caseIndex).triangles) {
        if (edge >= CENTROID_BASE) {
          continue;
        }
        const [a, b] = CUBE_EDGES[edge];
        expect((caseIndex >> a) & 1).not.toBe((caseIndex >> b) & 1);
      }
    }
  });

  it('should produce no triangles for empty or full cubes', () => {
    expect(countCaseTriangles(0)).toBe(0);
    expect(countCaseTriangles(255)).toBe(0);
    expect(countCaseTriangles(1)).toBe(1); // single corner
    expect(countCaseTriangles(0b0000_1111)).toBe(2); // quad parallel to a face
    expect(countCaseTriangles(0b0001_0111)).toBe(6); // hexagon, fanned around its centroid
  });
});

describe('marchingCubes', () => {
  it('should approximate a sphere with a closed, outward-facing surface', () => {
    const n = 32;
    const c = (n - 1) / 2;
    const radius = 10;
    const values = sampleField([n, n, n], (x, y, z) =>
      Math.hypot(x - c, y - c, z - c),
    );

    const geom = marchingCubes(values, [n, n, n], radius);
    const vertexCount = geom.positions.length / 3;
    expect(vertexCount).toBeGreaterThan(1000);

    let maxError = 0;
    for (let v = 0; v < vertexCount; v += 1) {
      const [x, y, z] = vertex(geom, v);
      const r = Math.hypot(x - c, y - c, z - c);
      maxError = Math.max(maxError, Math.abs(r - radius));

      // Normals point outward (towards higher values), and so does the gradient
      const radial = [x - c, y - c, z - c].map((val) => val / r);
      const dot =
        radial[0] * geom.normals[v * 3] +
        radial[1] * geom.normals[v * 3 + 1] +
        radial[2] * geom.normals[v * 3 + 2];
      expect(dot).toBeGreaterThan(0.99);
      expect(geom.gradients[v]).toBeCloseTo(1, 1);
    }
    expect(maxError).toBeLessThan(0.05);

    // Triangle winding agrees with the normals
    for (let t = 0; t < geom.indices.length; t += 3) {
      const [a, b, cc] = [0, 1, 2].map((e) =>
        vertex(geom, geom.indices[t + e]),
      );
      const u = b.map((val, i) => val - a[i]);
      const w = cc.map((val, i) => val - a[i]);
      const normal = [
        u[1] * w[2] - u[2] * w[1],
        u[2] * w[0] - u[0] * w[2],
        u[0] * w[1] - u[1] * w[0],
      ];
      const outward = normal.reduce((acc, val, i) => acc + val * (a[i] - c), 0);
      expect(outward).toBeGreaterThan(0);
    }

    const { edges } = expectClosedManifold(geom);
    const faces = geom.indices.length / 3;
    expect(vertexCount - edges + faces).toBe(2); // Euler characteristic of a sphere
    expect(countComponents(geom)).toBe(1);
  });

  it('should extract a plane exactly', () => {
    const shape: [number, number, number] = [6, 7, 8];
    const values = sampleField(shape, (x, y) => x + 0.5 * y);
    const level = 4.3;
    const geom = marchingCubes(values, shape, level);

    expect(geom.indices.length).toBeGreaterThan(0);
    for (let v = 0; v < geom.positions.length / 3; v += 1) {
      const [x, y] = vertex(geom, v);
      expect(x + 0.5 * y).toBeCloseTo(level, 5);
      expect(geom.normals[v * 3]).toBeCloseTo(2 / Math.sqrt(5), 5);
      expect(geom.normals[v * 3 + 1]).toBeCloseTo(1 / Math.sqrt(5), 5);
      expect(geom.normals[v * 3 + 2]).toBeCloseTo(0, 5);
      expect(geom.gradients[v]).toBeCloseTo(Math.sqrt(1.25), 5);
    }
  });

  it('should resolve ambiguous faces with the asymptotic decider', () => {
    // Two diagonal corners of the bottom face are inside (below the level)

    // Saddle of face [a, b, c, d] = [-1, 1, -1, 1] is 0 = level: separated
    const separated = marchingCubes(makeAmbiguousCube(false), [2, 2, 2], 0);
    expect(countComponents(separated)).toBe(2);

    // Saddle of [-3, 1, -3, 1] is -1 < level: inside corners are connected
    const connected = marchingCubes(makeAmbiguousCube(true), [2, 2, 2], 0);
    expect(countComponents(connected)).toBe(1);
  });

  it.each([1, 2, 3, 42, 1234])(
    'should produce watertight surfaces in random fields with ambiguous cells (seed %i)',
    (initialSeed) => {
      let seed = initialSeed;
      function random(): number {
        seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32;
        return seed / 2 ** 32;
      }

      const n = 12;
      const values = sampleField([n, n, n], (x, y, z) => {
        const onBorder = [x, y, z].some((v) => v === 0 || v === n - 1);
        return onBorder ? 1 : random() * 2 - 1; // closed surfaces thanks to the border
      });

      const { edges } = expectClosedManifold(
        marchingCubes(values, [n, n, n], 0),
      );
      expect(edges).toBeGreaterThan(0);
    },
  );

  it('should skip cells with NaN corners', () => {
    const n = 16;
    const c = (n - 1) / 2;
    const values = sampleField([n, n, n], (x, y, z) =>
      x < 4 ? Number.NaN : Math.hypot(x - c, y - c, z - c),
    );

    const geom = marchingCubes(values, [n, n, n], 5);
    expect(geom.indices.length).toBeGreaterThan(0);
    expect(geom.positions.every(Number.isFinite)).toBe(true);
    expect(geom.normals.every(Number.isFinite)).toBe(true);
    expect(geom.gradients.every(Number.isFinite)).toBe(true);
    for (let v = 0; v < geom.positions.length / 3; v += 1) {
      expect(vertex(geom, v)[0]).toBeGreaterThanOrEqual(4);
    }
  });

  it('should skip invalid values and interpolate in log space', () => {
    const shape: [number, number, number] = [2, 2, 4];
    const values = sampleField(shape, (x) => (x === 0 ? -1 : 10 ** x));

    const geom = marchingCubes(values, shape, 10 ** 1.5, { scaleType: 'log' });
    for (let v = 0; v < geom.positions.length / 3; v += 1) {
      expect(vertex(geom, v)[0]).toBeCloseTo(1.5, 5);
    }

    const linear = marchingCubes(values, shape, 10 ** 1.5);
    expect(vertex(linear, 0)[0]).not.toBeCloseTo(1.5, 1);
  });

  it('should compute gradient magnitudes in axis units', () => {
    const shape: [number, number, number] = [3, 3, 5];
    const values = sampleField(shape, (x) => x);
    const axisX = [0, 2, 4, 6, 8]; // two units per index

    const geom = marchingCubes(values, shape, 1.5, {
      axisValues: [axisX, undefined, undefined],
    });
    expect(geom.gradients.length).toBeGreaterThan(0);
    for (const g of geom.gradients) {
      expect(g).toBeCloseTo(0.5, 5);
    }
  });

  it('should decimate large grids while keeping the surface close', () => {
    const n = 33;
    const c = (n - 1) / 2;
    const values = sampleField([n, n, n], (x, y, z) =>
      Math.hypot(x - c, y - c, z - c),
    );

    const full = marchingCubes(values, [n, n, n], 12);
    const coarse = marchingCubes(values, [n, n, n], 12, { step: 2 });
    expect(coarse.step).toBe(2);
    expect(coarse.indices.length).toBeLessThan(full.indices.length / 3);

    for (let v = 0; v < coarse.positions.length / 3; v += 1) {
      const [x, y, z] = vertex(coarse, v);
      expect(Math.abs(Math.hypot(x - c, y - c, z - c) - 12)).toBeLessThan(0.2);
    }
    expectClosedManifold(coarse);
  });
});

describe('getSampleIndices', () => {
  it('should include last index', () => {
    expect([...getSampleIndices(5, 1)]).toStrictEqual([0, 1, 2, 3, 4]);
    expect([...getSampleIndices(6, 2)]).toStrictEqual([0, 2, 4, 5]);
  });
});

describe('getDecimationStep', () => {
  it('should keep cells within budget', () => {
    expect(getDecimationStep([64, 64, 64], 2 ** 24)).toBe(1);
    expect(getDecimationStep([512, 512, 512], 2 ** 24)).toBe(2); // 256³ cells
    expect(getDecimationStep([1000, 10, 10], 1000)).toBe(5);
  });
});
