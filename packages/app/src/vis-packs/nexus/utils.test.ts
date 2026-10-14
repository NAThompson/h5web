import {
  arrayShape,
  cplxType,
  floatType,
  intType,
} from '@h5web/shared/hdf5-utils';
import { arrayAttr, dataset, group } from '@h5web/shared/mock-utils';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { type DataContextValue } from '../../providers/DataProvider';
import {
  applyDefaultSlice,
  findAuxErrorDataset,
  findAuxiliaryDatasets,
  isPrimaryVolume,
  isVolumeSignal,
} from './utils';

describe('applyDefaultSlice', () => {
  it('should apply slicing indices', () => {
    expect(applyDefaultSlice([0], [5])).toEqual([5]);
    expect(applyDefaultSlice([0, 'x'], [5, '.'])).toEqual([5, 'x']);
    expect(
      applyDefaultSlice([0, 0, 'x', 'y', null], [1, 2, '.', '.', '.']),
    ).toEqual([1, 2, 'x', 'y', null]);
  });

  it('should apply slicing indices and remap dimensions', () => {
    expect(applyDefaultSlice([0, 'x'], ['.', 5])).toEqual(['x', 5]);
    expect(
      applyDefaultSlice([0, 0, 'x', 'y', null], ['.', '.', 1, '.', 2]),
    ).toEqual(['x', 'y', 1, null, 2]);
  });

  it('should have no effect when there are no sliceable dimensions', () => {
    expect(applyDefaultSlice([], [])).toEqual([]);
    expect(applyDefaultSlice(['x'], ['.'])).toEqual(['x']);
    expect(applyDefaultSlice(['x', 'y'], ['.', '.'])).toEqual(['x', 'y']);
    expect(applyDefaultSlice(['x', null, null], ['.', '.', '.'])).toEqual([
      'x',
      null,
      null,
    ]);
  });

  it('should have no effect when default slice is incompatible with mapping', () => {
    expect(applyDefaultSlice(['x'], [5])).toEqual(['x']);
    expect(applyDefaultSlice([0], ['.'])).toEqual([0]);
    expect(applyDefaultSlice([0, 'x'], ['.', '.'])).toEqual([0, 'x']);
    expect(applyDefaultSlice([0, null], [5, 5])).toEqual([0, null]);
    expect(applyDefaultSlice(['x', 'y'], ['.', 5])).toEqual(['x', 'y']);
    expect(applyDefaultSlice(['x', null], ['.', 5])).toEqual(['x', null]);
    expect(applyDefaultSlice([0, 0, 'x'], ['.', 5, '.'])).toEqual([0, 0, 'x']);
  });
});

describe('findAuxiliaryDatasets', () => {
  it('should ignore auxiliary signals with dimensions different from signal', async () => {
    const signal = dataset('signal', arrayShape([2, 3]), floatType());
    const aux = dataset('aux', arrayShape([2, 3]), floatType());
    const auxShort = dataset('aux_short', arrayShape([2]), floatType());
    const auxAttr = arrayAttr('auxiliary_signals', ['aux_short', 'aux']);
    const nxDataGroup = group('nx', [signal, aux, auxShort], {
      attributes: [auxAttr],
    });

    const dataContext = {
      queryClient: new QueryClient(),
      queries: {
        attrValues: () => ({
          queryKey: ['attrValues'],
          queryFn: () => ({ auxiliary_signals: auxAttr.value }),
        }),
      },
    } as unknown as DataContextValue;

    const auxDatasets = await findAuxiliaryDatasets(
      nxDataGroup,
      signal,
      dataContext,
    );
    expect(auxDatasets).toEqual([aux]);
  });
});

describe('findAuxErrorDataset', () => {
  it('should ignore errors with dimensions different from auxiliary signal', () => {
    const aux = dataset('aux', arrayShape([2, 3]), floatType());
    const auxErrors = dataset('aux_errors', arrayShape([2, 3]), floatType());
    const badAuxErrors = dataset('aux_errors', arrayShape([3]), floatType());

    expect(findAuxErrorDataset(group('nx', [aux, auxErrors]), aux)).toBe(
      auxErrors,
    );
    expect(
      findAuxErrorDataset(group('nx', [aux, badAuxErrors]), aux),
    ).toBeUndefined();
  });
});

function vol(dims: number[]) {
  return dataset('signal', arrayShape(dims), floatType());
}

describe('isVolumeSignal', () => {
  it('should accept numeric signals with at least three dimensions', () => {
    expect(isVolumeSignal(vol([4, 5, 6]), undefined)).toBe(true);
    expect(isVolumeSignal(vol([2, 4, 5, 6]), 'image')).toBe(true);
    expect(
      isVolumeSignal(dataset('s', arrayShape([4, 4, 4]), intType()), undefined),
    ).toBe(true);
  });

  it('should reject other signals', () => {
    expect(isVolumeSignal(vol([5, 6]), undefined)).toBe(false);
    expect(isVolumeSignal(vol([1, 5, 6]), undefined)).toBe(false); // flat volume
    expect(isVolumeSignal(vol([5, 6, 3]), 'rgb-image')).toBe(false);
    expect(isVolumeSignal(vol([5, 6, 4]), 'rgba-image')).toBe(false);
    expect(
      isVolumeSignal(
        dataset('s', arrayShape([4, 4, 4]), cplxType(floatType())),
        undefined,
      ),
    ).toBe(false);
  });
});

describe('isPrimaryVolume', () => {
  const axis = dataset('k', arrayShape([4]), floatType());
  const cube = vol([4, 4, 4]);

  it('should make 3D signals with an axis on every dimension and no interpretation default', () => {
    expect(isPrimaryVolume(undefined, cube, [axis, axis, axis])).toBe(true);
  });

  it('should keep heatmap as default otherwise', () => {
    // Stack of images
    expect(isPrimaryVolume('image', cube, [axis, axis, axis])).toBe(false);
    // Axes missing along some dimensions (e.g. frame index)
    expect(isPrimaryVolume(undefined, cube, [undefined, axis, axis])).toBe(
      false,
    );
    expect(isPrimaryVolume(undefined, cube, [])).toBe(false);
    // More than three dimensions
    const fourD = dataset('signal', arrayShape([2, 4, 4, 4]), floatType());
    expect(isPrimaryVolume(undefined, fourD, [axis, axis, axis, axis])).toBe(
      false,
    );
    // Too large to load at once
    const big = dataset('signal', arrayShape([300, 300, 300]), floatType());
    expect(isPrimaryVolume(undefined, big, [axis, axis, axis])).toBe(false);
  });
});
