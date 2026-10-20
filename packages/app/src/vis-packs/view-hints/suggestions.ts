import { isAxisScaleType } from '@h5web/shared/guards';
import {
  type AxisScaleType,
  type ComplexHeatmapVisType,
  type ComplexLineVisType,
  ComplexVisType,
  type Domain,
  ScaleType,
} from '@h5web/shared/vis-models';

import { type ComplexCurveConfig } from '../core/complex/curve-config';
import { type ParamSurfaceConfig } from '../core/geometry/surface-config';
import { type HeatmapSuggestions } from '../core/heatmap/config';
import { ContourColorMode, ContourMode } from '../core/heatmap/models';
import { type OrthoslicesConfig } from '../core/orthoslices/config';
import { type ColorOrRootScaleType, sqrtAsRoot } from '../core/utils';
import { type VolumeConfig } from '../core/volume/config';
import { type DefaultSlice } from '../nexus/models';
import { HintVis, type ViewHint } from './models';
import { isSurfaceHint } from './utils';

/* Heatmaps show phase wrapped, line plots don't show phase and amplitude together */
function toHeatmapComplexType(
  type: ComplexVisType | undefined,
): ComplexHeatmapVisType | undefined {
  return type === ComplexVisType.PhaseUnwrapped ? ComplexVisType.Phase : type;
}

function toLineComplexType(
  type: ComplexVisType | undefined,
): ComplexLineVisType | undefined {
  return type === ComplexVisType.PhaseAmplitude
    ? ComplexVisType.Amplitude
    : type;
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

/* Colour scale of a hint, nth root as gamma (of exponent 1/`rootN`) */
export function getColorScaleType(hint: ViewHint): ColorOrRootScaleType | undefined {
  return hint.rootN ? ScaleType.Gamma : hint.scaleType;
}

/* Colour scale of a heatmap hint: else the height scale (3D surfaces) */
export function getHeatmapScaleType(
  hint: ViewHint,
): ColorOrRootScaleType | undefined {
  return getColorScaleType(hint) ?? hint.height;
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
    ...sqrtAsRoot(getHeatmapScaleType(hint) ?? fallbacks.scaleType, hint.rootN),
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
    contourEmphasis: hint.contourEmphasize,
    probe: hint.probeDim === undefined ? undefined : true,
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

/* Hinted y scale only applies to amplitudes: phases are often negative */
export function getComplexLineSuggestions(
  hint: ViewHint,
  fallbacks: { xScaleType?: AxisScaleType; yScaleType?: AxisScaleType } = {},
): {
  xScaleType?: AxisScaleType;
  yScaleType?: AxisScaleType;
  complexVisType?: ComplexLineVisType;
} {
  // A scale hint without complex type is about amplitudes
  const complexVisType =
    toLineComplexType(hint.complex) ??
    (hint.scaleType ? ComplexVisType.Amplitude : undefined);
  const isAmplitude =
    (complexVisType ?? ComplexVisType.Amplitude) === ComplexVisType.Amplitude;
  return {
    ...(isAmplitude ? getLineSuggestions(hint, fallbacks) : fallbacks),
    complexVisType,
  };
}

/* Complex curves show phase and amplitude together: colour by amplitude only if hinted */
export function getComplexCurveSuggestions(
  hint: ViewHint,
): Partial<Pick<ComplexCurveConfig, 'colorBy'>> {
  if (!hint.complex) {
    return {};
  }
  return {
    colorBy:
      hint.complex === ComplexVisType.Amplitude
        ? ComplexVisType.Amplitude
        : ComplexVisType.Phase,
  };
}

export function getVolumeSuggestions(
  hint: ViewHint,
  fallbacks: Partial<VolumeConfig> = {},
): Partial<VolumeConfig> {
  return {
    ...fallbacks,
    ...sqrtAsRoot(getColorScaleType(hint) ?? fallbacks.scaleType, hint.rootN),
    colorMap: hint.colorMap === 'auto' ? undefined : hint.colorMap,
    invertColorMap: hint.invertColorMap,
    customDomain: Array.isArray(hint.domain) ? hint.domain : undefined,
  };
}

/* Colour scale, map and fixed domain as for volumes (`H5WEB_colormap = "auto"` is not resolved:
 * the domain of the whole volume is not known until loaded), and keep ratio */
export function getOrthoslicesSuggestions(
  hint: ViewHint,
): Partial<OrthoslicesConfig> {
  return {
    ...sqrtAsRoot(getColorScaleType(hint), hint.rootN),
    colorMap: hint.colorMap === 'auto' ? undefined : hint.colorMap,
    invertColorMap: hint.invertColorMap,
    customDomain: Array.isArray(hint.domain) ? hint.domain : undefined,
    keepRatio: hint.keepRatio,
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
