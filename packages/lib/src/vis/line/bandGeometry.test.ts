import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import { createScale } from '../utils';
import BandGeometry from './bandGeometry';
import { Interpolation } from './models';

// NaN in either bound, or a value that can't be drawn on a log scale, leaves a gap
const params = {
  abscissas: [0, 1, 2, 3, 4, 5],
  lower: [1, 2, 1, Number.NaN, 1, 1],
  upper: [3, 4, 3, 3, 3, -1],
  abscissaScale: createScale(ScaleType.Linear, {}),
  ordinateScale: createScale(ScaleType.Log, {}),
};

/* Quads drawn, as `[x0, x1, lower0, upper0, lower1, upper1]` of their corners */
function getQuads(geometry: BandGeometry): number[][] {
  geometry.update();
  const { position } = geometry.attributes;
  const index = geometry.getIndex()?.array ?? [];
  const quads = [];
  for (let i = 0; i < geometry.drawRange.count; i += 6) {
    const [lo0, hi0, lo1, , hi1] = index.slice(i, i + 5);
    quads.push([
      position.getX(lo0),
      position.getX(lo1),
      ...[lo0, hi0, lo1, hi1].map((v) => 10 ** position.getY(v)),
    ]);
  }
  return quads.map((quad) => quad.map((val) => Math.round(val * 1000) / 1000));
}

describe('BandGeometry', () => {
  it('fill between the bounds with straight edges', () => {
    expect(getQuads(new BandGeometry(params))).toEqual([
      [0, 1, 1, 3, 2, 4],
      [1, 2, 2, 4, 1, 3],
    ]);
  });

  it('hold the bounds until the next point with constant interpolation', () => {
    const geometry = new BandGeometry({
      ...params,
      interpolation: Interpolation.Constant,
    });
    expect(getQuads(geometry)).toEqual([
      [0, 1, 1, 3, 1, 3],
      [1, 2, 2, 4, 2, 4],
    ]);
  });

  it('follow the interpolant of each bound with PCHIP', () => {
    const geometry = new BandGeometry({
      ...params,
      interpolation: Interpolation.Pchip,
    });
    const quads = getQuads(geometry);
    expect(quads).toHaveLength(2 * 16); // samples of each interval
    expect(quads[0].slice(0, 4)).toEqual([0, 0.063, 1, 3]);
    expect(quads.at(-1)?.slice(1)).toEqual([2, 1.088, 3.01, 1, 3]);
    // Monotone between points: peaks of 2 and 4 at `x = 1`
    expect(quads.every((quad) => quad[2] <= 2 && quad[3] <= 4)).toBe(true);
  });

  it('sample fewer points per interval of long cubic bands', () => {
    const values = new Float64Array(2 ** 18 + 1);
    const geometry = new BandGeometry({
      ...params,
      abscissas: values,
      lower: values,
      upper: values,
      interpolation: Interpolation.Spline,
    });
    expect(geometry.getIndex()?.count).toBe(2 ** 18 * 4 * 6); // 4 quads per interval
  });
});
