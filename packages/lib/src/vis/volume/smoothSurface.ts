/* eslint-disable no-bitwise, no-param-reassign, complexity, max-depth, unicorn/prefer-switch -- in-place filters and outputs, tight loops */
import {
  type AxisCoords,
  type DataValues,
  type ScaleTypeParam,
} from '../geometry-worker/models';
import { getScaleTransform } from '../geometry-worker/scale';
import {
  getSampleIndices,
  getSampleWidth,
  type IsosurfaceGeometry,
  marchingCubesSteps,
  sampleToVoxel,
} from './marchingCubes';
import { type Samples } from './passRegion';

/*
 * Smooth isosurfaces: marching cubes places vertices by linear interpolation along cell edges, so
 * on coarse grids curved surfaces become polyhedra. Here, surfaces follow the cubic B-spline that
 * interpolates the samples (Thévenaz, Blu & Unser, "Interpolation revisited", 2000): vertices are
 * moved onto its level set, then edges spanning curved parts of it are split, with their midpoints
 * moved onto it too.
 * Coordinates are in units of sampled grid points (cf. `getSampleIndices`), `[x, y, z]`.
 */

export interface Spline {
  coeffs: Float32Array; // over the grid extended by `PAD` samples on every side
  shape: [number, number, number]; // sampled grid points along z, y and x
  blocked: Uint8Array; // grid points within reach of an invalid sample, where the spline isn't used
}

const POLE = Math.sqrt(3) - 2;
const PAD = 3;
const HORIZON = Math.ceil(Math.log(1e-9) / Math.log(-POLE)); // samples that matter to the first coefficient

/* Cubic B-spline coefficients of a line of samples (in place), mirrored at both ends */
function prefilterLine(c: Float64Array, n: number): void {
  if (n < 2) {
    return;
  }
  const z = POLE;
  for (let k = 0; k < n; k += 1) {
    c[k] *= 6; // (1 - z) (1 - 1/z)
  }

  let [sum] = c;
  if (n > HORIZON) {
    let zn = z;
    for (let k = 1; k < HORIZON; k += 1) {
      sum += zn * c[k];
      zn *= z;
    }
  } else {
    let zn = z;
    let z2n = z ** (n - 1);
    sum += z2n * c[n - 1];
    z2n *= z2n / z;
    for (let k = 1; k < n - 1; k += 1) {
      sum += (zn + z2n) * c[k];
      zn *= z;
      z2n /= z;
    }
    sum /= 1 - zn * zn;
  }

  c[0] = sum;
  for (let k = 1; k < n; k += 1) {
    c[k] += z * c[k - 1];
  }
  c[n - 1] = (z / (z * z - 1)) * (z * c[n - 2] + c[n - 1]);
  for (let k = n - 2; k >= 0; k -= 1) {
    c[k] = z * (c[k + 1] - c[k]);
  }
}

/* Apply `fn` to every line of a `[z][y][x]` array along each axis */
function forEachLine(
  shape: [number, number, number],
  fn: (start: number, stride: number, n: number) => void,
): void {
  const [nz, ny, nx] = shape;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      fn((k * ny + j) * nx, 1, nx);
    }
    for (let i = 0; i < nx; i += 1) {
      fn(k * ny * nx + i, nx, ny);
    }
  }
  for (let p = 0; p < ny * nx; p += 1) {
    fn(p, ny * nx, nz);
  }
}

/*
 * Interpolating spline of grid values (`[z][y][x]`); non-finite values are invalid: they are
 * filled with the mean of their valid neighbors (or `fill`), and the spline isn't used near them.
 */
