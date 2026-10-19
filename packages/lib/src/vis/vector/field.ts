import { type Domain, type NumArray } from '@h5web/shared/vis-models';

/* Vector field sampled on a (possibly non-uniform) rectilinear grid: components are row-major
 * (index `(k * ny + j) * nx + i`), axes give the sample positions, ascending or descending */
export interface VectorField2D {
  xs: NumArray; // nx sample positions along x
  ys: NumArray; // ny sample positions along y
  u: NumArray; // ny * nx
  v: NumArray;
}

export interface VectorField3D extends VectorField2D {
  zs: NumArray; // nz sample positions along z
  w: NumArray; // nz * ny * nx
}

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/* Index `i` of the interval `[xs[i], xs[i + 1]]` containing `x`, and the position `t` in it;
 * `undefined` outside the axis (a single sample only holds its own position) */
export function findInterval(
  xs: NumArray,
  x: number,
): { i: number; t: number } | undefined {
  const n = xs.length;
  if (n === 0 || !Number.isFinite(x)) {
    return undefined;
  }
  if (n === 1) {
    return x === xs[0] ? { i: 0, t: 0 } : undefined;
  }

  const sign = xs[n - 1] >= xs[0] ? 1 : -1; // descending axes are searched mirrored
  const sx = sign * x;
  if (sx < sign * xs[0] || sx > sign * xs[n - 1]) {
    return undefined;
  }

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (sign * xs[mid] <= sx) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const width = xs[hi] - xs[lo];
  return { i: lo, t: width === 0 ? 0 : (x - xs[lo]) / width };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* Bilinear interpolation of a row-major `ny * nx` scalar at `(x, y)`; `NaN` outside the grid or
 * next to a missing value */
export function sampleBilinear(
  values: NumArray,
  xs: NumArray,
  ys: NumArray,
  x: number,
  y: number,
): number {
  const cx = findInterval(xs, x);
  const cy = findInterval(ys, y);
  if (!cx || !cy) {
    return Number.NaN;
  }
  const nx = xs.length;
  const i1 = Math.min(cx.i + 1, nx - 1);
  const j1 = Math.min(cy.i + 1, ys.length - 1);
  const row0 = cy.i * nx;
  const row1 = j1 * nx;
  return lerp(
    lerp(values[row0 + cx.i], values[row0 + i1], cx.t),
    lerp(values[row1 + cx.i], values[row1 + i1], cx.t),
    cy.t,
  );
}

/* Field `(u, v)` at `(x, y)`, by bilinear interpolation */
export function sampleField(field: VectorField2D, x: number, y: number): Vec2 {
  const { xs, ys, u, v } = field;
  return [sampleBilinear(u, xs, ys, x, y), sampleBilinear(v, xs, ys, x, y)];
}

/* Trilinear interpolation of a `nz * ny * nx` field at `(x, y, z)` */
export function sampleField3D(
  field: VectorField3D,
  x: number,
  y: number,
  z: number,
): Vec3 {
  const { xs, ys, zs } = field;
  const cx = findInterval(xs, x);
  const cy = findInterval(ys, y);
  const cz = findInterval(zs, z);
  if (!cx || !cy || !cz) {
    return [Number.NaN, Number.NaN, Number.NaN];
  }
  const [nx, ny] = [xs.length, ys.length];
  const [i0, j0, k0] = [cx.i, cy.i, cz.i];
  const [tx, ty, tz] = [cx.t, cy.t, cz.t];
  const i1 = Math.min(i0 + 1, nx - 1);
  const j1 = Math.min(j0 + 1, ny - 1);
  const k1 = Math.min(k0 + 1, zs.length - 1);

  function plane(values: NumArray, k: number): number {
    const r0 = (k * ny + j0) * nx;
    const r1 = (k * ny + j1) * nx;
    return lerp(
      lerp(values[r0 + i0], values[r0 + i1], tx),
      lerp(values[r1 + i0], values[r1 + i1], tx),
      ty,
    );
  }
  function at(values: NumArray): number {
    return lerp(plane(values, k0), plane(values, k1), tz);
  }

  return [at(field.u), at(field.v), at(field.w)];
}

/* Euclidean norm of the components, sample by sample */
export function getMagnitude(...components: NumArray[]): Float32Array {
  const [first] = components;
  const out = new Float32Array(first.length);
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (const comp of components) {
      sum += comp[i] * comp[i];
    }
    out[i] = Math.sqrt(sum);
  }
  return out;
}

