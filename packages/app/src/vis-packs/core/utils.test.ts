import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import {
  getBaseArray,
  guessKeepRatio,
  migrateSqrtToRoot,
  toHeightScaleType,
} from './utils';

describe('getBaseArray', () => {
  it('should create ndarray with given dimensions', () => {
    const baseArray = getBaseArray(
      Float32Array.from([1, 2, 3, 4, 5, 6]),
      [2, 3],
    );

    expect(baseArray.shape).toEqual([2, 3]);
    expect(baseArray.get(1, 2)).toBe(6);
  });

  it('should accept value with more elements than dimensions', () => {
    const baseArray = getBaseArray([1, 2, 3, 4, 5, 6, 7], [2, 3]);
    expect(baseArray.get(1, 2)).toBe(6);
  });

  it('should throw if value has fewer elements than dimensions', () => {
    // e.g. empty buffer received for dataset too large to be loaded (#1650)
    expect(() => getBaseArray(new Float32Array(0), [973_350, 3000])).toThrow(
      'Expected value with at least 2920050000 elements instead of 0',
    );
    expect(() => getBaseArray([1, 2, 3], [2, 3])).toThrow(
      'Expected value with at least 6 elements instead of 3',
    );
  });
});

const axisDefNoUnit = { unit: undefined };
const axisDefUnitX = { unit: 'mm' };
const axisDefUnitY = { unit: 'degrees' };

describe('guessKeepRatio', () => {
  it('should return `cover` if units of both axes are provided and equal', () => {
    expect(guessKeepRatio(axisDefUnitX, axisDefUnitX)).toBe(true);
  });

  it('should return `fill` if units of both axes are provided but different', () => {
    expect(guessKeepRatio(axisDefUnitX, axisDefUnitY)).toBe(false);
  });

  it('should return `fill` if unit is provided for only one axis', () => {
    expect(guessKeepRatio(axisDefUnitX, undefined)).toBe(false);
    expect(guessKeepRatio(undefined, axisDefUnitY)).toBe(false);
  });

  it('should return `undefined` if both axis defs/units are undefined', () => {
    expect(guessKeepRatio(undefined, undefined)).toBeUndefined();
    expect(guessKeepRatio(axisDefNoUnit, undefined)).toBeUndefined();
    expect(guessKeepRatio(undefined, axisDefNoUnit)).toBeUndefined();
    expect(guessKeepRatio(axisDefNoUnit, axisDefNoUnit)).toBeUndefined();
  });
});

describe('migrateSqrtToRoot', () => {
  it('turn stored square roots into nth roots of n = 2, in 2D and on 3D surfaces', () => {
    const { Gamma, Log, Sqrt } = ScaleType;
    expect(migrateSqrtToRoot({ scaleType: Sqrt, rootN: 3 })).toEqual({
      scaleType: Gamma,
      rootN: 2,
    });
    expect(
      migrateSqrtToRoot({ scaleType: Log, surfaceScaleType: Sqrt }),
    ).toEqual({ scaleType: Log, surfaceScaleType: Gamma, rootN: 2 });
    expect(migrateSqrtToRoot({ scaleType: Log })).toEqual({ scaleType: Log });
  });
});

describe('toHeightScaleType', () => {
  it('draw heights linearly for nth roots, which are of colors only', () => {
    expect(toHeightScaleType([ScaleType.Gamma, 0.5])).toBe(ScaleType.Linear);
    expect(toHeightScaleType(ScaleType.Log)).toBe(ScaleType.Log);
  });
});
