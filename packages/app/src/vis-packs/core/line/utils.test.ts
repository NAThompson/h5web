import { describe, expect, it } from 'vitest';

import { getMultiPlotSliceLabel } from './utils';

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