export function getSpline(
  grid: Float64Array,
  shape: [number, number, number],
  fill: number,
): Spline {
  const [nz, ny, nx] = shape;
  const values = Float64Array.from(grid);
  const blocked = new Uint8Array(values.length);
  grid.forEach((val, p) => {
    if (Number.isFinite(val)) {
      return;
    }
    blocked[p] = 1;
    const i = p % nx;
    const j = Math.floor(p / nx) % ny;
    const k = Math.floor(p / (nx * ny));
    const neighbors = [
      i > 0 ? p - 1 : -1,
      i < nx - 1 ? p + 1 : -1,
      j > 0 ? p - nx : -1,
      j < ny - 1 ? p + nx : -1,
      k > 0 ? p - nx * ny : -1,
      k < nz - 1 ? p + nx * ny : -1,
    ].filter((q) => q >= 0 && Number.isFinite(grid[q]));
    values[p] =
      neighbors.length > 0
        ? neighbors.reduce((acc, q) => acc + grid[q], 0) / neighbors.length
        : fill;
  });

  // Extend the grid linearly by a few samples, so that mirroring them doesn't flatten the spline at the faces
  const padded = shape.map((n) => n + 2 * PAD) as [number, number, number];
  const coeffs = new Float64Array(padded[0] * padded[1] * padded[2]);
  values.forEach((val, p) => {
    const [i, j, k] = [
      p % nx,
      Math.floor(p / nx) % ny,
      Math.floor(p / (nx * ny)),
    ];
    coeffs[((k + PAD) * padded[1] + j + PAD) * padded[2] + i + PAD] = val;
  });

  const line = new Float64Array(Math.max(...padded));
  forEachLine(padded, (start, stride, n) => {
    for (let k = 0; k < n; k += 1) {
      line[k] = coeffs[start + k * stride];
    }
    const [lo, hi] = [PAD, n - PAD - 1];
    const slope =
      hi > lo ? [line[lo] - line[lo + 1], line[hi] - line[hi - 1]] : [0, 0];
    for (let d = 1; d <= PAD; d += 1) {
      line[lo - d] = line[lo] + d * slope[0];
      line[hi + d] = line[hi] + d * slope[1];
    }
    prefilterLine(line, n);
    for (let k = 0; k < n; k += 1) {
      coeffs[start + k * stride] = line[k];
    }
  });

  // Block grid points within two samples of an invalid one (max filter), i.e. whose spline support reaches it
  const mask = new Uint8Array(Math.max(...shape));
  forEachLine(shape, (start, stride, n) => {
    for (let k = 0; k < n; k += 1) {
      mask[k] = blocked[start + k * stride];
    }
    for (let k = 0; k < n; k += 1) {
      for (let d = Math.max(k - 2, 0); d <= Math.min(k + 2, n - 1); d += 1) {
        blocked[start + k * stride] |= mask[d];
      }
    }
  });

  return { coeffs: Float32Array.from(coeffs), shape, blocked };
}

const weights = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
const derivs = [new Float64Array(4), new Float64Array(4), new Float64Array(4)];
const offsets = [new Int32Array(4), new Int32Array(4), new Int32Array(4)];

/*
 * Value and gradient of the spline at `p` (`[x, y, z]`, clamped to the grid) into `out`
 * (`[s, ∂x, ∂y, ∂z]`); `false` near invalid samples (where it follows filled values).
 */
