/* eslint-disable no-bitwise, complexity, max-depth, unicorn/prefer-single-call -- tight loops over corner bitmasks */
import { GrowableArray } from '../geometry-worker/buffers';
import { crossingRatio, getScaleTransform } from '../geometry-worker/scale';

/*
 * Marching cubes with:
 * - triangulation tables generated (and cached) from face walks, so every
 *   surface patch is consistent with its neighbours (no cracks);
 * - ambiguous faces resolved with the asymptotic decider (bilinear saddle value),
 *   which is evaluated per face and therefore agrees between adjacent cells;
 * - vertices welded per grid edge, with normals and gradient magnitudes
 *   interpolated from central differences at the grid points.
 *
 * Volumes are indexed `[z][y][x]` (i.e. `[depth][rows][cols]`) and vertex
 * positions are returned as `(x, y, z)` index coordinates.
 * Triangles are wound counter-clockwise when seen from the side of higher values,
 * which is also the direction of the normals (i.e. the gradient).
 */

export interface IsosurfaceGeometry {
  level: number;
  positions: Float32Array; // (x, y, z) in index space
  normals: Float32Array; // unit gradient direction in index space
  gradients: Float32Array; // gradient magnitude, in data units per axis unit
  indices: Uint32Array;
  step: number; // grid stride used for extraction (1 = full resolution)
}

export interface MarchingCubesOptions {
  scaleType?: string | [string, number];
  /* Grid stride (decimation); 1 for full resolution */
  step?: number;
  /* Coordinates of the grid points along x, y and z, for gradients in axis units */
  axisValues?: [
    x: ArrayLike<number> | undefined,
    y: ArrayLike<number> | undefined,
    z: ArrayLike<number> | undefined,
  ];
}

/* Corner `n` of a cube is at offset `(n & 1, (n >> 1) & 1, (n >> 2) & 1)` */
export const CUBE_EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
]; // prettier-ignore

/* Corners of each face, counter-clockwise when seen from outside the cube */
export const CUBE_FACES: [number, number, number, number][] = [
  [0, 4, 6, 2], // -x
  [1, 3, 7, 5], // +x
  [0, 1, 5, 4], // -y
  [2, 6, 7, 3], // +y
  [0, 2, 3, 1], // -z
  [4, 5, 7, 6], // +z
];

const EDGE_LOOKUP = new Int8Array(64).fill(-1);
CUBE_EDGES.forEach(([a, b], i) => {
  EDGE_LOOKUP[a * 8 + b] = i;
  EDGE_LOOKUP[b * 8 + a] = i;
});

/* Faces whose corners alternate inside/outside, for each of the 256 cases */
const AMBIGUOUS_FACES: number[][] = Array.from(
  { length: 256 },
  (_, caseIndex) =>
    CUBE_FACES.flatMap((corners, f) => {
      const [i0, i1, i2, i3] = corners.map((c) => (caseIndex >> c) & 1);
      return i0 === i2 && i1 === i3 && i0 !== i1 ? [f] : [];
    }),
);

/* Loops with at least this many vertices are triangulated around their centroid */
const MIN_CENTROID_LOOP = 6;

/* Triangle vertices `>= CENTROID_BASE` refer to the centroid of `centroidLoops[i - CENTROID_BASE]` */
export const CENTROID_BASE = 12;

export interface CaseTriangulation {
  triangles: Int8Array;
  centroidLoops: Int8Array[];
}

const triangleCache = new Map<number, CaseTriangulation>();

/*
 * Triangles (as triplets of cube edge indices, or centroids) for a given case.
 * Bit `n` of `caseIndex` is set when corner `n` is below the level ("inside").
 * Bit `f` of `connectedFaces` is set when the inside corners of ambiguous face `f`
 * are connected across the face (otherwise they are separated).
 */
