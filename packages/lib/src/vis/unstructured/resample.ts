import { type NumArray } from '@h5web/shared/vis-models';

/* Unstructured mesh, as stored by VTK (e.g. VTKHDF `UnstructuredGrid`) with pieces merged */
export interface UnstructuredMesh {
  points: NumArray; // `x, y, z` of each point
  connectivity: NumArray; // point indices of each cell, one cell after the other
  offsets: NumArray; // start of each cell in `connectivity`, plus its end (`nCells + 1` values)
  types: NumArray; // VTK cell type of each cell
}

/* Values of a mesh at its points (interpolated linearly in cells) or of its cells (constant) */
export interface MeshField {
  values: NumArray;
  association: 'point' | 'cell';
  components: number; // vectors are resampled by magnitude
}

export interface GridSpec {
  shape: [number, number, number]; // `[z, y, x]`
  min: [number, number, number]; // `x, y, z` of the first sample
  max: [number, number, number]; // `x, y, z` of the last sample
}

/* Values of a field resampled onto a grid (NaN outside the mesh) and their coverage */
export interface ResampledValues {
  values: Float32Array<ArrayBuffer>;
  coverage: Uint8Array<ArrayBuffer>; // cf. `getCoverage`
}

export type Bounds3D = Pick<GridSpec, 'min' | 'max'>;

/* Points of a mesh and its cells split into tetrahedra (cf. `decomposeCells`) */
export interface TetMesh {
  points: NumArray;
  tets: Int32Array; // four point indices per tetrahedron
  cells: Int32Array; // index of the cell of each tetrahedron
}

// Tetrahedra of linear 3D cells, as local point indices (cf. `vtkCellType.h`)
const HEX_TETS = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
];
const VOXEL_TO_HEX = [0, 1, 3, 2, 4, 5, 7, 6]; // voxels number their points along x, y, z
const TETS: Partial<Record<number, number[][]>> = {
  10: [[0, 1, 2, 3]], // tetra
  11: HEX_TETS.map((tet) => tet.map((i) => VOXEL_TO_HEX[i])), // voxel
  12: HEX_TETS, // hexahedron
  13: [
    [0, 1, 2, 3],
    [1, 2, 3, 4],
    [2, 3, 4, 5],
  ], // wedge
  14: [
    [0, 1, 2, 4],
    [0, 2, 3, 4],
  ], // pyramid
};
// Quadratic cells start with the points of their linear counterpart, which they are drawn as
TETS[24] = TETS[10];
TETS[25] = TETS[12];
TETS[26] = TETS[13];
TETS[27] = TETS[14];
TETS[29] = TETS[12]; // triquadratic hexahedron

/* Split 3D cells into tetrahedra: four point indices per tetrahedron and the index of its cell.
 * Other cells (e.g. 2D, polyhedra) are skipped. */
export function decomposeCells(
  mesh: UnstructuredMesh,
): Omit<TetMesh, 'points'> & { skipped: number } {
  const { connectivity, offsets, types } = mesh;

  let count = 0;
  let skipped = 0;
  for (const type of types) {
    const tets = TETS[type];
    if (tets) {
      count += tets.length;
    } else {
      skipped += 1;
    }
  }

  const tets = new Int32Array(count * 4);
  const cells = new Int32Array(count);
  let t = 0;
  for (const [cell, type] of types.entries()) {
    const start = offsets[cell];
    for (const tet of TETS[type] ?? []) {
      for (let v = 0; v < 4; v += 1) {
        tets[t * 4 + v] = connectivity[start + tet[v]];
      }
      cells[t] = cell;
      t += 1;
    }
  }

  return { tets, cells, skipped };
}