export function evaluateSpline(
  spline: Spline,
  p: ArrayLike<number>,
  out: Float64Array,
): boolean {
  const { coeffs, shape, blocked } = spline;
  const sizes = [shape[2], shape[1], shape[0]];
  const strides = [1, shape[2], shape[2] * shape[1]];
  const paddedStrides = [
    1,
    shape[2] + 2 * PAD,
    (shape[2] + 2 * PAD) * (shape[1] + 2 * PAD),
  ];
  let nearest = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const n = sizes[axis];
    const x = Math.min(Math.max(p[axis], 0), n - 1);
    const i = Math.min(Math.floor(x), Math.max(n - 2, 0));
    const t = x - i;
    const s = 1 - t;
    const w = weights[axis];
    const d = derivs[axis];
    w[0] = (s * s * s) / 6;
    w[1] = 2 / 3 - t * t + (t * t * t) / 2;
    w[2] = 1 / 6 + (t + t * t - t * t * t) / 2;
    w[3] = (t * t * t) / 6;
    d[0] = (-s * s) / 2;
    d[1] = -2 * t + 1.5 * t * t;
    d[2] = 0.5 + t - 1.5 * t * t;
    d[3] = (t * t) / 2;
    for (let a = 0; a < 4; a += 1) {
      offsets[axis][a] = (i - 1 + a + PAD) * paddedStrides[axis];
    }
    nearest += Math.round(x) * strides[axis];
  }
  const [wx, wy, wz] = weights;
  const [dx, dy, dz] = derivs;
  const [ox, oy, oz] = offsets;
  let val = 0;
  let gx = 0;
  let gy = 0;
  let gz = 0;
  for (let c = 0; c < 4; c += 1) {
    for (let b = 0; b < 4; b += 1) {
      const row = oz[c] + oy[b];
      let sx = 0;
      let sd = 0;
      for (let a = 0; a < 4; a += 1) {
        const coeff = coeffs[row + ox[a]];
        sx += wx[a] * coeff;
        sd += dx[a] * coeff;
      }
      val += wy[b] * wz[c] * sx;
      gx += wy[b] * wz[c] * sd;
      gy += dy[b] * wz[c] * sx;
      gz += wy[b] * dz[c] * sx;
    }
  }
  out[0] = val;
  out[1] = gx;
  out[2] = gy;
  out[3] = gz;
  return blocked[nearest] === 0;
}

/* Values at the sampled grid points, mapped by `fn` */
export function sampleGrid(
  values: DataValues,
  shape: number[],
  samples: Samples,
  fn: (val: number) => number,
): Float64Array {
  const [, ny, nx] = shape;
  const [zs, ys, xs] = samples;
  const grid = new Float64Array(zs.length * ys.length * xs.length);
  let p = 0;
  for (const z of zs) {
    for (const y of ys) {
      for (const x of xs) {
        grid[p] = fn(values[(z * ny + y) * nx + x]);
        p += 1;
      }
    }
  }
  return grid;
}

/* Progress of a step of a job (`gen`), mapped to `[start, start + span]` */
export function* withProgress<T>(
  gen: Generator<number, T>,
  start: number,
  span: number,
): Generator<number, T> {
  let res = gen.next();
  while (!res.done) {
    yield start + res.value * span;
    res = gen.next();
  }
  return res.value;
}

const MAX_ITERATIONS = 8;
const TOLERANCE = 1e-4; // distance to the level set, in samples (estimated as |f| / |∇f|)
const VERTEX_REACH = 0.5; // farthest a vertex of marching cubes is moved, in samples
const MAX_DEPTH = 3; // times an edge can be split
const MAX_SAG = 0.02; // distance between an edge and the arc of the surface above it, in samples
const MIN_EDGE = 0.05; // in samples
const MAX_GROWTH = 2; // at most this many times the triangles of marching cubes (on the upsampled grid)

/* Map the spline's value and gradient (`[s, ∂x, ∂y, ∂z]`) to those of a field whose level 0 is the surface, in place */
type LevelField = (out: Float64Array) => void;

/*
 * Move the vertices of a surface (positions minus `offset` in samples) onto the level 0 of a field
 * of the spline, along its gradient, and split edges where the surface curves, keeping the mesh
 * conforming. Vertices beyond the grid (i.e. on caps) stay, and those on a face of the grid stay on it.
 */
