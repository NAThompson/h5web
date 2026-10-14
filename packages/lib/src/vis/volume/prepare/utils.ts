import { type Bounds } from '@h5web/shared/vis-models';

export { getFloat32Bounds, mergeBounds } from '@h5web/shared/vis-utils';

export interface HalfFloatNormalization {
  offset: number;
  scale: number;
}

/* Normalize values to [0, 1] over the bounds of the finite values before storing them
 * as half floats, so precision doesn't depend on the magnitude of the values */
export function getHalfFloatNormalization(
  bounds: Bounds | undefined,
): HalfFloatNormalization {
  const offset = bounds ? bounds.min : 0;
  const range = bounds ? bounds.max - bounds.min : 0;
  return { offset, scale: range > 0 ? range : 1 };
}

/* Convert values to normalized half floats (raw bits, as uploaded to WebGL); NaN and infinite
 * values are preserved */
export function toHalfFloatBits(
  data: Float32Array,
  { offset, scale }: HalfFloatNormalization,
): Uint16Array<ArrayBuffer> {
  const factor = 1 / scale;
  const halfFloats = new Float16Array(new ArrayBuffer(data.length * 2));
  // eslint-disable-next-line unicorn/no-for-loop -- classic for loop is more efficient
  for (let i = 0; i < data.length; i += 1) {
    halfFloats[i] = (data[i] - offset) * factor;
  }

  return new Uint16Array(halfFloats.buffer);
}
