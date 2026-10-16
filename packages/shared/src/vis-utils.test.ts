import ndarray, { type NdArray } from 'ndarray';
import { describe, expect, it } from 'vitest';

import { type ArrayValue } from './hdf5-models';
import {
  createArrayFromView,
  formatBound,
  formatNumber,
  formatTick,
  getBounds,
  getBoundsWithErrors,
  mergeBounds,
} from './vis-utils';

function range(length: number): number[] {
  return Array.from({ length }, (_, i) => i);
}

// Naive reference: read every element of the view in C order with `get`
function referenceCopy(view: NdArray<ArrayValue>) {
  const values: unknown[] = [];
  const indices = view.shape.map(() => 0);

  for (let i = 0; i < view.size; i += 1) {
    values.push(view.get(...indices));

    for (let dim = indices.length - 1; dim >= 0; dim -= 1) {
      indices[dim] += 1;
      if (indices[dim] < view.shape[dim]) {
        break;
      }
      indices[dim] = 0;
    }
  }

  return {
    type: view.data.constructor,
    shape: view.shape,
    offset: 0,
    isSameData: false,
    values,
  };
}

function actualCopy(view: NdArray<ArrayValue>) {
  const { data, shape, offset } = createArrayFromView(view);

  return {
    type: data.constructor,
    shape,
    offset,
    isSameData: data === view.data,
    values: [...data],
  };
}

describe('formatNumber', () => {
  it('should give plain numbers from 10⁻³ to 10⁵', () => {
    expect(formatNumber(3.847_86)).toBe('3.848');
    expect(formatNumber(0.038_56)).toBe('0.03856');
    expect(formatNumber(12_500)).toBe('12500');
    expect(formatNumber(1234.56)).toBe('1235');
    expect(formatNumber(0.001)).toBe('0.001');
    expect(formatNumber(99_999, 5)).toBe('99999');
    expect(formatNumber(123_456, 6)).toBe('123456'); // all digits
  });

  it('should give powers of 10 otherwise', () => {
    expect(formatNumber(1.2e-8)).toBe('1.2×10⁻⁸');
    expect(formatNumber(2.749e-12)).toBe('2.749×10⁻¹²');
    expect(formatNumber(1.11e-16)).toBe('1.11×10⁻¹⁶');
    expect(formatNumber(3.1e7)).toBe('3.1×10⁷');
    expect(formatNumber(123_456)).toBe('1.235×10⁵');
    expect(formatNumber(1e-4)).toBe('10⁻⁴'); // no mantissa
    expect(formatNumber(1e21)).toBe('10²¹');
    expect(formatNumber(0.05, 3, true)).toBe('5×10⁻²'); // forced
    expect(formatNumber(1, 3, true)).toBe('10⁰');
  });

  it('should use true minus signs', () => {
    expect(formatNumber(-3.339_12)).toBe('−3.339');
    expect(formatNumber(-1e-4)).toBe('−10⁻⁴');
    expect(formatNumber(-2.5e-7)).toBe('−2.5×10⁻⁷');
  });

  it('should format special values', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(Number.NaN)).toBe('NaN');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(-Infinity)).toBe('−∞');
  });

  it('should round before choosing the notation', () => {
    expect(formatNumber(9.9999e-4)).toBe('0.001');
    expect(formatNumber(9.9994e-4)).toBe('9.999×10⁻⁴');
    expect(formatNumber(99_999.9)).toBe('10⁵');
    expect(formatNumber(99_999.9, 6)).toBe('99999.9');
    expect(formatNumber(9.999_96, 4)).toBe('10');
  });

  it('should never give e-notation', () => {
    const values = [1e-300, 5e-7, 1.5e-5, 7e12, Number.MAX_VALUE];
    values.forEach((val) => {
      expect(formatNumber(val)).not.toMatch(/e/u);
      expect(formatTick(val)).not.toMatch(/e/u);
    });
  });
});

describe('formatBound', () => {
  it('should format zero as 0', () => {
    expect(formatBound(-15)).toBe('−15');
    expect(formatBound(0)).toBe('0');
    expect(formatBound(-0)).toBe('0');
  });
});

describe('getBounds with Float32Array', () => {
  it('should give same bounds as with other arrays', () => {
    const values = [3, -2, Number.NaN, Infinity, 0, 0.5, -Infinity];
    expect(getBounds(Float32Array.from(values))).toStrictEqual(
      getBounds(Float64Array.from(values)),
    );
    expect(getBounds(Float32Array.from([Number.NaN]))).toBeUndefined();
  });
});

