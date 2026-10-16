import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import {
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Vector2,
} from 'three';
import { type LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

import { Z_OUT } from '../utils';
import { getPixelsPerUnit } from './linePchipGeometry';

export const DASH_SIZE = 6; // in CSS pixels, whatever the zoom
export const GAP_SIZE = 4;
const PERIOD = DASH_SIZE + GAP_SIZE;

/*
 * Length along the curve, in CSS pixels, at the start and end of each segment, as
 * `LineMaterial` needs to draw dashes (cf. `Line2#computeLineDistances`).
 * Starts are wrapped to the dash period to keep precision on long curves; segments
 * moved out of view (NaN gaps) don't count. For PCHIP, a segment is a whole interval,
 * so its length is that of the chord and dashes stretch a little on curved intervals.
 */
export function setDashDistances(
  geometry: LineSegmentsGeometry,
  pixelsPerUnit: Vector2,
): void {
  const { instanceStart: starts, instanceEnd: ends } = geometry.attributes;
  const count = geometry.instanceCount;

  const attr = geometry.getAttribute('instanceDistanceStart');
  const existing =
    attr instanceof InterleavedBufferAttribute && attr.count === count
      ? attr.data
      : undefined;
  const buffer =
    existing ??
    new InstancedInterleavedBuffer(new Float32Array(2 * count), 2, 1);

  const { array } = buffer;
  let distance = 0;
  for (let index = 0; index < count; index++) {
    const isOut = starts.getZ(index) === Z_OUT || ends.getZ(index) === Z_OUT;
    const dx = (ends.getX(index) - starts.getX(index)) * pixelsPerUnit.x;
    const dy = (ends.getY(index) - starts.getY(index)) * pixelsPerUnit.y;

    array[2 * index] = distance % PERIOD;
    array[2 * index + 1] = array[2 * index] + (isOut ? 0 : Math.hypot(dx, dy));
    distance = array[2 * index + 1];
  }

  buffer.needsUpdate = true;
  if (!existing) {
    geometry.setAttribute(
      'instanceDistanceStart',
      new InterleavedBufferAttribute(buffer, 1, 0),
    );
    geometry.setAttribute(
      'instanceDistanceEnd',
      new InterleavedBufferAttribute(buffer, 1, 1),
    );
  }
}

// Recomputes the dash distances when the zoom changes, before three uploads attributes
export function useDashDistances(
  geometry: LineSegmentsGeometry,
  isEnabled: boolean,
): void {
  const keyRef = useRef<string>(undefined);
  useFrame(({ gl, camera }) => {
    if (!isEnabled) {
      return;
    }
    camera.updateMatrixWorld(); // as the renderer would, after camera moves
    const pixelsPerUnit = getPixelsPerUnit(gl, camera);
    const key = `${geometry.id} ${pixelsPerUnit.toArray().join(',')}`;
    if (keyRef.current !== key) {
      setDashDistances(geometry, pixelsPerUnit);
      keyRef.current = key;
    }
  });
}
