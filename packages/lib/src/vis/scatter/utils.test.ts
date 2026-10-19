import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  buildPointGrid,
  findNearestPoint,
  findProjectedPoint,
  getLinearUnitScale,
  getPointColors,
  getPointSizes,
  getSizePx,
  getUnitPositions,
} from './utils';

const LUT = Uint8Array.from([0, 0, 0, 255, 255, 255]); // black to white

describe('getUnitPositions', () => {
  it('map coordinates into the unit cube', () => {
    const positions = getUnitPositions(
      [[0, 10], [5, 5], undefined],
      [getLinearUnitScale([0, 10]), getLinearUnitScale([5, 5])],
    );
    expect([...positions]).toEqual([0, 0.5, 0, 1, 0.5, 0]); // flat domain: middle
  });
});

describe('getPointColors', () => {
  it('colour by position on the colour map, with special colours', () => {
    const params = Float32Array.from([0, 1, Number.NaN, -1, 2]);
    expect([...getPointColors(5, params, { lut: LUT })]).toEqual([
      0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255, 255,
    ]);
    const colors = getPointColors(5, params, {
      lut: LUT,
      nan: [1, 2, 3],
      below: [4, 5, 6],
    });
    expect(colors.slice(6, 12)).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6]));
  });

  it('colour all points alike', () => {
    expect([...getPointColors(2, undefined, [9, 8, 7])]).toEqual([
      9, 8, 7, 9, 8, 7,
    ]);
  });
});

describe('getPointSizes', () => {
  const positions = Float32Array.from([0, 0, 0, Number.NaN, 0, 0, 1, 1, 0]);

  it('hide points that cannot be placed or coloured', () => {
    const colorParams = Float32Array.from([0.5, 0.5, Number.NaN]);
    const sizes = getPointSizes(positions, {
      basePx: 4,
      range: [2, 12],
      colorParams,
    });
    expect([...sizes]).toEqual([4, 0, 0]);

    const withNan = getPointSizes(positions, {
      basePx: 4,
      range: [2, 12],
      colorParams,
      showNan: true,
    });
    expect([...withNan]).toEqual([4, 0, 4]);
  });

  it('size points so that area grows with value', () => {
    const sizes = getPointSizes(positions, {
      basePx: 4,
      values: [0, 1, Number.NaN],
      domain: [0, 1],
      range: [2, 12],
    });
    expect([...sizes]).toEqual([2, 0, 0]);
    expect(getSizePx(1, [0, 1], [2, 12])).toBeCloseTo(12);
    expect(getSizePx(0.5, [0, 1], [2, 12]) ** 2).toBeCloseTo((4 + 144) / 2);
  });
});

describe('findNearestPoint', () => {
  const positions = Float32Array.from([0.1, 0.1, 0, 0.5, 0.5, 0, 0.52, 0.5, 0]);
  const sizes = Float32Array.from([4, 4, 0]); // third point hidden
  const grid = buildPointGrid(positions);
  const params = { sizes, sizeScale: 1, minRadius: 4, maxSize: 4 };

  it('find the visible point under the cursor', () => {
    const px: [number, number] = [100, 100]; // pixels per unit
    expect(findNearestPoint(grid, positions, [0.51, 0.5], px, params)).toBe(1);
    expect(findNearestPoint(grid, positions, [0.12, 0.1], px, params)).toBe(0);
    expect(
      findNearestPoint(grid, positions, [0.3, 0.3], px, params),
    ).toBeUndefined();
  });
});

describe('findProjectedPoint', () => {
  it('find the frontmost point under the cursor', () => {
    // Two points at the same place on screen: the one nearer the camera (smaller depth) wins
    const positions = Float32Array.from([0, 0, 0.5, 0, 0, -0.5, 0.9, 0.9, 0]);
    const sizes = Float32Array.from([4, 4, 4]);
    const mvp = new Matrix4().elements; // identity: unit square is clip space
    const params = { sizes, sizeScale: 1, minRadius: 4 };

    expect(
      findProjectedPoint(positions, mvp, [50, 50], [100, 100], params),
    ).toBe(1);
    expect(
      findProjectedPoint(positions, mvp, [95, 5], [100, 100], params),
    ).toBe(2);
    expect(
      findProjectedPoint(positions, mvp, [20, 20], [100, 100], params),
    ).toBeUndefined();
  });
});
