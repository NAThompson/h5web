import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { rgb } from 'd3-color';
import { Color, SRGBColorSpace, type Vector3Tuple } from 'three';

import { type ColorMap } from '../heatmap/models';
import { getInterpolator } from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { createScale, getIntegerTicks, SCALES_VALID_MINS } from '../utils';

const LUT_SIZE = 256;

/* Colour of vertices whose value cannot be coloured (e.g. `NaN`, or negative in log scale), in linear RGB */
export const NAN_COLOR: Vector3Tuple = [0.2, 0.2, 0.2];

/** Nice ticks within domain (ascending or descending); integer ticks only for axes of indices. */
export function getAxisTicks(
  domain: Domain,
  count: number,
  isIndexAxis: boolean,
): number[] {
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
 * Domain of the finite values of one or more arrays. A flat domain (e.g. along the
 * normal of a planar curve) is widened by 0.5 on each side, so it can be scaled to a box.
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

  if (min > max) {
    return [-0.5, 0.5]; // no finite value
  }

  return min === max ? [min - 0.5, max + 0.5] : [min, max];
}

/**
 * Size of the box of a 3D object in world units - the longest side always measures 1.
 * When `keepRatio` is true, the ratios between the extents of the domains are respected.
 */
export function getBoxSize(
  domains: [Domain, Domain, Domain],
  keepRatio: boolean,
): Vector3Tuple {
  if (!keepRatio) {
    return [1, 1, 1];
  }

  const extents = domains.map(([min, max]) => Math.abs(max - min));
  const longest = Math.max(...extents);
  return extents.map((extent) => extent / longest) as Vector3Tuple;
}

export type WorldTransform = (x: number, y: number, z: number) => Vector3Tuple;

/**
 * Map data coordinates into a box centred on the origin in X and Y and resting on
 * the `z = 0` plane, like `SurfaceVis`'s box, so axes and controls can be shared.
 */
export function getWorldTransform(
  domains: [Domain, Domain, Domain],
  boxSize: Vector3Tuple,
): WorldTransform {
  const [[xMin, xMax], [yMin, yMax], [zMin, zMax]] = domains;
  const [w, h, d] = boxSize;
  const kx = w / (xMax - xMin);
  const ky = h / (yMax - yMin);
  const kz = d / (zMax - zMin);

  return (x, y, z) => [
    (x - xMin) * kx - w / 2,
    (y - yMin) * ky - h / 2,
    (z - zMin) * kz,
  ];
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
  nanColor: Vector3Tuple = NAN_COLOR,
): Float32Array {
  const colors = new Float32Array(params.length * 3);
  const lutMax = colorLut.length / 3 - 1;

  for (const [i, param] of params.entries()) {
    if (Number.isNaN(param)) {
      colors.set(nanColor, i * 3);
    } else {
      const lutIndex = Math.round(param * lutMax) * 3;
      colors[i * 3] = colorLut[lutIndex];
      colors[i * 3 + 1] = colorLut[lutIndex + 1];
      colors[i * 3 + 2] = colorLut[lutIndex + 2];
    }
  }

  return colors;
}