export function* smoothSurfaceSteps(
  geometry: IsosurfaceGeometry,
  spline: Spline,
  toField: LevelField,
  offset = 0,
): Generator<number, IsosurfaceGeometry> {
  const [nz, ny, nx] = spline.shape;
  const last = [nx - 1, ny - 1, nz - 1];

  // Each split vertex adds at least one triangle, within budget (cf. below)
  const maxTriangles = (MAX_GROWTH * geometry.indices.length) / 3;
  const capacity = geometry.gradients.length + maxTriangles;
  const positions = new Float64Array(capacity * 3);
  positions.set(geometry.positions);
  positions.subarray(0, geometry.positions.length).forEach((val, i) => {
    positions[i] = val - offset;
  });
  const normals = new Float32Array(capacity * 3);
  normals.set(geometry.normals);
  const gradients = new Float32Array(capacity);
  gradients.set(geometry.gradients);
  let vertexCount = geometry.gradients.length;
  let { indices } = geometry;

  const p = new Float64Array(3);
  const start = new Float64Array(3);
  const out = new Float64Array(4);
  const g = new Float64Array(3);

  function evaluate(): boolean {
    const isValid = evaluateSpline(spline, p, out);
    toField(out);
    return isValid && Number.isFinite(out[0]);
  }

  // Newton steps x ← x - f(x) ∇f / |∇f|², within `reach` of the vertex; kept in place if they don't converge
  function project(v: number, reach: number): boolean {
    let fixed = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const x = positions[v * 3 + axis];
      if (x < 0 || x > last[axis]) {
        return false;
      }
      fixed |= x === 0 || x === last[axis] ? 1 << axis : 0;
      p[axis] = x;
      start[axis] = x;
    }

    for (let iter = 0; evaluate(); iter += 1) {
      const [diff] = out;
      for (let axis = 0; axis < 3; axis += 1) {
        g[axis] = fixed & (1 << axis) ? 0 : out[axis + 1];
      }
      const g2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (Math.abs(diff) <= TOLERANCE * Math.sqrt(g2)) {
        const len = Math.hypot(out[1], out[2], out[3]);
        const dot =
          out[1] * normals[v * 3] +
          out[2] * normals[v * 3 + 1] +
          out[3] * normals[v * 3 + 2];
        if (dot <= 0) {
          return false; // jumped to another sheet
        }
        for (let axis = 0; axis < 3; axis += 1) {
          positions[v * 3 + axis] = p[axis];
          normals[v * 3 + axis] = out[axis + 1] / len;
        }
        return true;
      }
      if (iter === MAX_ITERATIONS || g2 === 0) {
        return false;
      }

      for (let axis = 0; axis < 3; axis += 1) {
        p[axis] -= (diff * g[axis]) / g2;
      }
      const dist = Math.hypot(
        p[0] - start[0],
        p[1] - start[1],
        p[2] - start[2],
      );
      for (let axis = 0; axis < 3; axis += 1) {
        if (dist > reach) {
          p[axis] = start[axis] + ((p[axis] - start[axis]) * reach) / dist;
        }
        p[axis] = Math.min(Math.max(p[axis], 0), last[axis]);
      }
    }
    return false;
  }

  for (let v = 0; v < vertexCount; v += 1) {
    project(v, VERTEX_REACH);
    if (v % 4096 === 4095) {
      yield (v / vertexCount) * 0.5;
    }
  }

  function dist2(a: number, b: number): number {
    return (
      (positions[a * 3] - positions[b * 3]) ** 2 +
      (positions[a * 3 + 1] - positions[b * 3 + 1]) ** 2 +
      (positions[a * 3 + 2] - positions[b * 3 + 2]) ** 2
    );
  }

  // Triangles lying on a face of the grid (e.g. caps) are flat: their edges get split only for neighbors
  function isFlat(a: number, b: number, c: number): boolean {
    for (let axis = 0; axis < 3; axis += 1) {
      const xa = positions[a * 3 + axis];
      const xb = positions[b * 3 + axis];
      const xc = positions[c * 3 + axis];
      const max = last[axis];
      if (
        (xa <= 0 && xb <= 0 && xc <= 0) ||
        (xa >= max && xb >= max && xc >= max)
      ) {
        return true;
      }
    }
    return false;
  }

  // Distance between an edge and an arc between its vertices, along their normals
  function getSag(a: number, b: number): number {
    const len = Math.sqrt(dist2(a, b));
    let dot = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      dot += normals[a * 3 + axis] * normals[b * 3 + axis];
    }
    const angle = Math.acos(Math.min(Math.max(dot, -1), 1));
    return len > MIN_EDGE ? (len * angle) / 8 : 0;
  }

  // Midpoint of an edge (moved up to the edge's length, e.g. onto a tight fold), or -1 if the surface isn't found near it
  function addMidpoint(a: number, b: number): number {
    const m = vertexCount;
    let len = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      positions[m * 3 + axis] =
        (positions[a * 3 + axis] + positions[b * 3 + axis]) / 2;
      normals[m * 3 + axis] = normals[a * 3 + axis] + normals[b * 3 + axis];
      len += normals[m * 3 + axis] ** 2;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      normals[m * 3 + axis] /= Math.sqrt(len) || 1;
    }
    gradients[m] = (gradients[a] + gradients[b]) / 2;
    if (m === capacity || !project(m, Math.sqrt(dist2(a, b)))) {
      return -1;
    }
    vertexCount += 1;
    return m;
  }

  let next = new Uint32Array(0);
  let length = 0;
  function addTriangle(a: number, b: number, c: number): void {
    next[length] = a;
    next[length + 1] = b;
    next[length + 2] = c;
    length += 3;
  }

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    // Edges `a < b`, listed by `a` (`others[first[a]..first[a + 1]]`) and identified by their first slot
    const first = new Int32Array(vertexCount + 1);
    for (let t = 0; t < indices.length; t += 1) {
      const [a, b] = [indices[t], indices[t % 3 === 2 ? t - 2 : t + 1]];
      first[Math.min(a, b) + 1] += 1;
    }
    for (let a = 0; a < vertexCount; a += 1) {
      first[a + 1] += first[a];
    }
    const others = new Int32Array(indices.length);
    const filled = first.slice(0, vertexCount);
    for (let t = 0; t < indices.length; t += 1) {
      const [a, b] = [indices[t], indices[t % 3 === 2 ? t - 2 : t + 1]];
      const lo = Math.min(a, b);
      others[filled[lo]] = Math.max(a, b);
      filled[lo] += 1;
    }

    // Flag edges by whether they bound flat triangles (1) or others (2)
    const flags = new Uint8Array(indices.length);
    for (let t = 0; t < indices.length; t += 3) {
      const flag = isFlat(indices[t], indices[t + 1], indices[t + 2]) ? 1 : 2;
      for (let e = 0; e < 3; e += 1) {
        flags[
          findEdge(first, others, indices[t + e], indices[t + ((e + 1) % 3)])
        ] |= flag;
      }
    }

    // Split the edges that sag most, within budget (each split adds a triangle on either side)
    const sags = new Float64Array(indices.length);
    for (let a = 0; a < vertexCount; a += 1) {
      for (let k = first[a]; k < first[a + 1]; k += 1) {
        sags[k] = flags[k] & 2 ? getSag(a, others[k]) : 0;
      }
    }
    const budget = Math.floor((maxTriangles - indices.length / 3) / 2);
    const sorted = sags.filter((sag) => sag > MAX_SAG).sort();
    if (sorted.length === 0 || budget <= 0) {
      break;
    }
    const minSag = Math.max(
      sorted[Math.max(sorted.length - budget, 0)],
      MAX_SAG,
    );
    const mids = new Int32Array(indices.length).fill(-1);
    const count = vertexCount;
    let splitCount = 0; // within budget even when sags tie at `minSag`
    for (let a = 0; a < count && splitCount < budget; a += 1) {
      for (let k = first[a]; k < first[a + 1] && splitCount < budget; k += 1) {
        if (sags[k] >= minSag) {
          mids[k] = addMidpoint(a, others[k]);
          splitCount += mids[k] >= 0 ? 1 : 0;
        }
      }
    }

    // Split each triangle along its split edges (keeping its winding), so that neighbors share midpoints
    next = new Uint32Array(maxTriangles * 3);
    length = 0;
    const v = [0, 0, 0];
    const split = [0, 0, 0];
    for (let t = 0; t < indices.length; t += 3) {
      let splits = 0;
      for (let e = 0; e < 3; e += 1) {
        v[e] = indices[t + e];
      }
      for (let e = 0; e < 3; e += 1) {
        split[e] = mids[findEdge(first, others, v[e], v[(e + 1) % 3])];
        splits += split[e] >= 0 ? 1 : 0;
      }
      if (splits === 0) {
        addTriangle(v[0], v[1], v[2]);
      } else if (splits === 3) {
        addTriangle(v[0], split[0], split[2]);
        addTriangle(split[0], v[1], split[1]);
        addTriangle(split[2], split[1], v[2]);
        addTriangle(split[0], split[1], split[2]);
      } else if (splits === 1) {
        const r = split.findIndex((m) => m >= 0); // edge a-b
        const [a, b, c] = [v[r], v[(r + 1) % 3], v[(r + 2) % 3]];
        addTriangle(a, split[r], c);
        addTriangle(split[r], b, c);
      } else {
        const r = (split.indexOf(-1) + 1) % 3; // edge c-a is whole, quad split along its shorter diagonal
        const [a, b, c] = [v[r], v[(r + 1) % 3], v[(r + 2) % 3]];
        const [mab, mbc] = [split[r], split[(r + 1) % 3]];
        addTriangle(mab, b, mbc);
        if (dist2(a, mbc) < dist2(mab, c)) {
          addTriangle(a, mab, mbc);
          addTriangle(a, mbc, c);
        } else {
          addTriangle(a, mab, c);
          addTriangle(mab, mbc, c);
        }
      }
    }
    indices = next.slice(0, length);
    yield 0.5 + ((depth + 1) / MAX_DEPTH) * 0.5;
  }

  return {
    ...geometry,
    positions: Float32Array.from(
      positions.subarray(0, vertexCount * 3),
      (val) => val + offset,
    ),
    normals: normals.slice(0, vertexCount * 3),
    gradients: gradients.slice(0, vertexCount),
    indices,
  };
}

