import { type Bounds } from '@h5web/shared/vis-models';

/* Bounds of the finite values of an array, as `getBounds` (without `ignoreValue`) computes
 * them, specialised for `Float32Array` (several times faster on large arrays). */
export function getFloat32Bounds(data: Float32Array): Bounds | undefined {
  let min = Infinity;
  let max = -Infinity;
  let positiveMin = Infinity;
  let strictPositiveMin = Infinity;

  // eslint-disable-next-line @typescript-eslint/prefer-for-of, unicorn/no-for-loop -- classic for loop is more efficient
  for (let i = 0; i < data.length; i += 1) {
    const val = data[i];
    // Plain comparisons are several times faster than `Math.min` and `Math.max`; NaN and
    // infinite values are skipped (`Infinity < Infinity` is false)
    if (val < min && val !== -Infinity) {
      min = val;
    }
    if (val > max && val !== Infinity) {
      max = val;
    }
    if (val >= 0 && val < positiveMin) {
      positiveMin = val;
    }
    if (val > 0 && val < strictPositiveMin) {
      strictPositiveMin = val;
    }
  }

  return Number.isFinite(min)
    ? { min, max, positiveMin, strictPositiveMin }
    : undefined;
}

export function mergeBounds(
  boundsList: (Bounds | undefined)[],
): Bounds | undefined {
  const defined = boundsList.filter((b) => b !== undefined);
  if (defined.length === 0) {
    return undefined;
  }

  return {
    min: Math.min(...defined.map((b) => b.min)),
    max: Math.max(...defined.map((b) => b.max)),
    positiveMin: Math.min(...defined.map((b) => b.positiveMin)),
    strictPositiveMin: Math.min(...defined.map((b) => b.strictPositiveMin)),
  };
}

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
