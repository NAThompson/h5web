import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { rgb } from 'd3-color';
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  SRGBColorSpace,
  type Vector3Tuple,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import { getInterpolator } from '../heatmap/utils';
import { type AxisTicks, type VisScaleType } from '../models';
import {
  createScale,
  getIntegerTicks,
  getPiTicks,
  SCALES_VALID_MINS,
} from '../utils';

const LUT_SIZE = 256;

/* Colour of vertices whose value cannot be coloured (e.g. `NaN`, or negative in log scale), in linear RGB */
export const NAN_COLOR: Vector3Tuple = [0.2, 0.2, 0.2];

/* Colours of values that cannot be coloured, in linear RGB */
export interface SpecialColors {
  nan?: Vector3Tuple;
}

function toLinearRgb(css: string | undefined): Vector3Tuple | undefined {
  if (!css) {
    return undefined;
  }
  const { r, g, b } = rgb(css);
  if (![r, g, b].every(Number.isFinite)) {
    return undefined; // invalid CSS colour
  }
  const color = new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
  return [color.r, color.g, color.b];
}

/** Special colours from CSS colours; `undefined` if none is given. */
export function getSpecialColors(nanColor?: string): SpecialColors | undefined {
  const colors = { nan: toLinearRgb(nanColor) };
  return colors.nan ? colors : undefined;
}

/** Nice ticks within domain (ascending or descending); integer ticks only for axes of indices. */
export function getAxisTicks(
  domain: Domain,
  count: number,
  isIndexAxis: boolean,
  ticks?: AxisTicks,
): number[] {
  if (ticks === 'pi') {
    return getPiTicks(domain, count);
  }
  if (isIndexAxis) {
    return getIntegerTicks(domain, count);
  }

  return createScale(ScaleType.Linear, { domain }).ticks(count);
}

/** Colour map lookup table in linear RGB, as expected by three.js vertex colours. */
export function getLinearColorLut(
  colorMap: ColorMap,
  invertColorMap: boolean,
): Float32Array {
  const interpolator = getInterpolator(colorMap, invertColorMap);
  const lut = new Float32Array(LUT_SIZE * 3);
  const color = new Color();

  for (let i = 0; i < LUT_SIZE; i += 1) {
    const { r, g, b } = rgb(interpolator(i / (LUT_SIZE - 1)));
    color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace); // converts to linear
    lut.set([color.r, color.g, color.b], i * 3);
  }

  return lut;
}

/**
 * Distance from which a perspective camera sees a whole sphere of given radius,
 * whatever the aspect ratio of the viewport.
 */
