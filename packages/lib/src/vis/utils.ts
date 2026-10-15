import { isDefined } from '@h5web/shared/guards';
import {
  type AnyNumArray,
  type AxisScaleType,
  type Domain,
  type MaybeFloat16ArrayConstructor,
  type NumArray,
  ScaleType,
  type TypedArrayConstructor,
} from '@h5web/shared/vis-models';
import {
  formatTick,
  getBounds,
  getBoundsWithErrors,
  getValidDomainForScale,
} from '@h5web/shared/vis-utils';
import {
  scaleLinear,
  scaleLog,
  scaleSqrt,
  scaleSymlog,
  scaleThreshold,
} from '@visx/scale';
import { range, tickStep } from 'd3-array';
import { type ScaleLinear, type ScaleThreshold } from 'd3-scale';
import { BufferAttribute, type IUniform, MathUtils } from 'three';

import {
  type Aspect,
  type AxisOffsets,
  type ExtractScaleType,
  type GetDomainOpts,
  type Scale,
  type ScaleConfig,
  type ScaleGammaConfig,
  type Size,
  type VisScaleType,
} from './models';
import { scaleGamma } from './scaleGamma';

// Orthographic camera configuration (cf. `R3FCanvas.tsx`)
export const CAMERA_NEAR = 0;
export const CAMERA_FAR = 1000;
export const CAMERA_Z = CAMERA_FAR;

// Resulting visible `z` range for objects in the scene
export const Z_MIN = CAMERA_Z - CAMERA_FAR; // 0
export const Z_MAX = CAMERA_Z - CAMERA_NEAR; // 1000

/* `z` position located outside of the camera's frustrum (too far).
 * Used to hide points with NaN/infinite coordinates without Three warnings. */
export const Z_OUT = Z_MIN - 1;

export const DEFAULT_DOMAIN: Domain = [0.1, 1];

const DEFAULT_AXIS_OFFSETS = { left: 80, right: 24, top: 16, bottom: 34 };
const TITLE_OFFSET = 28;
const LABEL_OFFSET = 24;

export const SCALES_VALID_MINS = {
  [ScaleType.Linear]: -Infinity,
  [ScaleType.Log]: Number.MIN_VALUE,
  [ScaleType.SymLog]: -Infinity,
  [ScaleType.Sqrt]: 0,
  [ScaleType.Gamma]: -Infinity,
};

export const adaptedNumTicks: ScaleLinear<number, number> = scaleLinear({
  domain: [300, 900],
  range: [3, 10],
  clamp: true,
  round: true,
});

const adaptedLogTicksThreshold = scaleLinear({
  domain: [300, 500],
  range: [0.8, 1.4],
});

export function createScale<
  V extends VisScaleType,
  S extends ExtractScaleType<V>,
>(scaleType: V, config: ScaleConfig<S>): Scale<S>;

export function createScale(
  scaleType: VisScaleType,
  config: ScaleConfig,
): Scale {
  if (Array.isArray(scaleType)) {
    const [type, param] = scaleType;
    return type === ScaleType.SymLog
      ? scaleSymlog({ ...config, constant: param })
      : scaleGamma({ ...(config as ScaleGammaConfig), exponent: param });
  }

  switch (scaleType) {
    case ScaleType.Linear:
      return scaleLinear(config);
    case ScaleType.Log:
      return scaleLog(config);
    case ScaleType.SymLog:
      return scaleSymlog(config);
    case ScaleType.Sqrt:
      return scaleSqrt(config);
    default:
      throw new Error('Unknown scale type');
  }
}

export function getSizeToFit(
  availableSize: Size,
  ratioToRespect: number | undefined,
): Size {
  const { width, height } = availableSize;

  if (!ratioToRespect) {
    return { width, height };
  }

  const availableRatio = width / height;

  return availableRatio > ratioToRespect
    ? { width: height * ratioToRespect, height }
    : { width, height: width / ratioToRespect };
}

export function getDomain(
  values: AnyNumArray,
  opts: GetDomainOpts & { errors?: AnyNumArray } = {},
): Domain | undefined {
  const {
    errors,
    includeErrors = true,
    scaleType = ScaleType.Linear,
    ignoreValue,
  } = opts;

  if (!errors) {
    const bounds = getBounds(values, ignoreValue);
    return getValidDomainForScale(bounds, scaleType);
  }

  const [boundsWithErrors, boundsWithoutErrors] = getBoundsWithErrors(
    values,
    errors,
    ignoreValue,
  );

  return getValidDomainForScale(
    includeErrors ? boundsWithErrors : boundsWithoutErrors,
    scaleType,
  );
}

