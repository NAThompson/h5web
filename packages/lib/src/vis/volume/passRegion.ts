import { type DataValues } from '../geometry-worker/models';
import {
  getSampleIndices,
  type IsosurfaceGeometry,
  marchingCubesSteps,
  sampleToVoxel,
} from './marchingCubes';
import {
  getSmoothField,
  smoothSurfaceSteps,
  withProgress,
} from './smoothSurface';

/* Region where `min ≤ value ≤ max` (either bound optional), or where that fails if `invert` */
export interface PassBounds {
  min?: number;
  max?: number;
  invert?: boolean;
}

/* Grid points sampled along z, y and x (cf. `getSampleIndices`) */
export type Samples = [Int32Array, Int32Array, Int32Array];

/*
 * Field whose level 0 is the boundary of the region, sampled with a stride (negative inside, so
 * that marching cubes winds and orients the surface outwards; values on a bound are inside), padded
 * with one layer of grid points outside the region on every side, so that the surface is closed by
 * caps where the region meets the walls of the box. NaN values fail. A window narrower than the
 * change between neighboring samples (one below `min`, the other above `max`) is missed.
 */
export function getPassField(
  values: DataValues,
  shape: number[],
  samples: Samples,
  bounds: PassBounds,
): { data: Float32Array; shape: [number, number, number] } {
  const { min = -Infinity, max = Infinity, invert = false } = bounds;
  const [, ny, nx] = shape;
  const [zs, ys, xs] = samples;

  // Distance to the nearest bound, at most `pad` (largest finite distance)
  let pad = 0;
  for (const val of values) {
    const dist = Math.abs(Math.max(min - val, val - max));
    pad = Number.isFinite(dist) ? Math.max(pad, dist) : pad;
  }
  if (pad === 0) {
    pad = 1; // e.g. constant values on a bound
  }
  const tiny = pad * 1e-6; // values on a bound

  const padded: [number, number, number] = [
    zs.length + 2,
    ys.length + 2,
    xs.length + 2,
  ];
  const data = new Float32Array(padded[0] * padded[1] * padded[2]).fill(pad);
  zs.forEach((z, k) => {
    ys.forEach((y, j) => {
      xs.forEach((x, i) => {
        const val = values[(z * ny + y) * nx + x];
        const isShown = (val >= min && val <= max) !== invert;
        const dist = Math.abs(Math.max(min - val, val - max));
        const mag = Number.isNaN(dist) // e.g. NaN, or ∞ on a one-sided bound
          ? pad
          : Math.min(Math.max(dist, tiny), pad);
        data[((k + 1) * padded[1] + j + 1) * padded[2] + i + 1] = isShown
          ? -mag
          : mag;
      });
    });
  });
  return { data, shape: padded };
}

/*
 * Surface of `getPassField` in the index space of the volume: vertices on or beyond its outer grid
 * points are moved onto the faces of the box (half a voxel further out), so that the caps lie on
 * the faces, and face outwards; others are mapped from sampled grid points to voxels.
 */
export function capRegion(
  geometry: IsosurfaceGeometry,
  shape: number[],
  samples: Samples,
): IsosurfaceGeometry {
  const [depth, rows, cols] = shape;
  const sizes = [cols, rows, depth];
  const indices = [samples[2], samples[1], samples[0]];
  const positions = Float32Array.from(geometry.positions);
  const normals = Float32Array.from(geometry.normals);
  const outward = [0, 0, 0];

  for (let v = 0; v < positions.length; v += 3) {
    sizes.forEach((n, axis) => {
      const idx = indices[axis];
      const pos = positions[v + axis] - 1; // padding
      const last = idx.length - 1;
      outward[axis] = pos < 0 ? -1 : pos > last ? 1 : 0;
      positions[v + axis] =
        pos <= 0 ? -0.5 : pos >= last ? n - 0.5 : sampleToVoxel(idx, pos);
    });
    const len = Math.hypot(...outward);
    if (len > 0) {
      outward.forEach((val, axis) => {
        normals[v + axis] = val / len;
      });
    }
  }
  return { ...geometry, positions, normals };
}

/*
 * Closed surface of a pass region, with grid points sampled with a stride (cf. `useIsosurfaces`).
 * When smoothing, the surface follows the spline of the signed distance to the nearest bound
 * (cf. `smoothIsosurfaceSteps`), while caps stay on the faces of the box.
 */
export function* passRegionSteps(
  values: DataValues,
  shape: [number, number, number],
  bounds: PassBounds,
  step: number,
  smooth = false,
): Generator<number, IsosurfaceGeometry> {
  const samples = shape.map((n) => getSampleIndices(n, step)) as Samples;
  if (!smooth) {
    const field = getPassField(values, shape, samples, bounds);
    const geometry = yield* marchingCubesSteps(field.data, field.shape, 0);
    return { ...capRegion(geometry, shape, samples), step };
  }

  // Region of the data's spline: field `max(min - s, s - max)`, negated if inverted (as `getPassField`)
  const { spline, fine, ref } = getSmoothField(values, shape, undefined, step);
  const { min = -Infinity, max = Infinity, invert = false } = bounds;
  const [relMin, relMax] = [min - ref, max - ref];
  const fineSamples = fine.shape.map((n) => getSampleIndices(n, 1)) as Samples;
  const field = getPassField(fine.data, fine.shape, fineSamples, {
    min: relMin,
    max: relMax,
    invert,
  });
  const gen = marchingCubesSteps(field.data, field.shape, 0);
  const geometry = yield* withProgress(gen, 0, 0.5);
  const positions = geometry.positions.map((val) => (val + 1) / 2); // padding stays one sample

  const sign = invert ? -1 : 1;
  function toField(out: Float64Array): void {
    const isBelow = relMin - out[0] > out[0] - relMax; // nearer the lower bound
    const dir = isBelow ? -sign : sign;
    const [s, gx, gy, gz] = out;
    out.set([
      dir * (s - (isBelow ? relMin : relMax)),
      dir * gx,
      dir * gy,
      dir * gz,
    ]);
  }
  const smoothed = smoothSurfaceSteps(
    { ...geometry, positions },
    spline,
    toField,
    1, // padding
  );
  const surface = yield* withProgress(smoothed, 0.5, 0.5);
  return { ...capRegion(surface, shape, samples), step };
}

/* Volume enclosed by a closed surface wound counter-clockwise from outside (divergence theorem) */
export function getEnclosedVolume(
  positions: Float32Array,
  indices: Uint32Array,
): number {
  let sum = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const [ax, ay, az] = [positions[a], positions[a + 1], positions[a + 2]];
    const [bx, by, bz] = [positions[b], positions[b + 1], positions[b + 2]];
    const [cx, cy, cz] = [positions[c], positions[c + 1], positions[c + 2]];
    sum +=
      ax * (by * cz - bz * cy) +
      ay * (bz * cx - bx * cz) +
      az * (bx * cy - by * cx);
  }
  return sum / 6;
}
