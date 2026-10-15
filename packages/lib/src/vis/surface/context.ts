import { type Domain } from '@h5web/shared/vis-models';
import { createContext, useContext } from 'react';
import { type Vector3Tuple } from 'three';

import { type ColorMap } from '../heatmap/models';
import { type VisScaleType } from '../models';

export interface SurfaceContextValue {
  /* World position of a point given in data coordinates, at the height of `value` (in the
   * surface's height scale and domain) or, without `value`, on the surface; `undefined` if
   * the point is outside the surface or its height is not supported by the scale */
  dataToWorld: (
    x: number,
    y: number,
    value?: number,
  ) => Vector3Tuple | undefined;
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
}

export const SurfaceContext = createContext<SurfaceContextValue | undefined>(
  undefined,
);

export function useSurfaceContext(): SurfaceContextValue {
  const value = useContext(SurfaceContext);
  if (!value) {
    throw new Error('Expected to be rendered as a child of `SurfaceVis`');
  }
  return value;
}
