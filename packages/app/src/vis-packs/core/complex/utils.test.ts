import { mockValues } from '@h5web/lib';
import { type H5WebComplex } from '@h5web/shared/hdf5-models';
import { describe, expect, it } from 'vitest';

import {
  decimateCurve,
  getCurveAbscissas,
  getPhaseAmplitude,
  getRealImag,
  getRealImagDomain,
  unwrapPhase,
} from './utils';

const VALUES = mockValues.oneD_complex().data;

function expectCloseTo(sourceArray: Float64Array, expectedArray: number[]) {
  sourceArray.forEach((val, i) => {
    expect(val, `index=${i}`).toBeCloseTo(expectedArray[i], 1);
  });
}

describe('getPhaseAmplitude', () => {
  it('should compute phase and amplitude of complex numbers', () => {
    const { phase, amplitude } = getPhaseAmplitude(VALUES);

    expectCloseTo(amplitude, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expectCloseTo(phase, [
      Math.PI,
      0,
      Math.PI,
      0,
      Math.PI,
      0,
      Math.PI,
      0,
      Math.PI,
      0,
    ]);
  });
});

describe('unwrapPhase', () => {
  it('should unwrap phase values by removing 2π discontinuities', () => {
    const { phase } = getPhaseAmplitude(VALUES);
    const unwrapped = unwrapPhase(phase);

    expectCloseTo(unwrapped, [
      Math.PI,
      2 * Math.PI,
      3 * Math.PI,
      4 * Math.PI,
      5 * Math.PI,
      6 * Math.PI,
      7 * Math.PI,
      8 * Math.PI,
      9 * Math.PI,
      10 * Math.PI,
    ]);
  });

  it('should handle arrays with 0 or 1 values', () => {
    const unwrapped1 = unwrapPhase(new Float64Array([]));
    expect(unwrapped1).toStrictEqual(new Float64Array([]));

    const unwrapped2 = unwrapPhase(new Float64Array([2 * Math.PI]));
    expect(unwrapped2).toStrictEqual(new Float64Array([2 * Math.PI]));
  });
});

describe('getRealImag', () => {
  it('should split complex values into real and imaginary parts', () => {
    const { real, imag } = getRealImag([
      [1, 2],
      [-3, 0.5],
    ]);
    expect([...real]).toEqual([1, -3]);
    expect([...imag]).toEqual([2, 0.5]);
  });
});

describe('getCurveAbscissas', () => {
  it('should return indices without axis values', () => {
    expect([...getCurveAbscissas(undefined, 3)]).toEqual([0, 1, 2]);
  });

  it('should return axis values as is when one per point', () => {
    const values = [0, 0.5, 2];
    expect(getCurveAbscissas(values, 3)).toBe(values);
  });

  it('should return mid-points of bin edges', () => {
    expect([...getCurveAbscissas([0, 2, 6, 8], 3)]).toEqual([1, 4, 7]);
  });
});

describe('decimateCurve', () => {
  it('should leave short curves untouched', () => {
    const arrays = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    expect(decimateCurve(arrays, 3)).toBe(arrays);
  });

  it('should keep at most the given number of points, including both endpoints', () => {
    const x = Array.from({ length: 10 }, (_, i) => i);
    const y = x.map((val) => val * 10);
    const [dx, dy] = decimateCurve([x, y], 4);

    expect([...dx]).toEqual([0, 3, 6, 9]);
    expect([...dy]).toEqual([0, 30, 60, 90]);
  });

  it('should keep last point even if not on stride', () => {
    const x = Array.from({ length: 11 }, (_, i) => i);
    const [dx] = decimateCurve([x], 4);
    expect(dx.length).toBeLessThanOrEqual(4);
    expect(dx[0]).toBe(0);
    expect(dx.at(-1)).toBe(10);
  });
});

describe('getRealImagDomain', () => {
  it('should get domain of real or imaginary parts', () => {
    const values: H5WebComplex[] = [
      [1, -2],
      [-3, 4],
      [Number.NaN, 0.5],
    ];
    expect(getRealImagDomain(values, 'real')).toEqual([-3, 1]);
    expect(getRealImagDomain(values, 'imag')).toEqual([-2, 4]);
  });

  it('should consider real numbers as having no imaginary parts', () => {
    expect(getRealImagDomain([2, -1, 5], 'real')).toEqual([-1, 5]);
    expect(getRealImagDomain([2, -1, 5], 'imag')).toEqual([0, 0]);
    expect(getRealImagDomain([], 'real')).toBeUndefined();
  });
});
