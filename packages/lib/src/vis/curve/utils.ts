import { type NumArray } from '@h5web/shared/vis-models';
import { type InterleavedBufferAttribute } from 'three';
import { type LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { type WorldTransform } from '../three-d/utils';

export interface CurveBuffers {
  segmentPositions: Float32Array; // world positions of segment ends: 6 floats per segment
  segmentIndices: Uint32Array; // index of point at each segment end: 2 per segment
  pointPositions: Float32Array; // world positions of valid points: 3 floats per point
  pointIndices: Uint32Array; // index of each valid point
}

/**
 * Build the segments joining consecutive points of a curve, and the list of its points.
 * Points with a non-finite coordinate (e.g. `NaN`), or for which `isValid` returns `false`
 * (e.g. missing value of the scalar field), are left out, leaving gaps in the curve.
 * Curves without Z coordinates lie in the `z = 0` plane.
 */
export function buildCurveBuffers(
  x: NumArray,
  y: NumArray,
  z: NumArray | undefined,
  toWorld: WorldTransform,
  isValid?: (index: number) => boolean,
): CurveBuffers {
  const count = Math.min(x.length, y.length, z?.length ?? Infinity);

  const positions = new Float32Array(count * 3);
  const valid = new Uint8Array(count);
  let validCount = 0;

  for (let i = 0; i < count; i += 1) {
    const zVal = z ? z[i] : 0;
    if (
      Number.isFinite(x[i]) &&
      Number.isFinite(y[i]) &&
      Number.isFinite(zVal) &&
      (!isValid || isValid(i))
    ) {
      positions.set(toWorld(x[i], y[i], zVal), i * 3);
      valid[i] = 1;
      validCount += 1;
    }
  }

  const pointPositions = new Float32Array(validCount * 3);
  const pointIndices = new Uint32Array(validCount);
  const segmentPositions: number[] = [];
  const segmentIndices: number[] = [];

  let p = 0;
  for (let i = 0; i < count; i += 1) {
    if (!valid[i]) {
      continue;
    }

    pointPositions.set(positions.subarray(i * 3, i * 3 + 3), p * 3);
    pointIndices[p] = i;
    p += 1;

    if (i + 1 < count && valid[i + 1]) {
      segmentPositions.push(...positions.subarray(i * 3, i * 3 + 6));
      segmentIndices.push(i, i + 1);
    }
  }

  return {
    segmentPositions: Float32Array.from(segmentPositions),
    segmentIndices: Uint32Array.from(segmentIndices),
    pointPositions,
    pointIndices,
  };
}

/** Gather the colours (3 floats each) of the points at the given indices. */
export function gatherColors(
  colors: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const gathered = new Float32Array(indices.length * 3);
  for (const [i, index] of indices.entries()) {
    gathered.set(colors.subarray(index * 3, index * 3 + 3), i * 3);
  }

  return gathered;
}

/** Default scalar field of a curve: index of each point, i.e. its parameter. */
export function getPointIndices(count: number): Float64Array {
  return Float64Array.from({ length: count }, (_, i) => i);
}

/**
 * Set colours of segment ends (6 floats per segment), updating the existing interleaved
 * buffer in place when possible, rather than allocating a new one with `setColors`.
 */
export function updateLineColors(
  geometry: LineSegmentsGeometry,
  colors: Float32Array,
): void {
  const attr = geometry.getAttribute('instanceColorStart') as
    InterleavedBufferAttribute | undefined;

  if (attr?.data.array.length === colors.length) {
    (attr.data.array as Float32Array).set(colors);
    attr.data.needsUpdate = true;
    return;
  }

  geometry.setColors(colors);
}
