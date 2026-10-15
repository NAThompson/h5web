import { isAxisScaleType } from '@h5web/shared/guards';
import {
  type AxisScaleType,
  type ComplexHeatmapVisType,
  ComplexVisType,
} from '@h5web/shared/vis-models';

import { type HeatmapSuggestions } from '../core/heatmap/config';
import { ContourMode } from '../core/heatmap/models';
import { type VolumeConfig } from '../core/volume/config';
import { type DefaultSlice } from '../nexus/models';
import { HintVis, type ViewHint } from './models';
import { isSurfaceHint } from './utils';

function toHeatmapComplexType(
  type: ComplexVisType | undefined,
): ComplexHeatmapVisType | undefined {
  return type === ComplexVisType.PhaseUnwrapped ? undefined : type;
}

function getContourSuggestions(
  contours: ViewHint['contours'],
  path: string,
): HeatmapSuggestions {
  if (contours === undefined) {
    return {};
  }
  if (Array.isArray(contours)) {
    return contours.length === 0
      ? { contourMode: ContourMode.Off }
      : {
          contourMode: ContourMode.Custom,
          contourLevels: { path, levels: contours },
        };
  }
  return {
    contourMode: ContourMode.Auto,
    contourCount: contours > 0 ? contours : undefined,
  };
}

/* Heatmap settings suggested by a hint (precedence over NeXus and heuristics: `fallbacks`) */
export function getHeatmapSuggestions(
  hint: ViewHint,
  path: string,
  fallbacks: HeatmapSuggestions = {},
): HeatmapSuggestions {
  const isComplexSurface = hint.vis === HintVis.ComplexSurface;
  return {
    ...fallbacks,
    scaleType: hint.scaleType ?? hint.height ?? fallbacks.scaleType,
    keepRatio: hint.keepRatio ?? fallbacks.keepRatio,
    colorMap: hint.colorMap,
    invertColorMap: hint.invertColorMap,
    customDomain: hint.domain,
    surface: isSurfaceHint(hint),
    heightScale: hint.heightScale,
    // Complex values: what 2D shows, what 3D shows and the scale of the height of 3D surfaces
    complexVisType: toHeatmapComplexType(hint.complex),
    surfaceComplexVisType: isComplexSurface
      ? toHeatmapComplexType(hint.complex)
      : undefined,
    surfaceScaleType:
      hint.height ?? (isComplexSurface ? hint.scaleType : undefined),
    ...getContourSuggestions(hint.contours, path),
  };
}

export function getLineSuggestions(
  hint: ViewHint,
  fallbacks: { xScaleType?: AxisScaleType; yScaleType?: AxisScaleType } = {},
): { xScaleType?: AxisScaleType; yScaleType?: AxisScaleType } {
  const yFromScale = isAxisScaleType(hint.scaleType)
    ? hint.scaleType
    : undefined; // e.g. not sqrt
  return {
    xScaleType: hint.xScaleType ?? fallbacks.xScaleType,
    yScaleType: hint.yScaleType ?? yFromScale ?? fallbacks.yScaleType,
  };
}

export function getVolumeSuggestions(
  hint: ViewHint,
  fallbacks: Partial<VolumeConfig> = {},
): Partial<VolumeConfig> {
  return {
    ...fallbacks,
    scaleType: hint.scaleType ?? fallbacks.scaleType,
    colorMap: hint.colorMap,
    invertColorMap: hint.invertColorMap,
    customDomain: hint.domain,
  };
}

const MAX_MULTI_DIM_LENGTH = 20; // as in `DimensionMapper`

/* Line: dimension on the x axis and dimension whose slices are all plotted */
export function getLineDimSuggestions(
  hint: ViewHint,
  dims: number[],
): { defaultSlice?: DefaultSlice; defaultMultiDim?: number } {
  const { xDim, multiDim } = hint;
  const hintedX = xDim !== undefined && xDim < dims.length ? xDim : undefined;
  const x = hintedX ?? dims.length - 1;

  return {
    defaultSlice:
      hintedX === undefined
        ? undefined
        : dims.map((_, i) => (i === hintedX ? '.' : 0)),
    defaultMultiDim:
      multiDim !== undefined &&
      multiDim < dims.length &&
      multiDim !== x &&
      dims[multiDim] > 1 &&
      dims[multiDim] <= MAX_MULTI_DIM_LENGTH
        ? multiDim
        : undefined,
  };
}
