import { describe, expect, it } from 'vitest';

import { type Projection } from '../../view-hints/models';
import {
  getProjectionAxis,
  getProjectionDim,
  getProjectionSelection,
  projectArray,
} from './projection';

const nan = Number.NaN;

// Shape [2, 3]: [[1, NaN, 3], [4, NaN, -6]]
const VALUES = [1, nan, 3, 4, nan, -6];

function isFill(val: number): boolean {
  return val === -999;
}

describe('projectArray', () => {
  it('should reduce along the first axis, ignoring NaN', () => {
    expect([...projectArray(VALUES, [2, 3], 0, 'max')]).toStrictEqual([
      4,
      nan,
      3,
    ]);
    expect([...projectArray(VALUES, [2, 3], 0, 'min')]).toStrictEqual([
      1,
      nan,
      -6,
    ]);
    expect([...projectArray(VALUES, [2, 3], 0, 'mean')]).toStrictEqual([
      2.5,
      nan,
      -1.5,
    ]);
    expect([...projectArray(VALUES, [2, 3], 0, 'sum')]).toStrictEqual([
      5, 0, -3,
    ]);
  });

  it('should reduce along the last axis', () => {
    expect([...projectArray(VALUES, [2, 3], 1, 'max')]).toStrictEqual([3, 4]);
    expect([...projectArray(VALUES, [2, 3], 1, 'mean')]).toStrictEqual([2, -1]);
  });

  it('should reduce along a middle axis', () => {
    // Shape [2, 3, 2]: value 100 a + 10 b + c
    const values = Array.from({ length: 12 }, (_, i) => {
      const [a, b, c] = [Math.floor(i / 6), Math.floor(i / 2) % 3, i % 2];
      return 100 * a + 10 * b + c;
    });
    expect([...projectArray(values, [2, 3, 2], 1, 'max')]).toStrictEqual([
      20, 21, 120, 121,
    ]);
    expect([...projectArray(values, [2, 3, 2], 1, 'sum')]).toStrictEqual([
      30, 33, 330, 333,
    ]);
  });

  it('should skip ignored values in every reduction, along any axis', () => {
    // Shape [2, 2]: [[1, -999], [3, 5]]
    const values = [1, -999, 3, 5];
    function along0(kind: Projection): number[] {
      return [...projectArray(values, [2, 2], 0, kind, isFill)];
    }
    expect(along0('max')).toStrictEqual([3, 5]);
    expect(along0('min')).toStrictEqual([1, 5]);
    expect(along0('mean')).toStrictEqual([2, 5]);
    expect(along0('sum')).toStrictEqual([4, 5]);

    // Contiguous runs (last axis)
    function along1(kind: Projection): number[] {
      return [...projectArray(values, [2, 2], 1, kind, isFill)];
    }
    expect(along1('max')).toStrictEqual([1, 5]);
    expect(along1('mean')).toStrictEqual([1, 4]);
    expect([
      ...projectArray([-999, -999], [2], 0, 'mean', isFill),
    ]).toStrictEqual([nan]);
    expect([
      ...projectArray([-999, -999], [2], 0, 'sum', isFill),
    ]).toStrictEqual([0]);
  });

  it('should keep values beyond the range of float32', () => {
    expect(projectArray([1e300, 1e301], [2], 0, 'max')[0]).toBe(1e301);
  });

  it('should accumulate in double precision', () => {
    const values = new Float32Array(1000).fill(0.1);
    expect(projectArray(values, [1000], 0, 'sum')[0]).toBeCloseTo(100, 4);
  });

  it('should reduce a 256³ volume quickly', () => {
    const dims = [256, 256, 256];
    const values = Float32Array.from({ length: 256 ** 3 }, (_, i) => i % 7);
    projectArray(values, dims, 0, 'max'); // warm up

    for (const ignore of [undefined, isFill]) {
      for (const kind of ['max', 'mean'] as const) {
        for (const axis of [0, 2]) {
          const start = performance.now();
          const result = projectArray(values, dims, axis, kind, ignore);
          const elapsed = performance.now() - start;
          const note = ignore ? ' (ignoreValue)' : '';
          // eslint-disable-next-line no-console
          console.log(
            `256³ ${kind} along ${axis}${note}: ${elapsed.toFixed(1)} ms`,
          );
          expect(result).toHaveLength(256 ** 2);
          expect(elapsed).toBeLessThan(1000); // loose bound: timings vary across machines
        }
      }
    }
  });
});

describe('getProjectionDim', () => {
  it('should take the chosen dimension if sliced, else the first sliced one', () => {
    expect(getProjectionDim([0, 0, 'y', 'x'], 1)).toBe(1);
    expect(getProjectionDim([0, 0, 'y', 'x'], 2)).toBe(0);
    expect(getProjectionDim([0, 0, 'y', 'x'])).toBe(0);
    expect(getProjectionDim(['y', 'x'])).toBeUndefined();
  });
});

describe('getProjectionSelection', () => {
  it('should select the projected dimension whole', () => {
    expect(getProjectionSelection([3, 2, 'y', 'x'], 1)).toBe('3,:,:,:');
    expect(getProjectionSelection([2, 'y', 'x'], 0)).toBeUndefined();
  });
});

describe('getProjectionAxis', () => {
  it('should find the projected dimension among the fetched ones', () => {
    expect(getProjectionAxis([3, 2, 'y', 'x'], 1)).toBe(0);
    expect(getProjectionAxis(['y', 3, 'x'], 1)).toBe(1);
    expect(getProjectionAxis(['y', 'x', 0, 5], 3)).toBe(2);
  });
});