export function getFramingDistance(
  radius: number,
  fov: number, // vertical, in degrees
  aspect: number,
): number | undefined {
  if (!Number.isFinite(aspect) || aspect <= 0 || radius <= 0) {
    return undefined; // e.g. canvas not laid out yet (zero width or height)
  }

  const vFov = (fov * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return radius / Math.sin(Math.min(vFov, hFov) / 2);
}

/**
 * Domain of the finite values of one or more arrays. The domain is flat (`min === max`)
 * along the normal of a planar curve or surface; `[-0.5, 0.5]` if there is no finite value.
 */
export function getExtentDomain(...arrays: NumArray[]): Domain {
  let min = Infinity;
  let max = -Infinity;

  for (const arr of arrays) {
    for (const val of arr) {
      if (Number.isFinite(val)) {
        min = Math.min(min, val);
        max = Math.max(max, val);
      }
    }
  }

  return min > max ? [-0.5, 0.5] : [min, max];
}

/**
 * Size of the box of a 3D object in world units - the longest side always measures 1.
 * When `keepRatio` is true, the ratios between the extents of the domains are respected;
 * otherwise, all sides measure 1. Either way, flat domains give a box of zero thickness
 * along their axis (e.g. planar curve), unless all domains are flat (single point).
 */
export function getBoxSize(
  domains: [Domain, Domain, Domain],
  keepRatio: boolean,
): Vector3Tuple {
  const extents = domains.map(([min, max]) => Math.abs(max - min));
  const longest = Math.max(...extents);

  if (longest === 0 || !Number.isFinite(longest)) {
    return [1, 1, 1];
  }

  return extents.map((extent) =>
    keepRatio ? extent / longest : extent > 0 ? 1 : 0,
  ) as Vector3Tuple;
}

export type WorldTransform = (x: number, y: number, z: number) => Vector3Tuple;

function getAxisTransform(
  [min, max]: Domain,
  size: number,
  offset: number, // world coordinate of the start of the axis
): (val: number) => number {
  const extent = max - min;
  if (extent === 0) {
    const center = offset + size / 2;
    return () => center; // flat domain: middle of the box
  }

  const k = size / extent;
  return (val) => (val - min) * k + offset;
}

/**
 * Map data coordinates into a box centred on the origin in X and Y and resting on
 * the `z = 0` plane, like `SurfaceVis`'s box, so axes and controls can be shared.
 */
export function getWorldTransform(
  domains: [Domain, Domain, Domain],
  boxSize: Vector3Tuple,
): WorldTransform {
  const [w, h, d] = boxSize;
  const toX = getAxisTransform(domains[0], w, -w / 2);
  const toY = getAxisTransform(domains[1], h, -h / 2);
  const toZ = getAxisTransform(domains[2], d, 0);

  return (x, y, z) => [toX(x), toY(y), toZ(z)];
}

/**
 * Position of each value on the colour map, in [0, 1], or `NaN` for values that
 * cannot be coloured: `NaN`, ignored values and values not supported by the scale.
 */
export function getColorParams(
  values: NumArray,
  domain: Domain,
  scaleType: VisScaleType,
  ignoreValue?: IgnoreValue,
): Float32Array {
  const scale = createScale(scaleType, { domain, range: [0, 1], clamp: true });
  const validMin =
    SCALES_VALID_MINS[Array.isArray(scaleType) ? scaleType[0] : scaleType];

  const params = new Float32Array(values.length);
  for (const [i, val] of values.entries()) {
    const param =
      !Number.isFinite(val) || val < validMin || ignoreValue?.(val)
        ? Number.NaN
        : scale(val);
    params[i] = Number.isFinite(param) ? param : Number.NaN;
  }

  return params;
}

/** Vertex colours in linear RGB, from positions on the colour map (cf. `getColorParams`). */
export function getVertexColors(
  params: Float32Array,
  colorLut: Float32Array,
  special: SpecialColors = {},
): Float32Array {
  const { nan = NAN_COLOR } = special;
  const colors = new Float32Array(params.length * 3);
  const lutMax = colorLut.length / 3 - 1;

  for (const [i, param] of params.entries()) {
    if (Number.isNaN(param)) {
      colors.set(nan, i * 3);
    } else {
      const lutIndex = Math.round(param * lutMax) * 3;
      colors[i * 3] = colorLut[lutIndex];
      colors[i * 3 + 1] = colorLut[lutIndex + 1];
      colors[i * 3 + 2] = colorLut[lutIndex + 2];
    }
  }

  return colors;
}

/**
 * Set vertex colours on one or more geometries sharing the same vertices. The existing
 * `color` attribute is updated in place when it has the right size, so colour map or domain
 * changes do not allocate a new GPU buffer each time.
 */
export function updateColorAttribute(
  geometries: BufferGeometry[],
  colors: Float32Array,
): BufferAttribute {
  const [first] = geometries;
  const current = first.getAttribute('color') as BufferAttribute | undefined;

  if (current?.array.length === colors.length) {
    (current.array as Float32Array).set(colors);
    current.needsUpdate = true;
    return current;
  }

  const attr = new BufferAttribute(colors, 3);
  for (const geometry of geometries) {
    geometry.setAttribute('color', attr);
  }
  return attr;
}