/* Slot of edge `a-b` among the edges listed by their lower vertex (cf. `smoothSurfaceSteps`) */
function findEdge(
  first: Int32Array,
  others: Int32Array,
  a: number,
  b: number,
): number {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  let k = first[lo];
  while (others[k] !== hi) {
    k += 1;
  }
  return k;
}

/* Elements between consecutive indices along dimension `a` */
function getStride(sizes: number[], a: number): number {
  return sizes.slice(a + 1).reduce((acc, size) => acc * size, 1);
}

/* Values of the spline along one axis of a `[z][y][x]` array (0 for z) at its `n` grid points and halfway between them */
function upsampleAxis(
  src: Float64Array,
  dims: number[],
  axis: number,
  n: number,
): { data: Float64Array; dims: number[] } {
  const outDims = dims.map((size, a) => (a === axis ? 2 * n - 1 : size));
  const [u, w] = [0, 1, 2].filter((a) => a !== axis);
  const data = new Float64Array(outDims[0] * outDims[1] * outDims[2]);
  const [srcStride, srcU, srcW] = [axis, u, w].map((a) => getStride(dims, a));
  const [dstStride, dstU, dstW] = [axis, u, w].map((a) =>
    getStride(outDims, a),
  );
  for (let ku = 0; ku < dims[u]; ku += 1) {
    for (let kw = 0; kw < dims[w]; kw += 1) {
      const from = ku * srcU + kw * srcW;
      const to = ku * dstU + kw * dstW;
      for (let k = 0; k < 2 * n - 1; k += 1) {
        const c = from + ((k >> 1) + PAD) * srcStride;
        const c0 = src[c - srcStride];
        const c1 = src[c];
        const c2 = src[c + srcStride];
        data[to + k * dstStride] =
          k % 2 === 0
            ? (c0 + 4 * c1 + c2) / 6
            : (c0 + 23 * (c1 + c2) + src[c + 2 * srcStride]) / 48;
      }
    }
  }
  return { data, dims: outDims };
}