/* Derivative along one line of samples, starting at `start` (cf. `differentiate`) */
function differentiateLine(
  values: NumArray,
  coords: NumArray,
  start: number,
  stride: number,
  out: Float32Array,
): void {
  const n = coords.length;
  function at(k: number): number {
    return values[start + k * stride];
  }
  for (let k = 0; k < n; k += 1) {
    let d: number;
    if (n === 1) {
      d = 0;
    } else if (n === 2) {
      d = (at(1) - at(0)) / (coords[1] - coords[0]);
    } else if (k === 0) {
      const [h1, h2] = [coords[1] - coords[0], coords[2] - coords[1]];
      d =
        (-(2 * h1 + h2) / (h1 * (h1 + h2))) * at(0) +
        ((h1 + h2) / (h1 * h2)) * at(1) -
        (h1 / (h2 * (h1 + h2))) * at(2);
    } else if (k === n - 1) {
      const [h1, h2] = [
        coords[k] - coords[k - 1],
        coords[k - 1] - coords[k - 2],
      ];
      d =
        ((2 * h1 + h2) / (h1 * (h1 + h2))) * at(k) -
        ((h1 + h2) / (h1 * h2)) * at(k - 1) +
        (h1 / (h2 * (h1 + h2))) * at(k - 2);
    } else {
      const hm = coords[k] - coords[k - 1];
      const hp = coords[k + 1] - coords[k];
      d =
        (hm * hm * at(k + 1) -
          hp * hp * at(k - 1) +
          (hp * hp - hm * hm) * at(k)) /
        (hm * hp * (hm + hp));
    }
    out[start + k * stride] = d; // eslint-disable-line no-param-reassign -- output array
  }
}

/*
 * Derivative along one axis of a row-major array, on a non-uniform grid: second-order central
 * differences inside (weighted by the neighbouring spacings), second-order one-sided ones at the
 * ends (first order with two samples; zero with one). `stride` is the distance between
 * neighbours along the axis in the array.
 */
export function differentiate(
  values: NumArray,
  coords: NumArray,
  stride: number,
): Float32Array {
  const n = coords.length;
  const out = new Float32Array(values.length);
  const block = n * stride;

  for (let start = 0; start < values.length; start += 1) {
    if (start % block < stride) {
      differentiateLine(values, coords, start, stride, out); // from the line's first sample
    }
  }

  return out;
}

/* ∂u/∂x + ∂v/∂y (+ ∂w/∂z) */
export function getDivergence(
  field: VectorField2D | VectorField3D,
): Float32Array {
  const { xs, ys, u, v } = field;
  const nx = xs.length;
  const out = differentiate(u, xs, 1);
  const dv = differentiate(v, ys, nx);
  const dw =
    'w' in field ? differentiate(field.w, field.zs, nx * ys.length) : undefined;
  for (let i = 0; i < out.length; i += 1) {
    out[i] += dv[i] + (dw ? dw[i] : 0);
  }
  return out;
}

/* Scalar vorticity ∂v/∂x − ∂u/∂y of a 2D field */
export function getCurl2D(field: VectorField2D): Float32Array {
  const { xs, ys, u, v } = field;
  const out = differentiate(v, xs, 1);
  const du = differentiate(u, ys, xs.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] -= du[i];
  }
  return out;
}

/* Reference magnitude for arrow lengths: high percentile of the finite magnitudes, so that a few
 * spikes (e.g. vortex cores, singularities) don't shrink every other arrow */
export function getReferenceMagnitude(
  magnitude: NumArray,
  percentile = 0.95,
): number {
  const finite = Float32Array.from(magnitude).filter(
    (val) => Number.isFinite(val) && val > 0,
  );
  if (finite.length === 0) {
    return 1;
  }
  finite.sort();
  return finite[
    Math.min(finite.length - 1, Math.floor(percentile * finite.length))
  ];
}

/* Extent of the finite values of an axis */
export function getAxisExtent(coords: NumArray): Domain {
  const [first, last] = [coords[0], coords[coords.length - 1]];
  return first <= last ? [first, last] : [last, first];
}

/* Affine map from data to another space (e.g. world, i.e. CSS pixels at zoom 1): `a * x + b` per
 * axis; streamlines are integrated and spaced in that space, so they look even on screen */
export interface AffineMap2D {
  ax: number;
  bx: number;
  ay: number;
  by: number;
}