describe('mergeBounds', () => {
  it('should merge bounds of several arrays', () => {
    expect(
      mergeBounds([
        getBounds([-1, 2]),
        undefined,
        getBounds([0, 5]),
        getBounds([0.5]),
      ]),
    ).toStrictEqual(getBounds([-1, 2, 0, 5, 0.5]));
    expect(mergeBounds([undefined])).toBeUndefined();
  });
});

describe('getBounds', () => {
  it('should compute bounds of numeric array', () => {
    expect(getBounds([0, 1, 2])).toEqual({
      min: 0,
      max: 2,
      positiveMin: 0,
      strictPositiveMin: 1,
    });

    expect(getBounds([-1, -2, -3])).toEqual({
      min: -3,
      max: -1,
      positiveMin: Infinity,
      strictPositiveMin: Infinity,
    });
  });

  it('should ignore values', () => {
    expect(getBounds([0, 1, 2], (val) => val < 2)).toEqual({
      min: 2,
      max: 2,
      positiveMin: 2,
      strictPositiveMin: 2,
    });
  });

  it('should compute bounds of typed arrays spanning several blocks', () => {
    const values = new Float32Array(200_000).fill(5);
    values[70_000] = -2; // second block
    values[150_000] = 0.5; // third block
    values[199_999] = 8; // last, partial block
    values[100] = Number.NaN;

    expect(getBounds(values)).toEqual({
      min: -2,
      max: 8,
      positiveMin: 0.5,
      strictPositiveMin: 0.5,
    });

    expect(getBounds(new Uint16Array([3, 0, 65_535]))).toEqual({
      min: 0,
      max: 65_535,
      positiveMin: 0,
      strictPositiveMin: 3,
    });
  });

  it('should return undefined if empty or none of the values are finite', () => {
    expect(getBounds([])).toBeUndefined();
    expect(getBounds([Number.NaN, Infinity, -Infinity])).toBeUndefined();
  });
});

describe('getBoundsWithErrors', () => {
  const bounds = { min: 0, max: 2, positiveMin: 0, strictPositiveMin: 1 };

  it('should compute bounds with and without errors', () => {
    expect(getBoundsWithErrors([0, 1, 2], [1, 0.5, 2])).toEqual([
      { min: -1, max: 4, positiveMin: 0, strictPositiveMin: 0.5 },
      bounds,
    ]);
  });

  it('should ignore non-finite errors', () => {
    expect(
      getBoundsWithErrors([0, 1, 2], [Number.NaN, Infinity, -Infinity]),
    ).toEqual([bounds, bounds]);
  });

  it('should return same bounds when errors array is undefined', () => {
    expect(getBoundsWithErrors([0, 1, 2], undefined)).toEqual([bounds, bounds]);
  });

  it('should return undefined bounds if none of the values are finite', () => {
    expect(
      getBoundsWithErrors([Number.NaN, Infinity, -Infinity], [1, 0.5, 2]),
    ).toEqual([undefined, undefined]);
  });
});

