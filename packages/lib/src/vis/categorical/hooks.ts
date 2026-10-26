import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import ndarray, { type NdArray } from 'ndarray';
import { useMemo } from 'react';

import { type VisScaleType } from '../models';
import { type Category } from './models';
import { getCategoryDomain, getCategoryIndices } from './utils';

export interface CategoryArray {
  indices: NdArray<Float32Array>; // of the values among the categories (`NaN`: none)
  colors: string[]; // of the categories, looked up by index (cf. `getCategoryTexture`)
  domain: Domain; // over which indices map to their colors
  scaleType: VisScaleType;
}

/* Values as indices of their categories, to color them by lookup rather than with a color map;
 * ignored values (e.g. fill values, even if listed as categories) as NaN */
export function useCategoryArray(
  dataArray: NdArray<NumArray>,
  categories: Category[] | undefined,
  ignoreValue?: IgnoreValue,
): CategoryArray | undefined {
  return useMemo(
    () =>
      categories && {
        indices: ndarray(
          getCategoryIndices(dataArray.data, categories, ignoreValue),
          dataArray.shape,
        ),
        colors: categories.map(({ color }) => color),
        domain: getCategoryDomain(categories),
        scaleType: ScaleType.Linear,
      },
    [dataArray, categories, ignoreValue],
  );
}
