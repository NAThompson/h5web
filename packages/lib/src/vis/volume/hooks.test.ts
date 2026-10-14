import { rgb } from 'd3-color';
import { describe, expect, it } from 'vitest';

import { getInterpolator } from '../heatmap/utils';
import { getGeometryBytes, getGradientDomain, pruneCache } from './hooks';
import { getColorLut } from './IsosurfaceMesh';
import { type IsosurfaceGeometry } from './marchingCubes';

function fakeGeometry(vertices: number, gradient = 1): IsosurfaceGeometry {
  return {
    level: 0,
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    gradients: new Float32Array(vertices).fill(gradient),
    indices: new Uint32Array(vertices),
    step: 1,
  };
}

const MB = 1024 * 1024;
const BIG = (8 * MB) / 32; // vertices per 8 MB geometry (7 floats + 1 index per vertex)

describe('pruneCache', () => {
  it('should keep requested surfaces whatever the budget', () => {
    const cache = new Map([
      ['a', fakeGeometry(BIG)],
      ['b', fakeGeometry(BIG)],
    ]);
    expect(getGeometryBytes(fakeGeometry(BIG))).toBe(8 * MB);

    const pruned = pruneCache(cache, new Set(['a', 'b']), 0);
    expect([...pruned.keys()]).toStrictEqual(['a', 'b']);
  });

  it('should keep only the most recent unrequested surfaces within budget', () => {
    // Intermediate levels while dragging a slider, oldest first
    const cache = new Map(
      ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'current'].map((key) => [
        key,
        fakeGeometry(BIG),
      ]),
    );

    // At most four in history
    expect([
      ...pruneCache(cache, new Set(['current']), 1e9).keys(),
    ]).toStrictEqual(['l3', 'l4', 'l5', 'l6', 'current']);

    // Byte budget for history: 2 × 8 MB
    expect([
      ...pruneCache(cache, new Set(['current']), 16 * MB).keys(),
    ]).toStrictEqual(['l5', 'l6', 'current']);
  });

  it('should return the same map when nothing is dropped', () => {
    const cache = new Map([['a', fakeGeometry(10)]]);
    expect(pruneCache(cache, new Set(), 1e9)).toBe(cache);
  });
});

describe('getGradientDomain', () => {
  it('should combine gradient ranges of defined surfaces', () => {
    expect(
      getGradientDomain([fakeGeometry(2, 1), undefined, fakeGeometry(2, 3)]),
    ).toStrictEqual([1, 3]);
    expect(getGradientDomain([undefined])).toBeUndefined();
  });
});

describe('getColorLut', () => {
  it('should convert colour map samples to linear RGB', () => {
    const lut = getColorLut('Greys', false);
    expect(lut[0]).toBe(0);
    expect(lut[255 * 3]).toBeCloseTo(1, 5);

    // Mid-range sRGB values are much darker in linear RGB
    const srgb = rgb(getInterpolator('Greys', false)(128 / 255)).r / 255;
    const linear = ((srgb + 0.055) / 1.055) ** 2.4;
    expect(lut[128 * 3]).toBeCloseTo(linear, 3);
  });
});