/* Merge pieces stored one after the other: their offsets and point indices start at zero */
export function mergePieces(
  mesh: UnstructuredMesh,
  counts: { points: NumArray; cells: NumArray },
): UnstructuredMesh {
  if (counts.cells.length <= 1) {
    return mesh;
  }

  const { connectivity, offsets } = mesh;
  const nCells = mesh.types.length;
  const mergedConn = new Int32Array(connectivity.length);
  const mergedOffsets = new Int32Array(nCells + 1);

  let cell = 0;
  let pointStart = 0;
  let connStart = 0;
  for (const [piece, nPieceCells] of counts.cells.entries()) {
    const offsetsStart = cell + piece; // each piece has one more offset than cells
    const connLength = offsets[offsetsStart + nPieceCells];
    for (let i = 0; i < nPieceCells; i += 1) {
      mergedOffsets[cell + i] = connStart + offsets[offsetsStart + i];
    }
    for (let i = 0; i < connLength; i += 1) {
      mergedConn[connStart + i] = pointStart + connectivity[connStart + i];
    }
    cell += nPieceCells;
    pointStart += counts.points[piece];
    connStart += connLength;
  }
  mergedOffsets[nCells] = connStart;

  return { ...mesh, connectivity: mergedConn, offsets: mergedOffsets };
}

export function getMeshBounds(points: NumArray): Bounds3D {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      const val = points[i + a];
      if (val < min[a]) {
        min[a] = val;
      }
      if (val > max[a]) {
        max[a] = val;
      }
    }
  }
  return { min, max };
}

/* Default number of samples along the longest side: about twice the cells along it */
export function getDefaultResolution(nCells: number): number {
  return Math.min(Math.max(Math.round(2 * Math.cbrt(nCells)), 32), 192);
}

/* Grid with `resolution` samples along the longest side of the bounds and as many per unit
 * length along the others */
export function getGridSpec(bounds: Bounds3D, resolution: number): GridSpec {
  const { min, max } = bounds;
  const extents = [0, 1, 2].map((a) => max[a] - min[a]);
  const longest = Math.max(...extents);
  const [nx, ny, nz] = extents.map((extent) =>
    longest > 0 ? Math.max(2, Math.round((resolution * extent) / longest)) : 2,
  );
  return { shape: [nz, ny, nx], min, max };
}

/* Values of a field at the samples of a grid (`[z, y, x]`): tetrahedra of the cells are
 * rasterized, and samples outside all of them are NaN. Point values are interpolated
 * linearly (barycentric coordinates), so linear fields are reproduced exactly. */
export function resampleMesh(
  mesh: UnstructuredMesh,
  field: MeshField,
  grid: GridSpec,
): Float32Array<ArrayBuffer> {
  const gen = resampleSteps(
    { points: mesh.points, ...decomposeCells(mesh) },
    field,
    grid,
  );
  let res = gen.next();
  while (!res.done) {
    res = gen.next();
  }
  return res.value;
}

const PROGRESS_STEP = 4096; // tetrahedra between yields (e.g. to check for cancellation)

/* Steps of `resampleMesh` over a mesh already split into tetrahedra, yielding progress */
export function* resampleSteps(
  mesh: TetMesh,
  field: MeshField,
  grid: GridSpec,
): Generator<number, Float32Array<ArrayBuffer>> {
  const { points, tets, cells } = mesh;
  const { shape, min, max } = grid;
  const [nz, ny, nx] = shape;
  const dims = [nx, ny, nz];
  const steps = [0, 1, 2].map((a) =>
    dims[a] > 1 && max[a] > min[a] ? (max[a] - min[a]) / (dims[a] - 1) : 1,
  );

  const values = getScalarValues(field);
  const out = new Float32Array(nx * ny * nz).fill(Number.NaN);

  const tet: Tet = {
    p: Array.from({ length: 12 }, () => 0),
    f: [0, 0, 0, 0],
    m: Array.from({ length: 9 }, () => 0),
  };
  const nTets = cells.length;
  for (let t = 0; t < nTets; t += 1) {
    if (t % PROGRESS_STEP === 0) {
      yield t / nTets;
    }
    const cell = cells[t];
    for (let v = 0; v < 4; v += 1) {
      const point = tets[t * 4 + v];
      for (let a = 0; a < 3; a += 1) {
        tet.p[v * 3 + a] = (points[point * 3 + a] - min[a]) / steps[a];
      }
      tet.f[v] = field.association === 'point' ? values[point] : values[cell];
    }
    if (invertEdges(tet)) {
      fillTet(tet, out, dims);
    }
  }

  return out;
}

