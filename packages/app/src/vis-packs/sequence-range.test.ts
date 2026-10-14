import { getSliceSelection } from '@h5web/lib';
import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import { dataset } from '@h5web/shared/mock-utils';
import { describe, expect, it } from 'vitest';

import { getSliceEntries, MAX_SEEDED_SLICES } from './sequence-range';

// Dims [2, 3, 4], values 0 to 23
const ds = dataset('cube', arrayShape([2, 3, 4]), floatType(64));
const cube = Float64Array.from({ length: 24 }, (_, i) => i);

function toRequest(mapping: (number | 'x' | 'y' | null)[]) {
  return { dataset: ds, selection: getSliceSelection(mapping) };
}

describe('getSliceEntries', () => {
  it('should split sequence along first kept dimension', () => {
    // Sequence of D0 slices of `[0, 'y', 'x']`: whole cube
    const entries = getSliceEntries(
      cube,
      toRequest([null, 'y', 'x']),
      [0, 'y', 'x'],
      0,
      toRequest,
    );

    expect(entries.map(({ request }) => request.selection)).toStrictEqual([
      '0,:,:',
      '1,:,:',
    ]);
    expect([...(entries[1].value as Float64Array)]).toStrictEqual(
      Array.from({ length: 12 }, (_, i) => 12 + i),
    );
    expect((entries[1].value as Float64Array).buffer).not.toBe(cube.buffer); // copy
  });

  it('should gather slices along inner dimension', () => {
    // Sequence of D2 slices of `['y', 'x', 0]`: whole cube; slice k is cube[:, :, k]
    const entries = getSliceEntries(
      cube,
      toRequest(['y', 'x', null]),
      ['y', 'x', 0],
      2,
      toRequest,
    );

    expect(entries).toHaveLength(4);
    expect(entries[1].request.selection).toBe(':,:,1');
    expect([...(entries[1].value as Float64Array)]).toStrictEqual([
      1, 5, 9, 13, 17, 21,
    ]);
  });

  it('should split sequence with other dimensions sliced', () => {
    // Sequence of D0 slices of `[0, 1, 'x']`: cube[:, 1, :]
    const sequence = Float64Array.from([4, 5, 6, 7, 16, 17, 18, 19]);
    const entries = getSliceEntries(
      sequence,
      toRequest([null, 1, 'x']),
      [0, 1, 'x'],
      0,
      toRequest,
    );

    expect(entries.map(({ request }) => request.selection)).toStrictEqual([
      '0,1,:',
      '1,1,:',
    ]);
    expect([...(entries[1].value as Float64Array)]).toStrictEqual([
      16, 17, 18, 19,
    ]);
  });

  it('should ignore values with unexpected layout', () => {
    expect(
      getSliceEntries(
        cube.subarray(0, 5),
        toRequest([null, 'y', 'x']),
        [0, 'y', 'x'],
        0,
        toRequest,
      ),
    ).toStrictEqual([]);
  });

  it('should only split slices coming next, up to a limit', () => {
    const longDs = dataset('long', arrayShape([600, 2]), floatType(64));
    const long = Float64Array.from({ length: 1200 }, (_, i) => i);
    function toLongRequest(mapping: (number | 'x' | 'y' | null)[]) {
      return { dataset: longDs, selection: getSliceSelection(mapping) };
    }

    const entries = getSliceEntries(
      long,
      toLongRequest([null, 'x']),
      [550, 'x'],
      0,
      toLongRequest,
    );

    expect(entries).toHaveLength(MAX_SEEDED_SLICES);
    expect(entries[0].request.selection).toBe('550,:');
    expect(entries[50].request.selection).toBe('0,:'); // wraps around
    expect([...(entries[0].value as Float64Array)]).toStrictEqual([1100, 1101]);
  });
});