export function getDomains(
  valuesArrays: AnyNumArray[],
  opts: GetDomainOpts & { errorsArrays?: (AnyNumArray | undefined)[] } = {},
): (Domain | undefined)[] {
  const { errorsArrays, ...otherOpts } = opts;

  return valuesArrays.map((arr, i) => {
    return getDomain(arr, { errors: errorsArrays?.[i], ...otherOpts });
  });
}

function extendEmptyDomain(
  value: number,
  extendFactor: number,
  scaleType: ScaleType,
): Domain {
  if (scaleType === ScaleType.Log) {
    return [value * 10 ** -extendFactor, value * 10 ** extendFactor];
  }

  if (value === 0) {
    return [-1, 1];
  }

  const extension = Math.abs(value) * extendFactor;
  return [value - extension, value + extension];
}

export function clampBound(
  val: number,
  supportedDomain: Domain = [-Number.MAX_VALUE / 2, Number.MAX_VALUE / 2],
): number {
  const [supportedMin, supportedMax] = supportedDomain;

  return MathUtils.clamp(val, supportedMin, supportedMax);
}

export function extendDomain(
  domain: Domain,
  extendFactor: number,
  scaleType: VisScaleType = ScaleType.Linear,
): Domain {
  if (extendFactor <= 0) {
    return domain;
  }

  const type = Array.isArray(scaleType) ? scaleType[0] : scaleType;
  const validMin = SCALES_VALID_MINS[type];

  const [min] = domain;
  if (min < validMin) {
    throw new Error(`Expected domain compatible with ${type} scale`);
  }

  const extendedDomain = unsafeExtendDomain(domain, extendFactor, scaleType);

  return [Math.max(validMin, extendedDomain[0]), extendedDomain[1]];
}

function unsafeExtendDomain(
  domain: Domain,
  extendFactor: number,
  scaleType: VisScaleType,
): Domain {
  const [min, max] = domain;
  if (min === max) {
    const type = Array.isArray(scaleType) ? scaleType[0] : scaleType;
    return extendEmptyDomain(min, extendFactor, type);
  }

  const scale = createScale(scaleType, { domain, range: [0, 1] });
  return [scale.invert(-extendFactor), scale.invert(1 + extendFactor)];
}

export function getValueToIndexScale(
  values: NumArray,
  switchAtMidpoints?: boolean,
): ScaleThreshold<number, number> {
  const rawThresholds = switchAtMidpoints
    ? values.map((_, i) => values[i - 1] + (values[i] - values[i - 1]) / 2) // Shift the thresholds for the switch from i-1 to i to happen between values[i-1] and values[i]
    : values; // Else, the switch from i-1 to i will happen at values[i]

  // First threshold (going from 0 to 1) should be for the second value. Scaling the first value should return at 0.
  const thresholds = toArray(rawThresholds.slice(1));
  const indices = range(values.length);
  if (isDescending(thresholds)) {
    thresholds.reverse();
    indices.reverse();
  }

  // ScaleThreshold only works with ascending values so the scale is reversed for descending values
  return scaleThreshold<number, number>({ domain: thresholds, range: indices });
}

/**
 * We can't rely on the axis scale's `ticks` method to get integer tick values because
 * `d3.tickStep` sometimes returns incoherent step values - e.g. `d3.tickStep(0, 2, 3)`
 * returns 0.5 instead of 1.
 *
 * So we implement our own, simplified version of `d3.ticks` that always outputs integer values.
 */
export function getIntegerTicks(domain: Domain, count: number): number[] {
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const intMin = Math.ceil(min);
  const intMax = Math.floor(max);

  const domainLength = intMax - intMin + 1;
  const optimalCount = Math.min(domainLength, count);

  if (optimalCount === 0) {
    return [];
  }

  // Make sure we always use a step that is greater than or equal to 1
  const step = Math.max(tickStep(intMin, intMax, optimalCount), 1);

  const start = Math.ceil(min / step);
  const stop = Math.floor(max / step);
  const numTicks = stop - start + 1;

  return Array.from({ length: numTicks }, (_, i) => (start + i) * step);
}

const PI_FRACTIONS = [1 / 12, 1 / 6, 1 / 4, 1 / 2]; // finest steps, in units of π

/**
 * Ticks at multiples of π for about `count` ticks, like d3's nice ticks: the step is the closest
 * (geometrically) of π/12, π/6, π/4, π/2, π, 2π, 4π... Zoomed in beyond π/12, plain nice ticks.
 */
