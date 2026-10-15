import { isAxisScaleType } from '@h5web/shared/guards';
import {
  type AxisScaleType,
  type ComplexHeatmapVisType,
  ComplexVisType,
  type Domain,
} from '@h5web/shared/vis-models';

import { type ParamSurfaceConfig } from '../core/geometry/surface-config';
import { type HeatmapSuggestions } from '../core/heatmap/config';
import { ContourColorMode, ContourMode } from '../core/heatmap/models';
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

export const AUTO_COLOR_MAPS = {
  diverging: 'RdBu',
  sequential: 'Viridis',
} as const;

/* Whether the shown range spans `center` (`undefined` until known): `H5WEB_domain` where it is
 * fixed, so that a stack keeps one colour map, else the data domain (of the whole sequence during
 * playback, cf. `useStableDomain`); always with `H5WEB_symmetric` */
function spansCenter(
  { domain, center = 0 }: ViewHint,
  dataDomain: Domain | undefined,
): boolean | undefined {
  if (domain === 'symmetric') {
    return true;
  }
  const [min = dataDomain?.[0], max = dataDomain?.[1]] = (domain ?? []).map(
    (end) => end ?? undefined,
  );
  return min === undefined || max === undefined
    ? undefined
    : min < center && max > center;
}

/* Colour map and domain, which may depend on the data: `H5WEB_colormap = "auto"` is a diverging
 * map centred on `H5WEB_center` (with a symmetric domain, unless one is given) if the shown range
 * spans it (cf. `spansCenter`), a sequential map otherwise; `H5WEB_symmetric` is
 * ±max |v − center| */
export function getColorSuggestions(
  hint: ViewHint,
  dataDomain: Domain | undefined,
): Pick<HeatmapSuggestions, 'colorMap' | 'customDomain'> {
  const { colorMap, domain, center = 0 } = hint;
  const isAuto = colorMap === 'auto';
  const crosses = spansCenter(hint, dataDomain);

  const isSymmetric =
    domain === 'symmetric' || (isAuto && crosses && domain === undefined);
  const halfWidth =
    dataDomain &&
    Math.max(
      Math.abs(dataDomain[0] - center),
      Math.abs(dataDomain[1] - center),
    );

  return {
    colorMap: isAuto
      ? crosses === undefined
        ? undefined
        : crosses
          ? AUTO_COLOR_MAPS.diverging
          : AUTO_COLOR_MAPS.sequential
      : colorMap,
    customDomain: Array.isArray(domain)
      ? domain
      : isSymmetric && halfWidth !== undefined && Number.isFinite(halfWidth)
        ? [center - (halfWidth || 1), center + (halfWidth || 1)] // ±1 if data are all `center`
        : undefined,
  };
}

/* Heatmap settings suggested by a hint (precedence over NeXus and heuristics: `fallbacks`) */
export function getHeatmapSuggestions(
  hint: ViewHint,
  path: string,
  fallbacks: HeatmapSuggestions = {},
  dataDomain?: Domain, // for `H5WEB_colormap = "auto"` and `H5WEB_symmetric`
): HeatmapSuggestions {
  const isComplexSurface = hint.vis === HintVis.ComplexSurface;
  const colors = getColorSuggestions(hint, dataDomain);
  return {
    ...fallbacks,
    scaleType: hint.scaleType ?? hint.height ?? fallbacks.scaleType,
    keepRatio: hint.keepRatio ?? fallbacks.keepRatio,
    ...colors,
    // Complex surfaces have a domain of their own
    surfaceCustomDomain: isComplexSurface ? colors.customDomain : undefined,
    invertColorMap: hint.invertColorMap,
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
    contourLabels: hint.contourLabels,
    contourColor: hint.contourColor,
    contourColorMode: hint.contourColor ? ContourColorMode.Single : undefined,
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
    xScaleType: fallbacks.xScaleType,
    yScaleType: yFromScale ?? fallbacks.yScaleType,
  };
}

export function getVolumeSuggestions(
  hint: ViewHint,
  fallbacks: Partial<VolumeConfig> = {},
): Partial<VolumeConfig> {
  return {
    ...fallbacks,
    scaleType: hint.scaleType ?? fallbacks.scaleType,
    colorMap: hint.colorMap === 'auto' ? undefined : hint.colorMap,
    invertColorMap: hint.invertColorMap,
    customDomain: Array.isArray(hint.domain) ? hint.domain : undefined,
  };
}

/* Colour map and domain come from `getColorSuggestions` once the data domain is known */
export function getParamSurfaceSuggestions(
  hint: ViewHint,
): Partial<ParamSurfaceConfig> {
  return {
    scaleType: hint.scaleType,
    keepRatio: hint.keepRatio,
    invertColorMap: hint.invertColorMap,
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
