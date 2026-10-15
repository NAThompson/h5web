import { createMemo } from '@h5web/shared/createMemo';
import { type NumArray } from '@h5web/shared/vis-models';
import { useEffect, useMemo } from 'react';

import { type AxisParams } from '../models';
import { withSymlogConstant } from '../utils';
import {
  getCellEdges,
  getDataTexture,
  getHeatmapAxis,
  getIndexToPosition,
  getInterpolator,
  getMask,
  getPixelEdgeValues,
  getPixelsTexture,
  getSafeDomain,
  getVisDomain,
  type HeatmapAxis,
  toTextureSafeNdArray,
} from './utils';

export const useVisDomain = createMemo(getVisDomain);
export const useSafeDomain = createMemo(getSafeDomain);
export const usePixelEdgeValues = createMemo(getPixelEdgeValues);
export const useCellEdges = createMemo(getCellEdges);
export const useIndexToPosition = createMemo(getIndexToPosition);
export const useTextureSafeNdArray = createMemo(toTextureSafeNdArray);
export const useDataTexture = createMemo(getDataTexture);
export const usePixelsTexture = createMemo(getPixelsTexture);
export const useMask = createMemo(getMask);
export const useInterpolator = createMemo(getInterpolator);

/* Pixels of a heatmap axis on its scale (cf. `getHeatmapAxis`) */
export function useHeatmapAxis(
  values: NumArray | undefined,
  pixelCount: number,
  params: Pick<AxisParams, 'scaleType' | 'symlogConstant'>,
): HeatmapAxis {
  const { scaleType, symlogConstant } = params;
  return useMemo(
    () =>
      getHeatmapAxis(
        values,
        pixelCount,
        withSymlogConstant(scaleType, symlogConstant),
      ),
    [values, pixelCount, scaleType, symlogConstant],
  );
}

// Free GPU resources (e.g. textures) when object is replaced or on unmount
export function useDisposeOnChange(
  obj: { dispose: () => void } | undefined,
): void {
  useEffect(() => () => obj?.dispose(), [obj]);
}