/* Scratch arrays, reused from one tetrahedron to the next */
interface Tet {
  p: number[]; // points, in sample units
  f: number[]; // values at the points
  m: number[]; // inverse of the matrix of edges from point 0 (rows map to coordinates 1-3)
}

const EPS = 1e-6; // in barycentric coordinates: samples on shared faces belong to both tets

/* eslint-disable @typescript-eslint/prefer-destructuring -- slower in these hot loops */

/* Compute `m`, unless the tetrahedron is degenerate (or has NaN points) */
function invertEdges(tet: Tet): boolean {
  const { p, m } = tet;
  const ax = p[3] - p[0];
  const ay = p[4] - p[1];
  const az = p[5] - p[2];
  const bx = p[6] - p[0];
  const by = p[7] - p[1];
  const bz = p[8] - p[2];
  const cx = p[9] - p[0];
  const cy = p[10] - p[1];
  const cz = p[11] - p[2];
  const det =
    ax * (by * cz - bz * cy) -
    bx * (ay * cz - az * cy) +
    cx * (ay * bz - az * by);
  if (!(Math.abs(det) > 1e-12)) {
    return false;
  }
  const inv = 1 / det;
  m[0] = (by * cz - bz * cy) * inv;
  m[1] = (bz * cx - bx * cz) * inv;
  m[2] = (bx * cy - by * cx) * inv;
  m[3] = (az * cy - ay * cz) * inv;
  m[4] = (ax * cz - az * cx) * inv;
  m[5] = (ay * cx - ax * cy) * inv;
  m[6] = (ay * bz - az * by) * inv;
  m[7] = (az * bx - ax * bz) * inv;
  m[8] = (ax * by - ay * bx) * inv;
  return true;
}

/* Interpolate values at the samples inside a tetrahedron, row by row along x: barycentric
 * coordinates are linear along a row, so each of them bounds the range of samples inside */
function fillTet(tet: Tet, out: Float32Array, dims: number[]): void {
  const { p, f, m } = tet;
  const [nx, ny] = dims;
  const x0 = p[0];
  const y0 = p[1];
  const z0 = p[2];
  const b1 = m[0]; // coordinates 1-3 per sample along x
  const b2 = m[3];
  const b3 = m[6];
  const b0 = -(b1 + b2 + b3);

  const iLo = boxStart(p, 0);
  const jLo = boxStart(p, 1);
  const kLo = boxStart(p, 2);
  const iHi = boxEnd(p, 0, nx);
  const jHi = boxEnd(p, 1, ny);
  const kHi = boxEnd(p, 2, dims[2]);

  for (let k = kLo; k <= kHi; k += 1) {
    for (let j = jLo; j <= jHi; j += 1) {
      // Coordinates 1-3 at `i = 0`
      const a1 = m[1] * (j - y0) + m[2] * (k - z0) - b1 * x0;
      const a2 = m[4] * (j - y0) + m[5] * (k - z0) - b2 * x0;
      const a3 = m[7] * (j - y0) + m[8] * (k - z0) - b3 * x0;
      const a0 = 1 - a1 - a2 - a3;

      const start = Math.max(
        iLo,
        firstInside(a0, b0),
        firstInside(a1, b1),
        firstInside(a2, b2),
        firstInside(a3, b3),
      );
      const end = Math.min(
        iHi,
        lastInside(a0, b0),
        lastInside(a1, b1),
        lastInside(a2, b2),
        lastInside(a3, b3),
      );

      const row = (k * ny + j) * nx;
      for (let i = start; i <= end; i += 1) {
        const l1 = a1 + b1 * i;
        const l2 = a2 + b2 * i;
        const l3 = a3 + b3 * i;
        // eslint-disable-next-line no-param-reassign
        out[row + i] =
          (1 - l1 - l2 - l3) * f[0] + l1 * f[1] + l2 * f[2] + l3 * f[3];
      }
    }
  }
}

