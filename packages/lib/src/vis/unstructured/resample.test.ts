import { describe, expect, it } from 'vitest';

import {
  decomposeCells,
  getGridSpec,
  getMeshBounds,
  mergePieces,
  type MeshField,
  resampleMesh,
  type UnstructuredMesh,
} from './resample';

// Unit cube, with points numbered as VTK hexahedra (bottom then top, counter-clockwise)
const CUBE = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
].flat();

function linear(x: number, y: number, z: number): number {
  return 1 + 2 * x + 3 * y - z;
}

function pointValues(points: number[]): number[] {
  return Array.from({ length: points.length / 3 }, (_, i) =>
    linear(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]),
  );
}

function singleCell(type: number, ids: number[]): UnstructuredMesh {
  return {
    points: CUBE,
    connectivity: ids,
    offsets: [0, ids.length],
    types: [type],
  };
}

const GRID = getGridSpec(getMeshBounds(CUBE), 5); // samples every 0.25

function sampleAt(values: Float32Array, i: number, j: number, k: number) {
  return values[(k * 5 + j) * 5 + i];
}

describe('resampleMesh', () => {
  it('should reproduce a linear field at all samples of a hexahedron', () => {
    const mesh = singleCell(12, [0, 1, 2, 3, 4, 5, 6, 7]);
    const field = {
      values: pointValues(CUBE),
      association: 'point',
      components: 1,
    } as const;
    const values = resampleMesh(mesh, field, GRID);

    expect(values).toHaveLength(125);
    for (let k = 0; k < 5; k += 1) {
      for (let j = 0; j < 5; j += 1) {
        for (let i = 0; i < 5; i += 1) {
          expect(sampleAt(values, i, j, k)).toBeCloseTo(
            linear(i / 4, j / 4, k / 4),
            5,
          );
        }
      }
    }
  });

  it('should fill samples outside all cells with NaN', () => {
    // Corner tetrahedron x + y + z <= 1
    const mesh = singleCell(10, [0, 1, 3, 4]);
    const field = {
      values: pointValues(CUBE),
      association: 'point',
      components: 1,
    } as const;
    const values = resampleMesh(mesh, field, GRID);

    expect(sampleAt(values, 1, 1, 1)).toBeCloseTo(linear(0.25, 0.25, 0.25), 5);
    expect(sampleAt(values, 2, 2, 0)).toBeCloseTo(linear(0.5, 0.5, 0), 5); // on a face
    expect(sampleAt(values, 2, 2, 1)).toBeNaN();
    expect(sampleAt(values, 4, 4, 4)).toBeNaN();
    expect(values.filter(Number.isFinite)).toHaveLength(35); // tetrahedral number of 5
  });

  it('should cover voxels, wedges and pyramids', () => {
    const field = { values: CUBE.map(() => 1), association: 'point' } as const;
    const voxel = singleCell(11, [0, 1, 3, 2, 4, 5, 7, 6]);
    const wedges: UnstructuredMesh = {
      points: CUBE,
      connectivity: [0, 1, 2, 4, 5, 6, 0, 2, 3, 4, 6, 7],
      offsets: [0, 6, 12],
      types: [13, 13],
    };
    const pyramids: UnstructuredMesh = {
      points: [...CUBE, 0.5, 0.5, 0.5], // centre as apex of the six faces
      connectivity: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
      ].flatMap((face) => [...face, 8]),
      offsets: [0, 5, 10, 15, 20, 25, 30],
      types: [14, 14, 14, 14, 14, 14],
    };

    for (const mesh of [voxel, wedges, pyramids]) {
      const values = resampleMesh(mesh, { ...field, components: 1 }, GRID);
      expect(values.every((val) => val === 1)).toBe(true);
    }
  });

  it('should keep cell values constant and resample vectors by magnitude', () => {
    const mesh: UnstructuredMesh = {
      points: CUBE,
      connectivity: [0, 1, 3, 4, 6, 7, 5, 2], // corner tetrahedron, then an unsupported cell
      offsets: [0, 4, 8],
      types: [10, 7],
    };
    const field: MeshField = {
      values: [3, 4, 0, 0],
      association: 'cell',
      components: 2,
    };
    const values = resampleMesh(mesh, field, GRID);

    expect(sampleAt(values, 1, 1, 1)).toBe(5);
    expect(decomposeCells(mesh).skipped).toBe(1);
  });
});

describe('mergePieces', () => {
  it('should offset the point indices and offsets of each piece', () => {
    const mesh: UnstructuredMesh = {
      points: [...CUBE, ...CUBE],
      connectivity: [0, 1, 3, 4, 0, 1, 3, 4, 6, 7, 5, 2],
      offsets: [0, 4, 0, 4, 8],
      types: [10, 10, 10],
    };
    const merged = mergePieces(mesh, { points: [8, 8], cells: [1, 2] });

    expect([...merged.offsets]).toStrictEqual([0, 4, 8, 12]);
    expect([...merged.connectivity]).toStrictEqual([
      0, 1, 3, 4, 8, 9, 11, 12, 14, 15, 13, 10,
    ]);
  });
});

describe('getGridSpec', () => {
  it('should sample bounds with the resolution along the longest side', () => {
    const grid = getGridSpec({ min: [0, 0, 0], max: [4, 2, 1] }, 64);
    expect(grid.shape).toStrictEqual([16, 32, 64]);
  });
});