export function getCaseTriangles(
  caseIndex: number,
  connectedFaces = 0,
): CaseTriangulation {
  const key = caseIndex | (connectedFaces << 8);
  const cached = triangleCache.get(key);
  if (cached) {
    return cached;
  }

  // Each crossed edge gets exactly one outgoing segment, from the one face of its two where the segment starts there
  const nextEdge = new Int8Array(12).fill(-1);
  function isInside(corner: number): boolean {
    return ((caseIndex >> corner) & 1) === 1;
  }

  CUBE_FACES.forEach((corners, f) => {
    // Crossings in counter-clockwise order: entering (outside -> inside) or exiting
    const crossings: { edge: number; entering: boolean }[] = [];
    for (let k = 0; k < 4; k += 1) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      if (isInside(a) !== isInside(b)) {
        crossings.push({ edge: EDGE_LOOKUP[a * 8 + b], entering: isInside(b) });
      }
    }

    const connected = ((connectedFaces >> f) & 1) === 1;
    crossings.forEach(({ edge, entering }, i) => {
      if (!entering) {
        return;
      }
      // Pair each entering crossing with the next exiting crossing, which cuts off the inside corners in between,
      // or with the previous one, which cuts off outside corners instead (only differs on ambiguous faces)
      const n = crossings.length;
      const partner = connected
        ? crossings[(i - 1 + n) % n]
        : crossings[(i + 1) % n];
      nextEdge[edge] = partner.edge;
    });
  });

  const triangles: number[] = [];
  const centroidLoops: Int8Array[] = [];
  const visited = new Uint8Array(12);
  for (let start = 0; start < 12; start += 1) {
    if (nextEdge[start] < 0 || visited[start]) {
      continue;
    }

    const loop: number[] = [];
    let edge = start;
    while (!visited[edge]) {
      visited[edge] = 1;
      loop.push(edge);
      edge = nextEdge[edge];
    }

    // Segments keep the inside on their right when seen from outside the cube,
    // so loops are counter-clockwise when seen from the high side.
    if (loop.length < MIN_CENTROID_LOOP) {
      for (let i = 1; i < loop.length - 1; i += 1) {
        triangles.push(loop[0], loop[i], loop[i + 1]);
      }
    } else {
      // Long loops may cross a face twice; fanning them could then create a diagonal
      // that the neighbouring cell creates too. Fan around an extra centroid vertex instead.
      const centroid = CENTROID_BASE + centroidLoops.length;
      centroidLoops.push(Int8Array.from(loop));
      loop.forEach((e, i) => {
        triangles.push(centroid, e, loop[(i + 1) % loop.length]);
      });
    }
  }

  const result = { triangles: Int8Array.from(triangles), centroidLoops };
  triangleCache.set(key, result);
  return result;
}

/* Bilinear saddle value of a face given its corners in cyclic order */
function faceSaddleValue(a: number, b: number, c: number, d: number): number {
  const denom = a + c - b - d;
  return denom === 0 ? Number.NaN : (a * c - b * d) / denom;
}

/* Grid point indices sampled with a given stride, always including the last point */
export function getSampleIndices(size: number, step: number): Int32Array {
  const indices: number[] = [];
  for (let i = 0; i < size; i += step) {
    indices.push(i);
  }
  if (indices.at(-1) !== size - 1) {
    indices.push(size - 1);
  }
  return Int32Array.from(indices);
}

/* Sampled grid interval containing a position in units of sampled grid points */
function getSampleInterval(samples: Int32Array, pos: number): number {
  return Math.min(
    Math.max(Math.floor(pos), 0),
    Math.max(samples.length - 2, 0),
  );
}

/* Voxel index of a position in units of sampled grid points (cf. `getSampleIndices`) */
export function sampleToVoxel(samples: Int32Array, pos: number): number {
  const i = getSampleInterval(samples, pos);
  return samples[i] + (pos - i) * (samples[i + 1] - samples[i]);
}

/* Voxels between the sampled grid points around a position */
export function getSampleWidth(samples: Int32Array, pos: number): number {
  const i = getSampleInterval(samples, pos);
  return samples[i + 1] - samples[i];
}

/* Cells visited between progress reports (i.e. chances to cancel), whatever the shape of the volume */
const CELLS_PER_STEP = 1 << 16;

/* Crossings this close to a grid point are snapped to it, so vertices at grid values equal to the level are shared */
const SNAP_EPSILON = 1e-6;