/*
 * Spline at the grid points and halfway between them, for marching cubes to follow its topology;
 * near invalid samples, mean of the samples around (NaN next to them), as without smoothing.
 */
function upsampleSpline(
  spline: Spline,
  grid: Float64Array,
): { data: Float32Array; shape: [number, number, number] } {
  const { shape, blocked } = spline;
  let res: { data: Float64Array; dims: number[] } = {
    data: Float64Array.from(spline.coeffs),
    dims: shape.map((n) => n + 2 * PAD),
  };
  for (const axis of [2, 1, 0]) {
    res = upsampleAxis(res.data, res.dims, axis, shape[axis]);
  }
  const data = Float32Array.from(res.data);
  const [fz, fy, fx] = res.dims;
  if (blocked.includes(1)) {
    const [, ny, nx] = shape;
    for (let fk = 0; fk < fz; fk += 1) {
      for (let fj = 0; fj < fy; fj += 1) {
        for (let fi = 0; fi < fx; fi += 1) {
          const nearest =
            (Math.round(fk / 2) * ny + Math.round(fj / 2)) * nx +
            Math.round(fi / 2);
          if (blocked[nearest]) {
            let sum = 0;
            for (const k of [fk >> 1, (fk + 1) >> 1]) {
              for (const j of [fj >> 1, (fj + 1) >> 1]) {
                const row = (k * ny + j) * nx;
                sum += grid[row + (fi >> 1)] + grid[row + ((fi + 1) >> 1)];
              }
            }
            data[(fk * fy + fj) * fx + fi] = sum / 8;
          }
        }
      }
    }
  }
  return { data, shape: [fz, fy, fx] };
}

