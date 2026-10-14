import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import { needsFloat64, toAxisCoords, toFloatValues } from './utils';

describe('toFloatValues', () => {
  it('should keep single precision for float32 and small integer sources', () => {
    expect(toFloatValues(ndarray(new Float32Array(4), [2, 2]))).toBeInstanceOf(
      Float32Array,
    );
    expect(toFloatValues(ndarray(new Int16Array(4), [2, 2]))).toBeInstanceOf(
      Float32Array,
    );
    expect(
      toFloatValues(ndarray(Int32Array.from([1, 2, 3, 2 ** 20]), [2, 2])),
    ).toBeInstanceOf(Float32Array);
  });

  it('should keep double precision when float32 would lose it', () => {
    // Small variations around a large offset
    const values = Float64Array.from([1e6, 1e6 + 0.01, 1e6 + 0.02, 1e6 + 0.03]);
    const copy = toFloatValues(ndarray(values, [2, 2]));
    expect(copy).toBeInstanceOf(Float64Array);
    expect(copy[1] - copy[0]).toBeCloseTo(0.01, 6);

    expect(
      toFloatValues(ndarray(Int32Array.from([0, 1, 2, 2 ** 25 + 1]), [2, 2])),
    ).toBeInstanceOf(Float64Array);
    expect(needsFloat64([1, 2, 3])).toBe(true);
  });

  it('should copy views contiguously and replace ignored values with NaN', () => {
    const arr = ndarray(
      Float32Array.from([1, 2, 3, 4, 5, 6]),
      [2, 3],
    ).transpose(1, 0);
    const copy = toFloatValues(arr, (val) => val === 5);
    expect([...copy]).toStrictEqual([1, 4, 2, Number.NaN, 3, 6]);
  });
});

describe('toAxisCoords', () => {
  it('should use values per point, or centres of bin edges', () => {
    expect(toAxisCoords([0, 1, 2], 3)).toStrictEqual(
      Float64Array.from([0, 1, 2]),
    );
    expect(toAxisCoords([0, 2, 4, 6], 3)).toStrictEqual(
      Float64Array.from([1, 3, 5]),
    );
    expect(toAxisCoords([0, 1], 3)).toBeUndefined();
    expect(toAxisCoords(undefined, 3)).toBeUndefined();
  });
});
