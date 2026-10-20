import {
  CurveType,
  type DimensionMapping,
  type InteractionInfo,
  type VisScaleType,
} from '@h5web/lib';
import {
  isBigIntTypedArray,
  isIntegerType,
  isNumericType,
} from '@h5web/shared/guards';
import {
  type ArrayValue,
  DTypeClass,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { getDimsSize } from '@h5web/shared/hdf5-utils';
import {
  type AxisScaleType,
  COLOR_SCALE_TYPES,
  type ColorScaleType,
  type Domain,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import {
  createArrayFromView,
  SCALAR_SELECTION_REGEXP,
} from '@h5web/shared/vis-utils';
import ndarray, { type NdArray } from 'ndarray';

export const DEFAULT_DOMAIN: Domain = [0.1, 1];

/* Colour scales with the nth root, offered as a gamma scale of exponent 1/n (`rootN`) */
export type ColorOrRootScaleType = ColorScaleType | ScaleType.Gamma;
// No square root: it is the nth root of n = 2
export const ROOT_SCALE_TYPES: ColorOrRootScaleType[] = [
  ...COLOR_SCALE_TYPES.filter((type) => type !== ScaleType.Sqrt),
  ScaleType.Gamma,
];
export const DEFAULT_ROOT_N = 3;
// Slider over n: n = 1 is linear, n = 2 the square root; beyond 10, roots barely differ
export const ROOT_N_RANGE = { min: 1, max: 10, step: 0.05 };

/* Color scale where Root is offered: square root as the nth root of n = 2 */
export function sqrtAsRoot<T extends ColorOrRootScaleType | undefined>(
  scaleType: T,
  rootN: number | undefined,
): { scaleType: T | ScaleType.Gamma; rootN: number | undefined } {
  return scaleType === ScaleType.Sqrt
    ? { scaleType: ScaleType.Gamma, rootN: 2 }
    : { scaleType, rootN };
}

/* Persisted config where Root is offered: square root as the nth root of n = 2 */
export function migrateSqrtToRoot(persisted: unknown): never {
  const state = { ...(persisted as Record<string, unknown>) };
  for (const key of ['scaleType', 'surfaceScaleType']) {
    if (state[key] === ScaleType.Sqrt) {
      state[key] = ScaleType.Gamma;
      state.rootN = 2;
    }
  }
  return state as never;
}

/* Degree of the nth root on the slider's grid: clamped to its range, to the nearest step */
export function snapRootN(rootN: number): number {
  const { min, max, step } = ROOT_N_RANGE;
  const snapped = Number((Math.round(rootN / step) * step).toFixed(2));
  return Math.min(max, Math.max(min, snapped));
}

/* Domains of the nth root (gamma) are as linear: normalized before the root is taken */
export function toDomainScaleType(
  scaleType: ColorOrRootScaleType,
): ColorScaleType {
  return scaleType === ScaleType.Gamma ? ScaleType.Linear : scaleType;
}

/* Axis scale as a colour scale (no square or nth root on axes: linear) */
export function toAxisScaleType(
  scaleType: ColorOrRootScaleType,
): AxisScaleType {
  const domainScaleType = toDomainScaleType(scaleType);
  return domainScaleType === ScaleType.Sqrt
    ? ScaleType.Linear
    : domainScaleType;
}

/* Scale with the width of its linear band around 0 when symlog (`H5WEB_symlog_threshold`),
 * or with its exponent 1/n when nth root (gamma) */
export function getVisScaleType(
  scaleType: ColorOrRootScaleType,
  threshold: number | undefined,
  rootN = DEFAULT_ROOT_N,
): VisScaleType {
  return scaleType === ScaleType.Gamma
    ? [ScaleType.Gamma, 1 / rootN]
    : scaleType === ScaleType.SymLog && threshold
      ? [ScaleType.SymLog, threshold]
      : scaleType;
}

/* Scales of the heights and colours of a 3D surface: an nth root applies to the colours only */
export function getSurfaceScaleTypes(visScaleType: VisScaleType): {
  scaleType: VisScaleType;
  colorScaleType?: VisScaleType;
} {
  return Array.isArray(visScaleType) && visScaleType[0] === ScaleType.Gamma
    ? { scaleType: ScaleType.Linear, colorScaleType: visScaleType }
    : { scaleType: visScaleType };
}

/* Scale of the heights of a 3D surface colored by another field: no nth root (of colors only) */
export function toHeightScaleType(visScaleType: VisScaleType): VisScaleType {
  return Array.isArray(visScaleType) && visScaleType[0] === ScaleType.Gamma
    ? ScaleType.Linear
    : visScaleType;
}

export const BASE_INTERACTIONS = [
  { shortcut: 'Drag', description: 'Pan' },
  { shortcut: 'Ctrl+Drag', description: 'Select to zoom' },
  { shortcut: 'Wheel', description: 'Zoom' },
];

export const INTERACTIONS_WITH_AXIAL_ZOOM = [
  ...BASE_INTERACTIONS,
  { shortcut: 'Alt+Wheel', description: 'Zoom in X' },
  { shortcut: 'Shift+Wheel', description: 'Zoom in Y' },
  { shortcut: 'Ctrl+Alt+Drag', description: 'Select to zoom in X' },
  { shortcut: 'Ctrl+Shift+Drag', description: 'Select to zoom in Y' },
];

export const SURFACE_INTERACTIONS = [
  { shortcut: 'Drag', description: 'Rotate' },
  { shortcut: 'Right-drag', description: 'Pan' },
  { shortcut: 'Wheel', description: 'Zoom' },
];

export const CURVE_TYPE_LABELS: Record<CurveType, string> = {
  [CurveType.LineOnly]: 'Line',
  [CurveType.GlyphsOnly]: 'Points',
  [CurveType.LineAndGlyphs]: 'Both',
};

export function getBaseArray<T extends ArrayValue | undefined>(
  value: T,
  rawDims: number[],
): T extends ArrayValue ? NdArray<T> : undefined;

export function getBaseArray(
  value: ArrayValue | undefined,
  rawDims: number[],
): NdArray<ArrayValue> | undefined {
  if (!value) {
    return undefined;
  }

  // Guard against incomplete values, which would otherwise show up as `NaN` (#1650)
  const size = getDimsSize(rawDims);
  if (value.length < size) {
    throw new Error(
      `Expected value with at least ${size} elements instead of ${value.length}`,
    );
  }

  return ndarray(value, rawDims);
}

export function applyMapping<T extends NdArray<ArrayValue> | undefined>(
  baseArray: T,
  mapping: DimensionMapping,
): T extends NdArray<ArrayValue> ? T : undefined;

export function applyMapping(
  baseArray: NdArray<ArrayValue> | undefined,
  mapping: DimensionMapping,
): NdArray<ArrayValue> | undefined {
  if (!baseArray) {
    return undefined;
  }

  const isXBeforeY =
    mapping.includes('y') &&
    mapping.includes('x') &&
    mapping.indexOf('x') < mapping.indexOf('y');

  const slicingState = mapping.map((val) =>
    typeof val === 'number' ? val : null,
  );

  if (!isXBeforeY && slicingState.every((val) => val === null)) {
    return baseArray; // no mapping/slicing needed
  }

  const slicedView = baseArray.pick(...slicingState);
  const mappedView = isXBeforeY ? slicedView.transpose(1, 0) : slicedView;

  // Create ndarray from mapped view so `mappedArray.data` only contains values relevant to vis
  return createArrayFromView(mappedView);
}

export function getImageInteractions(keepRatio: boolean): InteractionInfo[] {
  return keepRatio ? BASE_INTERACTIONS : INTERACTIONS_WITH_AXIAL_ZOOM;
}

/* Keep the ratio when both axes share a unit, as when plotting two lengths,
 * but not when they differ, as when plotting energy against time. */
export function guessKeepRatio(
  xAxis: { unit?: string } | undefined,
  yAxis: { unit?: string } | undefined,
): boolean | undefined {
  if (!xAxis?.unit && !yAxis?.unit) {
    return undefined;
  }

  return xAxis?.unit === yAxis?.unit;
}

function isBigIntArray(val: ArrayValue<NumericLikeType>): val is bigint[] {
  return Array.isArray(val) && typeof val[0] === 'bigint';
}

function isBoolArray(val: ArrayValue<NumericLikeType>): val is boolean[] {
  return Array.isArray(val) && typeof val[0] === 'boolean';
}

export function toNumArray<T extends ArrayValue<NumericLikeType> | undefined>(
  arr: T,
): T extends ArrayValue<NumericLikeType> ? NumArray : undefined;

export function toNumArray(
  arr: ArrayValue<NumericLikeType> | undefined,
): NumArray | undefined {
  if (!arr) {
    return undefined;
  }

  if (isBigIntTypedArray(arr)) {
    return Float64Array.from(arr, Number); // cast to float 64
  }

  if (isBigIntArray(arr)) {
    return arr.map(Number); // cast to float 64
  }

  if (isBoolArray(arr)) {
    return arr.map((val) => (val ? 1 : 0));
  }

  return arr;
}

const TYPE_STRINGS: Record<NumericLikeType['class'], string> = {
  [DTypeClass.Bool]: 'bool',
  [DTypeClass.Enum]: 'enum',
  [DTypeClass.Integer]: 'int',
  [DTypeClass.Float]: 'float',
};

export function formatNumLikeType(type: NumericLikeType): string {
  const unsignedPrefix = isIntegerType(type) && !type.signed ? 'u' : '';
  const sizeSuffix = isNumericType(type) ? type.size : '';
  return `${unsignedPrefix}${TYPE_STRINGS[type.class]}${sizeSuffix}`;
}

export function isScalarSelection(selection: string): boolean {
  return SCALAR_SELECTION_REGEXP.test(selection);
}
