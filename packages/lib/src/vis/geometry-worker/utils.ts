import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { createArrayFromView } from '@h5web/shared/vis-utils';
import { type NdArray } from 'ndarray';

import { type DataValues } from './models';

/* Integers above this can't all be represented exactly in float32 */
const FLOAT32_EXACT_INT = 2 ** 24;

/*
 * Whether values must be kept in double precision: float64 sources (where float32
 * would lose more than 7 significant digits, e.g. small variations around a large offset)
 * and integer sources beyond the range that float32 represents exactly.
 */
export function needsFloat64(data: NumArray): boolean {
  if (Array.isArray(data) || data instanceof Float64Array) {
    return true;
  }
  if (data instanceof Int32Array || data instanceof Uint32Array) {
    for (const val of data) {
      if (Math.abs(val) > FLOAT32_EXACT_INT) {
        return true;
      }
    }
  }
  return false;
}

/* Turn failed allocations of large typed arrays into a meaningful error */
export function withGeometryMemoryCheck<T>(allocate: () => T): T {
  try {
    return allocate();
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error('Not enough memory to extract geometry from this data', {
        cause: error,
      });
    }
    throw error;
  }
}

/*
 * Contiguous floating-point copy of an array (or view), with ignored values replaced by NaN.
 * Single precision unless that would lose precision (cf. `needsFloat64`), unless forced.
 */
export function toFloatValues(
  dataArray: NdArray<NumArray>,
  ignoreValue?: IgnoreValue,
  forceFloat64 = false,
): DataValues {
  return withGeometryMemoryCheck(() => {
    const { data } = isPlainArray(dataArray)
      ? dataArray
      : createArrayFromView(dataArray);

    const values =
      forceFloat64 || needsFloat64(data)
        ? new Float64Array(data.length)
        : new Float32Array(data.length);
    values.set(data);

    if (ignoreValue) {
      values.forEach((val, i) => {
        if (ignoreValue(val)) {
          values[i] = Number.NaN;
        }
      });
    }
    return values;
  });
}

function isPlainArray(arr: NdArray<NumArray>): boolean {
  const { shape, stride, offset, data, size } = arr;
  let expected = 1;
  for (let i = shape.length - 1; i >= 0; i -= 1) {
    if (shape[i] > 1 && stride[i] !== expected) {
      return false;
    }
    expected *= shape[i];
  }
  return offset === 0 && data.length === size;
}

/*
 * Coordinates of the `size` grid points along an axis: the values themselves if there
 * is one per point, or the centres of bins if there is one more value (bin edges).
 */
export function toAxisCoords(
  axis: NumArray | undefined,
  size: number,
): Float64Array | undefined {
  if (axis?.length === size) {
    return Float64Array.from(axis);
  }
  if (axis?.length === size + 1) {
    return Float64Array.from(
      { length: size },
      (_, i) => (axis[i] + axis[i + 1]) / 2,
    );
  }
  return undefined;
}