export function* marchingCubesSteps(
  values: ArrayLike<number>,
  shape: [depth: number, rows: number, cols: number],
  level: number,
  opts: MarchingCubesOptions = {},
): Generator<number, IsosurfaceGeometry> {
  const [nz, ny, nx] = shape;
  const { step = 1, axisValues = [undefined, undefined, undefined] } = opts;
  const transform = getScaleTransform(opts.scaleType);

  const positions = new GrowableArray(Float32Array);
  const normals = new GrowableArray(Float32Array);
  const gradients = new GrowableArray(Float32Array);
  const indices = new GrowableArray(Uint32Array);

  function result(): IsosurfaceGeometry {
    return {
      level,
      positions: positions.toArray(),
      normals: normals.toArray(),
      gradients: gradients.toArray(),
      indices: indices.toArray(),
      step,
    };
  }

  if (nx < 2 || ny < 2 || nz < 2 || !transform.isValid(level)) {
    return result();
  }

  const xs = getSampleIndices(nx, step);
  const ys = getSampleIndices(ny, step);
  const zs = getSampleIndices(nz, step);
  const NX = xs.length;
  const NY = ys.length;
  const NZ = zs.length;

  const sliceSize = nx * ny;
  const { isValid } = transform;

  // Central differences over the sampled grid (one-sided at borders or next to invalid values)
  const [axisX, axisY, axisZ] = axisValues;
  const grad = new Float64Array(6); // index-space gradient, then per-unit gradient

  function axisDelta(
    axis: ArrayLike<number> | undefined,
    lo: number,
    hi: number,
  ): number {
    return axis ? axis[hi] - axis[lo] : hi - lo;
  }

  function partial(
    samples: Int32Array,
    s: number,
    axis: ArrayLike<number> | undefined,
    base: number,
    stride: number,
    out: number,
  ): void {
    const centre = values[base + samples[s] * stride];
    let lo = s > 0 ? samples[s - 1] : samples[s];
    let hi = s < samples.length - 1 ? samples[s + 1] : samples[s];
    let vLo = values[base + lo * stride];
    let vHi = values[base + hi * stride];
    if (!isValid(vLo)) {
      lo = samples[s];
      vLo = centre;
    }
    if (!isValid(vHi)) {
      hi = samples[s];
      vHi = centre;
    }
    if (hi === lo) {
      grad[out] = 0;
      grad[out + 3] = 0;
      return;
    }
    const diff = vHi - vLo;
    grad[out] = diff / (hi - lo);
    const delta = axisDelta(axis, lo, hi);
    grad[out + 3] = delta === 0 ? 0 : diff / delta;
  }

  function gradientAt(si: number, sj: number, sk: number): void {
    const i = xs[si];
    const j = ys[sj];
    const k = zs[sk];
    partial(xs, si, axisX, k * sliceSize + j * nx, 1, 0);
    partial(ys, sj, axisY, k * sliceSize + i, nx, 1);
    partial(zs, sk, axisZ, j * nx + i, sliceSize, 2);
  }

  let vertexCount = 0;
  const gA = new Float64Array(6);

  function pushNormalAndGradient(
    nxv: number,
    nyv: number,
    nzv: number,
    magnitude: number,
  ): void {
    const len = Math.hypot(nxv, nyv, nzv);
    if (len > 0) {
      normals.push(nxv / len);
      normals.push(nyv / len);
      normals.push(nzv / len);
    } else {
      normals.push(0);
      normals.push(0);
      normals.push(1);
    }
    gradients.push(magnitude);
    vertexCount += 1;
  }

  // Vertex on a grid point (sampled-grid indices), shared by all edges and cells around it
  let slab = 0;
  let cornersLower = new Int32Array(0);
  let cornersUpper = new Int32Array(0);

  function getCornerVertex(si: number, sj: number, sk: number): number {
    const store = sk === slab ? cornersLower : cornersUpper;
    const offset = sj * NX + si;
    if (store[offset] < 0) {
      positions.push(xs[si]);
      positions.push(ys[sj]);
      positions.push(zs[sk]);
      gradientAt(si, sj, sk);
      pushNormalAndGradient(
        grad[0],
        grad[1],
        grad[2],
        Math.hypot(grad[3], grad[4], grad[5]),
      );
      store[offset] = vertexCount - 1;
    }
    return store[offset];
  }

  // Interpolate the crossing on the edge between sampled grid points A and B
  function addVertex(
    ai: number,
    aj: number,
    ak: number,
    bi: number,
    bj: number,
    bk: number,
    va: number,
    vb: number,
  ): number {
    const t = crossingRatio(va, vb, level, transform.fn);
    if (t <= SNAP_EPSILON) {
      return getCornerVertex(ai, aj, ak);
    }
    if (t >= 1 - SNAP_EPSILON) {
      return getCornerVertex(bi, bj, bk);
    }

    positions.push(xs[ai] + t * (xs[bi] - xs[ai]));
    positions.push(ys[aj] + t * (ys[bj] - ys[aj]));
    positions.push(zs[ak] + t * (zs[bk] - zs[ak]));

    gradientAt(ai, aj, ak);
    gA.set(grad);
    gradientAt(bi, bj, bk);

    pushNormalAndGradient(
      gA[0] + t * (grad[0] - gA[0]),
      gA[1] + t * (grad[1] - gA[1]),
      gA[2] + t * (grad[2] - gA[2]),
      Math.hypot(
        gA[3] + t * (grad[3] - gA[3]),
        gA[4] + t * (grad[4] - gA[4]),
        gA[5] + t * (grad[5] - gA[5]),
      ),
    );
    return vertexCount - 1;
  }

  // Average of the vertices of a loop, shared by no other cell
  function addCentroid(loop: Int8Array, cellVerts: Int32Array): number {
    let px = 0;
    let py = 0;
    let pz = 0;
    let nxv = 0;
    let nyv = 0;
    let nzv = 0;
    let g = 0;
    for (const edge of loop) {
      const v = cellVerts[edge];
      px += positions.at(v * 3);
      py += positions.at(v * 3 + 1);
      pz += positions.at(v * 3 + 2);
      nxv += normals.at(v * 3);
      nyv += normals.at(v * 3 + 1);
      nzv += normals.at(v * 3 + 2);
      g += gradients.at(v);
    }
    const count = loop.length;
    positions.push(px / count);
    positions.push(py / count);
    positions.push(pz / count);
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    normals.push(nxv / len);
    normals.push(nyv / len);
    normals.push(nzv / len);
    gradients.push(g / count);
    vertexCount += 1;
    return vertexCount - 1;
  }

  // Skip triangles collapsed by snapping (two corners on the same vertex)
  function pushTriangle(a: number, b: number, c: number): void {
    if (a !== b && b !== c && a !== c) {
      indices.push(a);
      indices.push(b);
      indices.push(c);
    }
  }

  // Welded vertex indices for x/y edges on the lower and upper planes of the current slab, and z edges between them
  const planeSize = NX * NY;
  let xLower = new Int32Array(planeSize).fill(-1);
  let xUpper = new Int32Array(planeSize).fill(-1);
  let yLower = new Int32Array(planeSize).fill(-1);
  let yUpper = new Int32Array(planeSize).fill(-1);
  const zEdges = new Int32Array(planeSize);
  cornersLower = new Int32Array(planeSize).fill(-1);
  cornersUpper = new Int32Array(planeSize).fill(-1);
  let cellsSinceYield = 0;

  const cornerValues = new Float64Array(8);
  const cornerOffsets = new Int32Array(8);
  const yOffsets = new Int32Array(2);
  const zOffsets = new Int32Array(2);
  const cellVertices = new Int32Array(CENTROID_BASE + 2); // at most two long loops per cell

  for (let sk = 0; sk < NZ - 1; sk += 1) {
    zEdges.fill(-1);
    slab = sk;

    zOffsets[0] = zs[sk] * sliceSize;
    zOffsets[1] = zs[sk + 1] * sliceSize;

    for (let sj = 0; sj < NY - 1; sj += 1) {
      yOffsets[0] = ys[sj] * nx;
      yOffsets[1] = ys[sj + 1] * nx;

      // Report progress by number of cells, so wide and shallow volumes can be cancelled too
      cellsSinceYield += NX - 1;
      if (cellsSinceYield >= CELLS_PER_STEP) {
        cellsSinceYield = 0;
        yield (sk + sj / (NY - 1)) / (NZ - 1);
      }

      for (let si = 0; si < NX - 1; si += 1) {
        let caseIndex = 0;
        let invalid = false;
        cornerOffsets[0] = zOffsets[0] + yOffsets[0] + xs[si];
        cornerOffsets[1] = zOffsets[0] + yOffsets[0] + xs[si + 1];
        cornerOffsets[2] = zOffsets[0] + yOffsets[1] + xs[si];
        cornerOffsets[3] = zOffsets[0] + yOffsets[1] + xs[si + 1];
        cornerOffsets[4] = zOffsets[1] + yOffsets[0] + xs[si];
        cornerOffsets[5] = zOffsets[1] + yOffsets[0] + xs[si + 1];
        cornerOffsets[6] = zOffsets[1] + yOffsets[1] + xs[si];
        cornerOffsets[7] = zOffsets[1] + yOffsets[1] + xs[si + 1];
        for (let n = 0; n < 8; n += 1) {
          const val = values[cornerOffsets[n]];
          if (!isValid(val)) {
            invalid = true;
            break;
          }
          cornerValues[n] = val;
          if (val < level) {
            caseIndex |= 1 << n;
          }
        }

        if (invalid || caseIndex === 0 || caseIndex === 255) {
          continue;
        }

        let connectedFaces = 0;
        for (const f of AMBIGUOUS_FACES[caseIndex]) {
          const [c0, c1, c2, c3] = CUBE_FACES[f];
          const saddle = faceSaddleValue(
            cornerValues[c0],
            cornerValues[c1],
            cornerValues[c2],
            cornerValues[c3],
          );
          // Inside corners are connected when the saddle point is itself inside
          if (saddle < level) {
            connectedFaces |= 1 << f;
          }
        }

        const { triangles, centroidLoops } = getCaseTriangles(
          caseIndex,
          connectedFaces,
        );
        const p = sj * NX + si;

        cellVertices.fill(-1);
        for (const edge of triangles) {
          if (edge >= CENTROID_BASE || cellVertices[edge] >= 0) {
            continue;
          }

          const [ca, cb] = CUBE_EDGES[edge];
          let store: Int32Array;
          let offset: number;
          if (edge < 4) {
            store = edge < 2 ? xLower : xUpper;
            offset = p + (edge % 2) * NX;
          } else if (edge < 8) {
            store = edge < 6 ? yLower : yUpper;
            offset = p + (edge % 2);
          } else {
            store = zEdges;
            offset = p + ((edge - 8) % 2) + Math.floor((edge - 8) / 2) * NX;
          }

          if (store[offset] < 0) {
            store[offset] = addVertex(
              si + (ca & 1),
              sj + ((ca >> 1) & 1),
              sk + ((ca >> 2) & 1),
              si + (cb & 1),
              sj + ((cb >> 1) & 1),
              sk + ((cb >> 2) & 1),
              cornerValues[ca],
              cornerValues[cb],
            );
          }
          cellVertices[edge] = store[offset];
        }

        centroidLoops.forEach((loop, i) => {
          cellVertices[CENTROID_BASE + i] = addCentroid(loop, cellVertices);
        });

        for (let t = 0; t < triangles.length; t += 3) {
          pushTriangle(
            cellVertices[triangles[t]],
            cellVertices[triangles[t + 1]],
            cellVertices[triangles[t + 2]],
          );
        }
      }
    }

    [xLower, xUpper] = [xUpper, xLower];
    [yLower, yUpper] = [yUpper, yLower];
    [cornersLower, cornersUpper] = [cornersUpper, cornersLower];
    xUpper.fill(-1);
    yUpper.fill(-1);
    cornersUpper.fill(-1);
  }

  return result();
}

export function marchingCubes(
  values: ArrayLike<number>,
  shape: [depth: number, rows: number, cols: number],
  level: number,
  opts?: MarchingCubesOptions,
): IsosurfaceGeometry {
  const gen = marchingCubesSteps(values, shape, level, opts);
  let res = gen.next();
  while (!res.done) {
    res = gen.next();
  }
  return res.value;
}

/* Smallest grid stride that keeps the number of cells within budget */
export function getDecimationStep(
  shape: [number, number, number],
  cellBudget: number,
): number {
  function countCells(step: number): number {
    return shape.reduce(
      (acc, size) => acc * Math.max(Math.ceil((size - 1) / step), 1),
      1,
    );
  }

  let step = 1;
  while (countCells(step) > cellBudget && step < Math.max(...shape)) {
    step += 1;
  }
  return step;
}