describe('createArrayFromView', () => {
  const arr4d = ndarray(Float64Array.from(range(2 * 3 * 4 * 5)), [2, 3, 4, 5]);

  it('should copy 0-D views', () => {
    const views = [
      ndarray(new Float32Array([42]), []),
      arr4d.pick(1, 2, 3, 4),
      arr4d.pick(1, 0, 2, null).pick(3),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy 1-D views', () => {
    const arr = ndarray(Int16Array.from(range(10)), [10]);

    const views = [
      arr,
      arr.lo(3),
      arr.hi(7).lo(2),
      arr.step(3),
      arr.step(-1),
      arr.lo(1).step(-4),
      arr4d.pick(1, null, 2, 3),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy transposed views', () => {
    const arr = ndarray(Float32Array.from(range(12)), [3, 4]);
    expect(actualCopy(arr.transpose(1, 0)).values).toEqual([
      0, 4, 8, 1, 5, 9, 2, 6, 10, 3, 7, 11,
    ]);

    const views = [
      arr.transpose(1, 0),
      arr4d.transpose(3, 1, 0, 2),
      arr4d.transpose(1, 0, 3, 2).lo(1, 1, 1, 0),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy stepped and sliced N-D views', () => {
    const views = [
      arr4d.lo(1, 1, 1, 1),
      arr4d.hi(2, 2, 3, 4).lo(0, 1, 1, 2),
      arr4d.step(1, -1, 2, -2),
      arr4d.step(-1, 2, -3, 1).lo(0, 0, 0, 1),
      arr4d.pick(null, 1, null, null).step(1, -1, 2),
      arr4d.pick(null, null, null, 2).transpose(2, 0, 1),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy contiguous views and views with length-1 dimensions', () => {
    const views = [
      arr4d,
      arr4d.pick(1),
      arr4d.pick(1, 2),
      arr4d.lo(1).hi(1),
      arr4d.lo(0, 1).hi(2, 1),
      arr4d.lo(0, 0, 0, 3).hi(2, 3, 4, 1),
      ndarray(Float64Array.from(range(6)), [1, 6, 1]),
      ndarray(Float64Array.from(range(6)), [6, 1], [1, 6]),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy views with zero strides', () => {
    const views = [
      ndarray(Uint8Array.from(range(4)), [3, 4], [0, 1]),
      ndarray(Uint8Array.from(range(4)), [4, 3], [1, 0], 0),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy empty views', () => {
    const views = [
      ndarray(new Float32Array(0), [0]),
      arr4d.hi(2, 0, 4, 5),
      arr4d.lo(0, 0, 0, 5).transpose(3, 0, 1, 2),
    ];
    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy views spanning multiple tiles', () => {
    // Larger than tile size (64) and not a multiple of it
    const values = range(3 * 70 * 130);

    const views = [
      Float32Array.from(values),
      Float64Array.from(values),
      Uint8Array.from(values),
      values,
    ].flatMap((data) => {
      const arr = ndarray(data, [3, 70, 130]);
      return [
        arr.transpose(2, 1, 0),
        arr.transpose(0, 2, 1).lo(0, 5, 3),
        arr.pick(1).transpose(1, 0).step(-1, 2),
        arr.step(1, -1, 3).transpose(1, 2, 0),
      ];
    });

    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should copy random views', () => {
    // Deterministic PRNG (Park-Miller) so that failures are reproducible
    let seed = 2047;
    function randInt(max: number): number {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed % max;
    }

    const views = range(500).map(() => {
      const shape = range(1 + randInt(4)).map(() => 1 + randInt(5));
      const size = shape.reduce((acc, len) => acc * len, 1);

      const view = ndarray(Float64Array.from(range(size)), shape)
        .lo(...shape.map((len) => randInt(len)))
        .step(...shape.map(() => (1 + randInt(3)) * (randInt(2) ? 1 : -1)))
        .transpose(...range(shape.length).sort(() => randInt(3) - 1));

      return randInt(3) === 0 ? view.pick(randInt(view.shape[0])) : view;
    });

    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));
  });

  it('should preserve typed array constructor', () => {
    const values = range(12).map((i) => (i - 6) * 1000.5); // incl. negatives

    const views = [
      Int8Array,
      Uint8Array,
      Uint8ClampedArray,
      Int16Array,
      Uint16Array,
      Int32Array,
      Uint32Array,
      Float32Array,
      Float64Array,
    ].flatMap((Constructor) => {
      const arr = ndarray(Constructor.from(values), [3, 4]);
      return [arr, arr.transpose(1, 0), arr.step(-1, 2)];
    });

    const bigViews = [BigInt64Array, BigUint64Array].flatMap((Constructor) => {
      const arr = ndarray(
        Constructor.from(values.map((v) => BigInt(Math.trunc(v)))),
        [3, 4],
      );
      return [arr, arr.transpose(1, 0).lo(1, 1)];
    });

    const allViews = [...views, ...bigViews];
    expect(allViews.map(actualCopy)).toEqual(allViews.map(referenceCopy));
  });

  it('should not share storage with source', () => {
    // Like Node.js `Buffer`, whose `slice` doesn't copy
    class SharingArray extends Uint8Array {
      public override slice(
        start?: number,
        end?: number,
      ): Uint8Array<ArrayBuffer> {
        return this.subarray(start, end);
      }
    }

    const source = SharingArray.from(range(6));
    const { data } = createArrayFromView(ndarray(source, [2, 3]));
    data[0] = 42;
    expect(source[0]).toBe(0);
  });

  it('should copy plain arrays of any value', () => {
    const compounds = range(6).map((i) => [i, `${i}`]);

    const views = [
      range(6),
      range(6).map(String),
      range(6).map((i) => i % 2 === 0),
      range(6).map(BigInt),
      compounds,
    ].flatMap((values) => {
      const arr = ndarray(values, [2, 3]);
      return [arr, arr.transpose(1, 0), arr.step(-1, -2)];
    });

    expect(views.map(actualCopy)).toEqual(views.map(referenceCopy));

    // Preserve object references (e.g. compound values)
    const { data } = createArrayFromView(
      ndarray(compounds, [2, 3]).transpose(1, 0),
    );
    expect(data[0]).toBe(compounds[0]);
    expect(data[1]).toBe(compounds[3]);
  });
});
