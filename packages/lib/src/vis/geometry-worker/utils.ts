import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { createArrayFromView } from '@h5web/shared/vis-utils';
import { type NdArray } from 'ndarray';

/* Contiguous floating-point copy of an array (or view), with ignored values replaced by NaN */
export function toFloatValues<T extends Float32Array | Float64Array>(
  dataArray: NdArray<NumArray>,
  Ctor: new (length: number) => T,
  ignoreValue?: IgnoreValue,
): T {
  const { data } = isPlainArray(dataArray)
    ? dataArray
    : createArrayFromView(dataArray);
  const values = new Ctor(data.length);
  values.set(data);
  if (ignoreValue) {
    values.forEach((val, i) => {
      if (ignoreValue(val)) {
        values[i] = Number.NaN;
      }
    });
  }
  return values;
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

/* Copy axis coordinates as `Float64Array` if they have exactly one value per point */
export function toAxisCoords(
  axis: NumArray | undefined,
  size: number,
): Float64Array | undefined {
  return axis?.length === size ? Float64Array.from(axis) : undefined;
}
