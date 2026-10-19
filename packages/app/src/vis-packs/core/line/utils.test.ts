import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import { getMultiPlotSliceLabel, getSplinesDomain } from './utils';

describe('getMultiPlotSliceLabel', () => {
  it('label slice with its index when dimension has no scale', () => {
    expect(getMultiPlotSliceLabel(0, 3, undefined, undefined)).toBe('D0[3]');
    expect(getMultiPlotSliceLabel(1, 2, 'row', undefined)).toBe('D1[2]');
  });

  it('label slice with dimension scale value', () => {
    expect(getMultiPlotSliceLabel(0, 2, 'time (ms)', [10, 20, 30])).toBe(
      'time (ms): 30',
    );
    expect(getMultiPlotSliceLabel(1, 0, undefined, [0.5, 1.5])).toBe('D1: 0.5');
  });

  it('label slice with its slice label alone', () => {
    expect(getMultiPlotSliceLabel(0, 1, 'angle', [0, 30], ['a', 'b'])).toBe(
      'b',
    );
  });
});

describe('getSplinesDomain', () => {
  const xs = [0, 1, 2, 3];
  const flat = ndarray([1, 1, 1, 1]);
  const bump = ndarray([0, 0, 10, 0]); // spline overshoots below 0
  const lin = ScaleType.Linear;

  it('combine the splines of visible curves only', () => {
    expect(
      getSplinesDomain(xs, [{ array: flat }], undefined, lin, lin),
    ).toEqual([1, 1]);
    const hidden = [{ array: flat }, { array: bump, visible: false }];
    expect(getSplinesDomain(xs, hidden, undefined, lin, lin)).toEqual([1, 1]);

    const [min, max] =
      getSplinesDomain(xs, [{ array: bump }], undefined, lin, lin) ?? [];
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(10);
  });

  it("use the dataset's `ignoreValue` for curves without their own", () => {
    const curves = [{ array: bump }, { array: flat, ignoreValue: () => false }];
    expect(getSplinesDomain(xs, curves, (val) => val === 10, lin, lin)).toEqual(
      [0, 1],
    );
  });
});
