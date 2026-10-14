import { describe, expect, it } from 'vitest';

import { getBaseArray, guessKeepRatio } from './utils';

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
