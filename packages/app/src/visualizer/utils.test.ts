import { arrayShape, floatType, strType } from '@h5web/shared/hdf5-utils';
import { arrayAttr, dataset, group } from '@h5web/shared/mock-utils';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { type DataContextValue } from '../providers/DataProvider';
import { NX_DATA_VIS, NxDataVis } from '../vis-packs/nexus/visualizations';
import { findAxesForPrimaryVis, findPrimaryVis } from './utils';

const k = dataset('k', arrayShape([4]), floatType());
const signal = dataset('signal', arrayShape([4, 4, 4]), floatType());
const { NxLine, NxVolume, NxHeatmap, NxRGB, NxSurface } = NxDataVis;

describe('findPrimaryVis', () => {
  it('should make gridded volumes primary', () => {
    const supported = [NxLine, NxVolume, NxHeatmap].map((v) => NX_DATA_VIS[v]);
    expect(findPrimaryVis(supported, undefined, signal, [k, k, k])).toBe(
      NX_DATA_VIS[NxVolume],
    );
    expect(findPrimaryVis(supported, undefined, signal, [])).toBeUndefined();
  });

  it('should let RGB images and geometries take precedence over volumes', () => {
    const withRgb = [NxLine, NxVolume, NxHeatmap, NxRGB].map(
      (v) => NX_DATA_VIS[v],
    );
    expect(findPrimaryVis(withRgb, undefined, signal, [k, k, k])).toBe(
      NX_DATA_VIS[NxRGB],
    );

    const withSurface = [NxLine, NxVolume, NxHeatmap, NxSurface].map(
      (v) => NX_DATA_VIS[v],
    );
    expect(findPrimaryVis(withSurface, undefined, signal, [k, k, k])).toBe(
      NX_DATA_VIS[NxSurface],
    );
  });
});

function getDataContext(axes: () => unknown): DataContextValue {
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    queries: {
      attrValues: () => ({
        queryKey: ['attrValues'],
        queryFn: () => ({ axes: axes() }),
      }),
    },
  } as unknown as DataContextValue;
}

describe('findAxesForPrimaryVis', () => {
  const axesAttr = arrayAttr('axes', ['k', 'k', 'k']);

  it('should treat malformed axes as missing', async () => {
    const label = dataset('k', arrayShape([4]), strType()); // not numeric
    const nxData = group('nx', [signal, label], { attributes: [axesAttr] });

    await expect(
      findAxesForPrimaryVis(
        nxData,
        signal,
        getDataContext(() => axesAttr.value),
      ),
    ).resolves.toEqual([]);
  });

  it('should rethrow transient errors so they are not cached', async () => {
    const nxData = group('nx', [signal, k], { attributes: [axesAttr] });
    const dataContext = getDataContext(() => {
      throw new Error('Network Error');
    });

    await expect(
      findAxesForPrimaryVis(nxData, signal, dataContext),
    ).rejects.toThrow('Network Error');
  });
});
