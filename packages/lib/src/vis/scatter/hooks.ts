import { type Domain, type NumArray } from '@h5web/shared/vis-models';
import { useMemo } from 'react';

import { type Category } from '../categorical/models';
import { type ColorMap } from '../heatmap/models';
import { type VisScaleType } from '../models';
import { getColorParams } from '../three-d/utils';
import {
  getAutoPointSize,
  getCategoryLut,
  getCategoryParams,
  getFiniteExtent,
  getPointColors,
  getPointSizes,
  getSrgbLut,
  type Rgb255,
  toRgb255,
} from './utils';

export const DEFAULT_SIZE_RANGE: [number, number] = [2, 12];
const DEFAULT_COLOR: Rgb255 = [31, 119, 180]; // #1f77b4

export interface PointStyleParams {
  values?: NumArray; // colour channel
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  color?: string; // CSS colour of all points without colour channel
  nanColor?: string; // shown instead of hiding values that cannot be coloured
  belowColor?: string;
  aboveColor?: string;
  sizes?: NumArray; // size channel
  sizeRange?: [number, number]; // diameters in CSS pixels
  pointSize?: number; // diameter without size channel (default: from number of points)
  categories?: Category[]; // integer labels: a color per category (others as NaN)
}

export interface PointStyle {
  colors: Uint8Array;
  sizes: Float32Array;
  sizeDomain: Domain | undefined;
  sizeRange: [number, number];
}

/** Colour and size buffers of points, recomputed only when their inputs change. */
export function usePointStyle(
  positions: Float32Array,
  params: PointStyleParams,
): PointStyle {
  const {
    values,
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    color,
    nanColor,
    belowColor,
    aboveColor,
    sizes: sizeValues,
    sizeRange = DEFAULT_SIZE_RANGE,
    pointSize,
    categories,
  } = params;
  const count = positions.length / 3;

  const colorParams = useMemo(
    () =>
      values &&
      (categories
        ? getCategoryParams(values, categories)
        : getColorParams(values, domain, scaleType)),
    [values, domain, scaleType, categories],
  );

  const colors = useMemo(
    () =>
      getPointColors(
        count,
        colorParams,
        colorParams
          ? {
              lut: categories
                ? getCategoryLut(categories)
                : getSrgbLut(colorMap, invertColorMap),
              nan: toRgb255(nanColor),
              below: categories ? undefined : toRgb255(belowColor),
              above: categories ? undefined : toRgb255(aboveColor),
            }
          : (toRgb255(color) ?? DEFAULT_COLOR),
      ),
    [
      count,
      colorParams,
      colorMap,
      invertColorMap,
      nanColor,
      belowColor,
      aboveColor,
      color,
      categories,
    ],
  );

  const sizeDomain = useMemo(
    () => sizeValues && getFiniteExtent(sizeValues),
    [sizeValues],
  );

  const [minPx, maxPx] = sizeRange;
  const sizes = useMemo(
    () =>
      getPointSizes(positions, {
        basePx: pointSize ?? getAutoPointSize(count),
        values: sizeValues,
        domain: sizeDomain,
        range: [minPx, maxPx],
        colorParams,
        showNan: !!toRgb255(nanColor),
      }),
    [
      positions,
      pointSize,
      count,
      sizeValues,
      sizeDomain,
      minPx,
      maxPx,
      colorParams,
      nanColor,
    ],
  );

  return { colors, sizes, sizeDomain, sizeRange: [minPx, maxPx] };
}