export const IDENTITY_MAP: AffineMap2D = { ax: 1, bx: 0, ay: 1, by: 0 };

export interface StreamlineOptions {
  step: number; // integration step, in the mapped space
  maxLength: number; // in the mapped space
  minSpeed?: number; // stop where the mapped speed is below this (stagnation points)
  map?: AffineMap2D;
  /* Called with each new point (mapped space): stop when it returns false (e.g. too close to
   * another streamline) */
  accept?: (x: number, y: number) => boolean;
}

/*
 * One direction of a streamline from a seed (data coordinates), by classical RK4 on the
 * direction field normalized in the mapped space (constant speed: points evenly spaced on
 * screen). Stops outside the grid, at missing values, near stagnation points, when `accept`
 * refuses a point, after `maxLength`, or when the line closes onto its seed. Returns mapped
 * coordinates, seed first.
 */
export function traceStreamline(
  field: VectorField2D,
  seed: Vec2,
  direction: 1 | -1,
  opts: StreamlineOptions,
): number[] {
  const {
    step,
    maxLength,
    minSpeed = 1e-12,
    map = IDENTITY_MAP,
    accept,
  } = opts;
  const { ax, bx, ay, by } = map;

  // Unit direction in the mapped space at a mapped point, or `undefined`
  function dir(px: number, py: number): Vec2 | undefined {
    const [u, v] = sampleField(field, (px - bx) / ax, (py - by) / ay);
    const [mu, mv] = [u * ax, v * ay];
    const speed = Math.hypot(mu, mv);
    if (!Number.isFinite(speed) || speed <= minSpeed) {
      return undefined;
    }
    return [(direction * mu) / speed, (direction * mv) / speed];
  }

  let [x, y] = [ax * seed[0] + bx, ay * seed[1] + by];
  const [x0, y0] = [x, y];
  const points = [x, y];
  const h = step;

  for (let length = 0; length < maxLength; length += h) {
    const k1 = dir(x, y);
    if (!k1) {
      break;
    }
    const k2 = dir(x + (h / 2) * k1[0], y + (h / 2) * k1[1]);
    if (!k2) {
      break;
    }
    const k3 = dir(x + (h / 2) * k2[0], y + (h / 2) * k2[1]);
    if (!k3) {
      break;
    }
    const k4 = dir(x + h * k3[0], y + h * k3[1]);
    if (!k4) {
      break;
    }
    const nx = x + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const ny = y + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);

    // Closed orbit: stop on reaching the seed again (after leaving its neighbourhood)
    const closes =
      length > 4 * h && Math.hypot(nx - x0, ny - y0) < h && points.length > 8;
    if (closes) {
      points.push(x0, y0);
      break;
    }
    if (accept && !accept(nx, ny)) {
      break;
    }
    [x, y] = [nx, ny];
    points.push(x, y);
  }

  return points;
}

/* Spatial hash of points, to test separation in O(1) */
class PointGrid {
  private readonly cells = new Map<number, number[]>();

  public constructor(
    private readonly cellSize: number,
    private readonly origin: Vec2,
  ) {}

  public add(x: number, y: number): void {
    const cx = Math.floor((x - this.origin[0]) / this.cellSize);
    const cy = Math.floor((y - this.origin[1]) / this.cellSize);
    const key = this.key(cx, cy);
    const cell = this.cells.get(key);
    if (cell) {
      cell.push(x, y);
    } else {
      this.cells.set(key, [x, y]);
    }
  }