/* eslint-enable @typescript-eslint/prefer-destructuring */

/* Range of samples along axis `a` of the bounding box of a tetrahedron */
function boxStart(p: number[], a: number): number {
  return Math.max(
    0,
    Math.ceil(Math.min(p[a], p[3 + a], p[6 + a], p[9 + a]) - EPS),
  );
}
function boxEnd(p: number[], a: number, n: number): number {
  return Math.min(
    n - 1,
    Math.floor(Math.max(p[a], p[3 + a], p[6 + a], p[9 + a]) + EPS),
  );
}

/* First and last `i` such that `a + b i >= -EPS` */
function firstInside(a: number, b: number): number {
  return b > 0
    ? Math.ceil((-EPS - a) / b)
    : b < 0 || a >= -EPS
      ? -Infinity
      : Infinity;
}
function lastInside(a: number, b: number): number {
  return b < 0
    ? Math.floor((-EPS - a) / b)
    : b > 0 || a >= -EPS
      ? Infinity
      : -Infinity;
}

function getScalarValues(field: MeshField): NumArray {
  const { values, components } = field;
  if (components <= 1) {
    return values;
  }

  const magnitudes = new Float64Array(values.length / components);
  for (let i = 0; i < magnitudes.length; i += 1) {
    let sum = 0;
    for (let c = 0; c < components; c += 1) {
      sum += values[i * components + c] ** 2;
    }
    magnitudes[i] = Math.sqrt(sum);
  }
  return magnitudes;
}

/* Smoothed mask of the samples with values (i.e. inside the mesh), from 0 to 255, for a volume
 * to render the boundary of the mesh as a smooth surface (coverage 0.5) not a voxel staircase.
 * Samples keep their side of 0.5 (e.g. thin parts of the mesh), only transitions are smoothed. */
export function getCoverage(
  values: Float32Array,
  shape: [number, number, number],
): Uint8Array<ArrayBuffer> {
  const [nz, ny, nx] = shape;
  let mask = new Uint16Array(values.length);
  // eslint-disable-next-line unicorn/no-for-loop -- faster than iterators on large grids
  for (let i = 0; i < values.length; i += 1) {
    mask[i] = Number.isNaN(values[i]) ? 0 : 1;
  }

  // Binomial filter `[1, 4, 6, 4, 1]` along each axis (sums up to 16^3)
  let scratch = new Uint16Array(values.length);
  for (const axis of [0, 1, 2]) {
    const n = shape[2 - axis];
    const stride = [1, nx, nx * ny][axis];
    let i = 0;
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1, i += 1) {
          // Edges are extended, so that the mesh is not faded out at the faces of the grid
          const pos = axis === 0 ? x : axis === 1 ? y : z;
          const prev = pos > 0 ? stride : 0;
          const prev2 = pos > 1 ? 2 * stride : prev;
          const next = pos < n - 1 ? stride : 0;
          const next2 = pos < n - 2 ? 2 * stride : next;
          scratch[i] =
            mask[i - prev2] +
            4 * mask[i - prev] +
            6 * mask[i] +
            4 * mask[i + next] +
            mask[i + next2];
        }
      }
    }
    [mask, scratch] = [scratch, mask];
  }

  const coverage = new Uint8Array(values.length);
  // eslint-disable-next-line unicorn/no-for-loop -- faster than iterators on large grids
  for (let i = 0; i < mask.length; i += 1) {
    const smoothed = Math.round((mask[i] * 255) / 4096);
    coverage[i] = Number.isNaN(values[i])
      ? Math.min(smoothed, 127)
      : Math.max(smoothed, 128);
  }
  return coverage;
}
