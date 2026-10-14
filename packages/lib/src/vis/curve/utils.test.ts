import { type InterleavedBufferAttribute, type Vector3Tuple } from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { describe, expect, it } from 'vitest';

import {
  buildCurveBuffers,
  gatherColors,
  getPointIndices,
  updateLineColors,
} from './utils';

function identity(x: number, y: number, z: number): Vector3Tuple {
  return [x, y, z];
}

describe('buildCurveBuffers', () => {
  it('should join consecutive points with segments', () => {
    const buffers = buildCurveBuffers(
      [0, 1, 2],
      [0, 1, 0],
      [0, 0, 1],
      identity,
    );

    expect([...buffers.segmentPositions]).toEqual([
      0, 0, 0, 1, 1, 0, 1, 1, 0, 2, 0, 1,
    ]);
    expect([...buffers.segmentIndices]).toEqual([0, 1, 1, 2]);
    expect([...buffers.pointPositions]).toEqual([0, 0, 0, 1, 1, 0, 2, 0, 1]);
    expect([...buffers.pointIndices]).toEqual([0, 1, 2]);
  });

  it('should apply world transform', () => {
    const buffers = buildCurveBuffers([1, 2], [3, 4], [5, 6], (x, y, z) => [
      x * 2,
      y - 3,
      -z,
    ]);
    expect([...buffers.pointPositions]).toEqual([2, 0, -5, 4, 1, -6]);
  });

  it('should leave gaps at non-finite coordinates', () => {
    const buffers = buildCurveBuffers(
      [0, 1, Number.NaN, 3, 4, 5],
      [0, 0, 0, 0, Infinity, 0],
      [0, 0, 0, 0, 0, 0],
      identity,
    );

    expect([...buffers.segmentIndices]).toEqual([0, 1]);
    expect([...buffers.pointIndices]).toEqual([0, 1, 3, 5]);
  });

  it('should leave gaps at invalid points', () => {
    const buffers = buildCurveBuffers(
      [0, 1, 2, 3],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      identity,
      (i) => i !== 2,
    );

    expect([...buffers.segmentIndices]).toEqual([0, 1]);
    expect([...buffers.pointIndices]).toEqual([0, 1, 3]);
  });

  it('should put curve in z = 0 plane without Z coordinates', () => {
    const buffers = buildCurveBuffers([0, 1], [2, 3], undefined, identity);
    expect([...buffers.pointPositions]).toEqual([0, 2, 0, 1, 3, 0]);
  });

  it('should ignore extra elements of longer arrays', () => {
    const buffers = buildCurveBuffers(
      [0, 1, 2],
      [0, 1],
      [0, 1, 2, 3],
      identity,
    );
    expect([...buffers.pointIndices]).toEqual([0, 1]);
  });

  it('should handle empty and single-point curves', () => {
    expect(buildCurveBuffers([], [], [], identity).pointIndices).toHaveLength(
      0,
    );

    const single = buildCurveBuffers([1], [1], [1], identity);
    expect(single.pointIndices).toHaveLength(1);
    expect(single.segmentIndices).toHaveLength(0);
  });
});

describe('gatherColors', () => {
  it('should pick colours of points at indices', () => {
    const colors = Float32Array.from([0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5]);
    expect([...gatherColors(colors, Uint32Array.from([2, 0]))]).toEqual([
      0.5, 0.5, 0.5, 0, 0, 0,
    ]);
  });
});

describe('getPointIndices', () => {
  it('should return indices of points', () => {
    expect([...getPointIndices(3)]).toEqual([0, 1, 2]);
  });
});

describe('updateLineColors', () => {
  it('should update interleaved colour buffer in place', () => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions([0, 0, 0, 1, 1, 1]);

    updateLineColors(geometry, Float32Array.from([0, 0, 0, 0, 0, 0]));
    const attr = geometry.getAttribute(
      'instanceColorStart',
    ) as InterleavedBufferAttribute;
    const { data } = attr;
    const { version } = data;

    updateLineColors(geometry, Float32Array.from([1, 1, 1, 0.5, 0.5, 0.5]));
    const start = geometry.getAttribute(
      'instanceColorStart',
    ) as InterleavedBufferAttribute;
    const end = geometry.getAttribute(
      'instanceColorEnd',
    ) as InterleavedBufferAttribute;
    expect(start.data).toBe(data); // no new GPU buffer
    expect(end.data).toBe(data);
    expect([...data.array]).toEqual([1, 1, 1, 0.5, 0.5, 0.5]);
    expect(data.version).toBe(version + 1);
  });
});