/* Spline of a scale's transform of the data, and its upsampled grid, relative to a reference value (their mean) */
export interface SmoothField {
  spline: Spline;
  fine: { data: Float32Array; shape: [number, number, number] };
  ref: number; // subtracted before narrowing to 32 bits, so that small variations on large values remain
  samples: Samples;
}

/* Fields of the most recent scales and strides, per data array (e.g. for several levels) */
const fieldCache = new WeakMap<DataValues, Map<string, SmoothField>>();
const FIELDS_PER_ARRAY = 2;

export function getSmoothField(
  values: DataValues,
  shape: [number, number, number],
  scaleType: ScaleTypeParam,
  step: number,
): SmoothField {
  const key = `${JSON.stringify(scaleType ?? null)}|${step}`;
  const cache = fieldCache.get(values) ?? new Map<string, SmoothField>();
  fieldCache.set(values, cache);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const samples = shape.map((n) => getSampleIndices(n, step)) as Samples;
  const { fn, isValid } = getScaleTransform(scaleType);
  const grid = sampleGrid(values, shape, samples, (val) =>
    isValid(val) ? fn(val) : Number.NaN,
  );
  const valid = grid.filter(Number.isFinite);
  const ref = valid.reduce((acc, val) => acc + val, 0) / (valid.length || 1);
  grid.forEach((val, i) => {
    grid[i] = val - ref;
  });
  const spline = getSpline(
    grid,
    samples.map((s) => s.length) as [number, number, number],
    0,
  );
  const field = { spline, fine: upsampleSpline(spline, grid), ref, samples };

  cache.set(key, field);
  if (cache.size > FIELDS_PER_ARRAY) {
    const [oldest] = cache.keys();
    cache.delete(oldest);
  }
  return field;
}

/*
 * Gradient magnitudes of the data at the vertices of a surface of the spline (positions in
 * samples), per voxel or along the axes' coordinates (cf. `marchingCubesSteps`); `slope` is the
 * derivative of the scale's transform at the level, to undo it.
 */