export function getPiTicks(domain: Domain, count: number): number[] {
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const rawStep = (max - min) / Math.PI / Math.max(count, 1);
  if (!(rawStep > 0) || !Number.isFinite(rawStep)) {
    return [];
  }

  if (rawStep < PI_FRACTIONS[0] / Math.SQRT2) {
    return scaleLinear({ domain: [min, max] }).ticks(count);
  }

  const pow2 = 2 ** Math.max(Math.round(Math.log2(rawStep)), 0);
  const step = [...PI_FRACTIONS, pow2].reduce((best, candidate) =>
    Math.abs(Math.log(candidate / rawStep)) < Math.abs(Math.log(best / rawStep))
      ? candidate
      : best,
  );

  const eps = 1e-9;
  const start = Math.ceil(min / Math.PI / step - eps);
  const stop = Math.floor(max / Math.PI / step + eps);
  return range(start, stop + 1).map((i) => i * step * Math.PI);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/* Tick label of a multiple of π/12 (`π/4`, `3π/2`, `−π`...); other values as by `formatTick` */
export function formatPiTick(val: number | { valueOf: () => number }): string {
  const units = (val.valueOf() / Math.PI) * 12;
  const twelfths = Math.round(units);
  if (
    (twelfths === 0 && units !== 0) || // e.g. plain ticks zoomed in near 0
    Math.abs(units - twelfths) > 1e-9 * Math.abs(units)
  ) {
    return formatTick(val);
  }
  if (twelfths === 0) {
    return '0';
  }

  const divisor = gcd(Math.abs(twelfths), 12);
  const num = Math.abs(twelfths) / divisor;
  const den = 12 / divisor;
  const sign = twelfths < 0 ? '−' : '';
  return `${sign}${num === 1 ? '' : num}π${den === 1 ? '' : `/${den}`}`;
}

/**
 * Ticks of a symlog scale of given constant: 0 and every k-th power of 10 from the linear band
 * out to each end of the domain, always with the decade nearest each end (d3's symlog ticks are
 * linear ticks, which all crowd at the ends of the axis when the constant is small); k is chosen
 * for 4 to 8 ticks per sign, depending on `count` (labels of powers of 10 are short). Linear
 * ticks within the linear band.
 */
export function getSymlogTicks(
  domain: Domain,
  constant: number,
  count: number,
): number[] {
  const min = Math.min(...domain);
  const max = Math.max(...domain);

  // Exponents of the powers of 10 in [lo, hi] (0 <= lo), outside the linear band
  function decades(lo: number, hi: number): number[] {
    const from = Math.ceil(Math.log10(Math.max(lo, constant)));
    const to = Math.floor(Math.log10(hi));
    return to >= from ? range(from, to + 1) : [];
  }

  const pos = max > 0 ? decades(Math.max(min, 0), max) : [];
  const neg = min < 0 ? decades(Math.max(-max, 0), -min) : [];
  if (pos.length + neg.length < 2) {
    return scaleLinear({ domain: [min, max] }).ticks(count);
  }

  const hasZero = min <= 0 && max >= 0;
  const perSign = Math.min(Math.max(count, 4), 8);
  const stride = Math.ceil(Math.max(pos.length, neg.length) / perSign); // same spacing both sides

  // Not within a quarter of a nominal tick spacing of 0 (about 1.5 label heights: labels would
  // overlap), in the space of the scale
  function scaled(val: number): number {
    return Math.log1p(Math.abs(val) / constant);
  }
  const minGap = hasZero
    ? (scaled(min) + scaled(max)) / Math.max(count, 1) / 4
    : 0;

  // Every k-th decade down from the one nearest the end of the domain
  function pick(exps: number[]): number[] {
    const top = exps.length - 1;
    return exps
      .filter((_, i) => (top - i) % stride === 0)
      .filter(
        (exp, i, kept) =>
          i === kept.length - 1 || scaled(Number(`1e${exp}`)) >= minGap,
      )
      .map((exp) => Number(`1e${exp}`));
  }

  return [
    ...pick(neg)
      .map((val) => -val)
      .toReversed(),
    ...(hasZero ? [0] : []),
    ...pick(pos),
  ];
}

export function getScaleTickValues(
  scaleType: VisScaleType,
  domain: Domain,
  count: number,
): number[] | undefined {
  return Array.isArray(scaleType) && scaleType[0] === ScaleType.SymLog
    ? getSymlogTicks(domain, scaleType[1], count)
    : undefined;
}

export function getTickFormatter(
  domain: Domain,
  availableSize: number,
  scaleType: ScaleType,
): (val: number | { valueOf: () => number }) => string {
  if (scaleType !== ScaleType.Log) {
    return formatTick;
  }

  // If available size allows for all log ticks to be rendered without overlap, use default formatter
  const threshold = adaptedLogTicksThreshold(availableSize);

  /* In log scale, domain is either fully positive or fully negative
   * (otherwise, it's `[NaN, NaN]` and it doesn't matter which formatter we use).
   * If fully negative, convert to fully positive for threshold logic to work. */
  const absDomain = domain.map(Math.abs) as Domain;
  absDomain.sort((a, b) => a - b);

  const [min, max] = absDomain;
  if (max / min < 10 ** threshold) {
    return formatTick;
  }

  // Otherwise, use formatter that hides non-exact powers of 10
  return (val) => {
    const loggedVal = Math.log10(Math.abs(val.valueOf()));
    return loggedVal === Math.floor(loggedVal) ? formatTick(val) : '';
  };
}

export function getCombinedDomain(domains: [Domain, ...Domain[]]): Domain;
export function getCombinedDomain(
  domains: (Domain | undefined)[],
): Domain | undefined;

export function getCombinedDomain(
  domains: (Domain | undefined)[],
): Domain | undefined {
  const domainsToCombine = domains.filter(isDefined);
  if (domainsToCombine.length === 0) {
    return undefined;
  }

  return domainsToCombine.reduce((accDomain, nextDomain) => [
    Math.min(accDomain[0], nextDomain[0]),
    Math.max(accDomain[1], nextDomain[1]),
  ]);
}

export function getVisRatio(
  aspect: Aspect,
  abscissaDomain: Domain,
  ordinateDomain: Domain,
): number | undefined {
  if (aspect === 'auto') {
    return undefined;
  }

  if (aspect === 'equal') {
    return getVisRatio(1, abscissaDomain, ordinateDomain);
  }

  const [xMin, xMax] = abscissaDomain;
  const [yMin, yMax] = ordinateDomain;
  return Math.abs(xMax - xMin) / Math.abs(yMax - yMin) / aspect;
}

export function getAxisOffsets(
  hasLabel: Partial<Record<Exclude<keyof AxisOffsets, 'right'>, boolean>> = {},
): AxisOffsets {
  const { left, right, top, bottom } = DEFAULT_AXIS_OFFSETS;
  return {
    left: left + (hasLabel.left ? LABEL_OFFSET : 0),
    right,
    top: top + (hasLabel.top ? TITLE_OFFSET : 0),
    bottom: bottom + (hasLabel.bottom ? LABEL_OFFSET : 0),
  };
}

function isDescending(array: NumArray): boolean {
  return array[array.length - 1] - array[0] < 0;
}

export function getAxisDomain(
  axisValues: NumArray,
  opts: {
    scaleType?: AxisScaleType;
    extensionFactor?: number;
    forceAscending?: boolean;
  } = {},
): Domain | undefined {
  const {
    scaleType = ScaleType.Linear,
    extensionFactor = 0,
    forceAscending = false,
  } = opts;

  const rawDomain = getDomain(axisValues, { scaleType });
  if (!rawDomain) {
    return undefined;
  }

  const extendedDomain = extendDomain(rawDomain, extensionFactor, scaleType);
  return isDescending(axisValues) && !forceAscending
    ? [extendedDomain[1], extendedDomain[0]]
    : extendedDomain;
}

export const VERTEX_SHADER = `
  varying vec2 coords;

  void main() {
    coords = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function getUniforms(
  uniforms: Record<string, unknown>,
): Record<string, IUniform> {
  return Object.fromEntries(
    Object.entries(uniforms).map(([key, value]) => [key, { value }]),
  );
}

function toArray(arr: NumArray): number[] {
  return Array.isArray(arr) ? arr : [...arr];
}

export function createBufferAttr(
  dataLength: number,
  itemSize = 3,
  TypedArrayCtor: Exclude<
    TypedArrayConstructor,
    MaybeFloat16ArrayConstructor // not supported by Three's `BufferAttribute` yet
  > = Float32Array,
): BufferAttribute {
  return new BufferAttribute(
    new TypedArrayCtor(dataLength * itemSize),
    itemSize,
  );
}

export function createIndex(length: number, maxValue: number): BufferAttribute {
  const TypedArrayCtor = maxValue <= 2 ** 16 ? Uint16Array : Uint32Array;
  return createBufferAttr(length, 1, TypedArrayCtor);
}

export function hasR3FEventHandlers(props: Record<string, unknown>): boolean {
  return Object.keys(props).some((prop) =>
    /^on(?:Click|ContextMenu|DoubleClick|Pointer|Wheel)/u.test(prop),
  );
}