  public isFree(x: number, y: number, dist: number): boolean {
    const cx = Math.floor((x - this.origin[0]) / this.cellSize);
    const cy = Math.floor((y - this.origin[1]) / this.cellSize);
    const reach = Math.ceil(dist / this.cellSize);
    const d2 = dist * dist;
    for (let i = cx - reach; i <= cx + reach; i += 1) {
      for (let j = cy - reach; j <= cy + reach; j += 1) {
        const cell = this.cells.get(this.key(i, j));
        if (!cell) {
          continue;
        }
        for (let k = 0; k < cell.length; k += 2) {
          const [dx, dy] = [cell[k] - x, cell[k + 1] - y];
          if (dx * dx + dy * dy < d2) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private key(cx: number, cy: number): number {
    return cx * 73_856_093 + cy * 19_349_663; // collisions only cost extra tests
  }
}

export interface EvenStreamlineOptions {
  map: AffineMap2D; // data to the space where lines are spaced (e.g. world: CSS pixels at zoom 1)
  separation: number; // distance between lines, in the mapped space
  region?: [Vec2, Vec2]; // part of the mapped space to cover (default: whole grid)
  maxPoints?: number; // budget over all lines
}

/*
 * Evenly-spaced streamlines (Jobard & Lefer, 1997): each line is traced both ways from a seed
 * until it comes closer than `separation / 2` to another line; new seeds are taken at
 * `separation` on either side of the points of the lines already drawn, then on a coarse grid
 * (regions not reached from the first line). Returns polylines in the mapped space.
 */
export function getEvenlySpacedStreamlines(
  field: VectorField2D,
  opts: EvenStreamlineOptions,
): number[][] {
  const { map, separation, maxPoints = 200_000 } = opts;
  const { ax, bx, ay, by } = map;
  const { xs, ys } = field;
  if (xs.length < 2 || ys.length < 2 || !(separation > 0)) {
    return [];
  }

  // Region in the mapped space, within the grid
  const gx = [ax * xs[0] + bx, ax * xs[xs.length - 1] + bx].sort(
    (a, b) => a - b,
  );
  const gy = [ay * ys[0] + by, ay * ys[ys.length - 1] + by].sort(
    (a, b) => a - b,
  );
  const [lo, hi] = opts.region ?? [
    [gx[0], gy[0]],
    [gx[1], gy[1]],
  ];
  const [x0, x1] = [Math.max(lo[0], gx[0]), Math.min(hi[0], gx[1])];
  const [y0, y1] = [Math.max(lo[1], gy[0]), Math.min(hi[1], gy[1])];
  if (!(x1 > x0 && y1 > y0)) {
    return [];
  }
  function inRegion(x: number, y: number): boolean {
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  const dTest = separation / 2;
  const grid = new PointGrid(separation, [x0, y0]);
  const step = Math.max(separation / 8, 1e-9 * (x1 - x0));
  const maxLength = 4 * (x1 - x0 + (y1 - y0));
  function toData(x: number, y: number): Vec2 {
    return [(x - bx) / ax, (y - by) / ay];
  }
  const lines: number[][] = [];
  let pointCount = 0;

  function trace(seed: Vec2): number[] | undefined {
    if (
      !inRegion(seed[0], seed[1]) ||
      !grid.isFree(seed[0], seed[1], separation)
    ) {
      return undefined;
    }
    const own: number[] = []; // points of this line, tested only against others
    function accept(x: number, y: number): boolean {
      return (
        inRegion(x, y) &&
        grid.isFree(x, y, dTest) &&
        pointCount + own.length / 2 < maxPoints
      );
    }
    const opts2 = { step, maxLength, map, accept };
    const fwd = traceStreamline(field, toData(...seed), 1, opts2);
    const isClosed =
      fwd.length > 4 && fwd.at(-2) === fwd[0] && fwd.at(-1) === fwd[1];
    const bwd = isClosed
      ? []
      : traceStreamline(field, toData(...seed), -1, opts2);
    const line: number[] = [];
    for (let k = bwd.length - 2; k >= 2; k -= 2) {
      line.push(bwd[k], bwd[k + 1]);
    }
    line.push(...fwd);
    own.push(...line);
    if (line.length < 6) {
      return undefined; // a point or a single step: no line
    }
    for (let k = 0; k < line.length; k += 2) {
      grid.add(line[k], line[k + 1]);
    }
    pointCount += line.length / 2;
    lines.push(line);
    return line;
  }

  // Seeds next to drawn lines, line by line (breadth first)
  function spread(): void {
    for (let n = 0; n < lines.length && pointCount < maxPoints; n += 1) {
      const line = lines[n];
      const stride = Math.max(2, Math.round(separation / step) * 2);
      for (let k = 0; k + 3 < line.length; k += stride) {
        const [px, py] = [line[k], line[k + 1]];
        const [dx, dy] = [line[k + 2] - px, line[k + 3] - py];
        const len = Math.hypot(dx, dy) || 1;
        const [nx, ny] = [(-dy / len) * separation, (dx / len) * separation];
        trace([px + nx, py + ny]);
        trace([px - nx, py - ny]);
      }
    }
  }

  // First seed at the centre, then a coarse grid of seeds for regions not reached
  trace([(x0 + x1) / 2, (y0 + y1) / 2]);
  spread();
  const coarse = separation * 2;
  for (let y = y0 + coarse / 2; y < y1 && pointCount < maxPoints; y += coarse) {
    for (
      let x = x0 + coarse / 2;
      x < x1 && pointCount < maxPoints;
      x += coarse
    ) {
      if (trace([x, y])) {
        spread();
      }
    }
  }

  return lines;
}

export interface StreamlineArrow {
  x: number; // mapped space
  y: number;
  dx: number; // unit direction
  dy: number;
}

/* Positions and directions of arrowheads every `spacing` along polylines (mapped space), the
 * first half a spacing in */
export function getStreamlineArrows(
  lines: number[][],
  spacing: number,
): StreamlineArrow[] {
  const arrows: StreamlineArrow[] = [];
  for (const line of lines) {
    let next = spacing / 2;
    let travelled = 0;
    for (let k = 0; k + 3 < line.length; k += 2) {
      const [dx, dy] = [line[k + 2] - line[k], line[k + 3] - line[k + 1]];
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        for (; next <= travelled + len; next += spacing) {
          const t = (next - travelled) / len;
          arrows.push({
            x: line[k] + t * dx,
            y: line[k + 1] + t * dy,
            dx: dx / len,
            dy: dy / len,
          });
        }
      }
      travelled += len;
    }
  }
  return arrows;
}

export type Axis3D = 'x' | 'y' | 'z';

/* Seeds on a regular lattice of `perAxis` points along each axis (inside the grid's extent),
 * or on a plane at a given position along one axis */
export function getLatticeSeeds(
  field: VectorField3D,
  perAxis: number,
  plane?: { axis: Axis3D; value: number },
): Vec3[] {
  const extents = [field.xs, field.ys, field.zs].map(getAxisExtent);
  const axes = extents.map(([lo, hi], c) =>
    plane?.axis === 'xyz'[c]
      ? [plane.value]
      : Array.from(
          { length: perAxis },
          (_, i) => lo + ((i + 0.5) / perAxis) * (hi - lo),
        ),
  );
  return axes[2].flatMap((z) =>
    axes[1].flatMap((y) => axes[0].map((x): Vec3 => [x, y, z])),
  );
}

/*
 * Streamlines of a 3D field from seeds (data coordinates), traced both ways by RK4 on the
 * direction field normalized in box space (`toBox`: affine map from data to the box), so steps
 * are even on screen. Returns polylines in box space.
 */
export function getSeededStreamlines3D(
  field: VectorField3D,
  toBox: (x: number, y: number, z: number) => Vec3,
  opts: { seeds: Vec3[]; step: number; maxSteps: number },
): number[][] {
  const { seeds, step, maxSteps } = opts;
  const toUnit = toBox(1, 1, 1);
  const origin = toBox(0, 0, 0);
  const scale: Vec3 = [
    toUnit[0] - origin[0],
    toUnit[1] - origin[1],
    toUnit[2] - origin[2],
  ];

  // Derivative in data space such that the speed in box space is 1
  function dir(p: Vec3, sign: number): Vec3 | undefined {
    const [u, v, w] = sampleField3D(field, p[0], p[1], p[2]);
    const m: Vec3 = [u * scale[0], v * scale[1], w * scale[2]];
    const speed = Math.hypot(...m);
    if (!Number.isFinite(speed) || speed <= 1e-12) {
      return undefined;
    }
    return [
      (sign * m[0]) / speed / scale[0],
      (sign * m[1]) / speed / scale[1],
      (sign * m[2]) / speed / scale[2],
    ];
  }

  function add(a: Vec3, b: Vec3, f: number): Vec3 {
    return [a[0] + f * b[0], a[1] + f * b[1], a[2] + f * b[2]];
  }

  function half(seed: Vec3, sign: number): Vec3[] {
    const pts: Vec3[] = [seed];
    let p = seed;
    for (let s = 0; s < maxSteps; s += 1) {
      const k1 = dir(p, sign);
      const k2 = k1 && dir(add(p, k1, step / 2), sign);
      const k3 = k2 && dir(add(p, k2, step / 2), sign);
      const k4 = k3 && dir(add(p, k3, step), sign);
      if (!k1 || !k2 || !k3 || !k4) {
        break;
      }
      p = [
        p[0] + (step / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
        p[1] + (step / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
        p[2] + (step / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      ];
      pts.push(p);
    }
    return pts;
  }

  return seeds
    .map((seed) => [...half(seed, -1).reverse(), ...half(seed, 1).slice(1)])
    .filter((pts) => pts.length > 2)
    .map((pts) => pts.flatMap((p) => toBox(...p)));
}