function getGradients(
  positions: Float32Array,
  spline: Spline,
  samples: Samples,
  axisValues: AxisCoords,
  slope: number,
): Float32Array {
  const idx = [samples[2], samples[1], samples[0]];
  const out = new Float64Array(4);
  const p = new Float64Array(3);
  const gradients = new Float32Array(positions.length / 3);
  for (let v = 0; v < gradients.length; v += 1) {
    p.set(positions.subarray(v * 3, v * 3 + 3));
    evaluateSpline(spline, p, out);
    let sum = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const s = idx[axis];
      const width = getSampleWidth(s, p[axis]);
      const coords = axisValues[axis];
      const j = Math.min(
        Math.floor(sampleToVoxel(s, p[axis])),
        s[s.length - 1] - 1,
      );
      const delta = coords ? coords[j + 1] - coords[j] : 1;
      sum += delta === 0 ? 0 : (out[axis + 1] / width / delta) ** 2;
    }
    gradients[v] = Math.sqrt(sum) / slope;
  }
  return gradients;
}

/* Map positions and normals from sampled grid points to voxel indices along each axis */
function toVoxels(
  geometry: IsosurfaceGeometry,
  samples: Samples,
): IsosurfaceGeometry {
  const idx = [samples[2], samples[1], samples[0]];
  const positions = Float32Array.from(geometry.positions);
  const normals = Float32Array.from(geometry.normals);
  for (let v = 0; v < positions.length; v += 3) {
    idx.forEach((s, axis) => {
      const x = positions[v + axis];
      positions[v + axis] = sampleToVoxel(s, x);
      normals[v + axis] /= getSampleWidth(s, x); // gradient per voxel
    });
    const len = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    for (let axis = 0; axis < 3; axis += 1) {
      normals[v + axis] /= len;
    }
  }
  return { ...geometry, positions, normals };
}

/* Derivative of a scale's transform at a value, one-sided at the edge of its domain (e.g. sqrt at 0) */
function getSlope(scaleType: ScaleTypeParam, val: number): number {
  const { fn, isValid } = getScaleTransform(scaleType);
  const h = Math.abs(val) * 1e-6 || 1e-6;
  const [lo, hi] = [val - h, val + h].map((x) => (isValid(x) ? x : val));
  const slope = (fn(hi) - fn(lo)) / (hi - lo);
  return Number.isFinite(slope) && slope > 0 ? slope : 1;
}

/*
 * Smooth isosurface of grid points sampled with a stride, in the scale's space: marching cubes on
 * the spline upsampled by 2 (so that the surface has the topology of the spline's, e.g. at thin
 * folds that cells of the grid miss), then moved onto the spline's level set and refined.
 */
export function* smoothIsosurfaceSteps(
  values: DataValues,
  shape: [number, number, number],
  axisValues: AxisCoords,
  level: number,
  scaleType: ScaleTypeParam,
  step: number,
): Generator<number, IsosurfaceGeometry> {
  const { spline, fine, ref, samples } = getSmoothField(
    values,
    shape,
    scaleType,
    step,
  );
  const { fn, isValid } = getScaleTransform(scaleType);
  const relLevel = isValid(level) ? fn(level) - ref : Number.NaN;
  const gen = marchingCubesSteps(fine.data, fine.shape, relLevel);
  const geometry = yield* withProgress(gen, 0, 0.5);
  const positions = geometry.positions.map((val) => val / 2);

  const smoothed = yield* withProgress(
    smoothSurfaceSteps({ ...geometry, positions }, spline, (out) => {
      out[0] -= relLevel;
    }),
    0.5,
    0.5,
  );
  const gradients = getGradients(
    smoothed.positions,
    spline,
    samples,
    axisValues,
    getSlope(scaleType, level),
  );
  return { ...toVoxels(smoothed, samples), gradients, level, step };
}
