import { isComplexArray } from '@h5web/shared/guards';
import {
  type ArrayValue,
  type ComplexType,
  type H5WebComplex,
  type NumericLikeType,
} from '@h5web/shared/hdf5-models';
import { ComplexVisType, type NumArray } from '@h5web/shared/vis-models';

import { toNumArray } from '../utils';

const TWO_PI = 2 * Math.PI;

export const COMPLEX_VIS_TYPE_LABELS = {
  [ComplexVisType.Amplitude]: 'Amplitude',
  [ComplexVisType.Phase]: 'Phase',
  [ComplexVisType.PhaseUnwrapped]: 'Phase, unwrapped',
  [ComplexVisType.PhaseAmplitude]: 'Phase & Amplitude',
} satisfies Record<ComplexVisType, string>;

export function getPhaseAmplitude(values: H5WebComplex[]): {
  phase: Float64Array;
  amplitude: Float64Array;
} {
  const phase = new Float64Array(values.length);
  const amplitude = new Float64Array(values.length);

  // eslint-disable-next-line unicorn/no-for-loop -- classic loop is more efficient
  for (let i = 0; i < values.length; i += 1) {
    const [real, imag] = values[i];
    phase[i] = Math.atan2(imag, real);
    amplitude[i] = Math.hypot(real, imag);
  }

  return { phase, amplitude };
}

export function getRealImag(values: H5WebComplex[]): {
  real: Float64Array;
  imag: Float64Array;
} {
  const real = new Float64Array(values.length);
  const imag = new Float64Array(values.length);

  values.forEach(([re, im], i) => {
    real[i] = re;
    imag[i] = im;
  });

  return { real, imag };
}

/**
 * Abscissa of each of the `count` points of a curve: axis values as is, mid-points if axis values
 * are bin edges (i.e. `count + 1` values), or indices if there are no (or too few) axis values.
 */
export function getCurveAbscissas(
  axisValues: NumArray | undefined,
  count: number,
): NumArray {
  if (!axisValues || axisValues.length < count) {
    return Float64Array.from({ length: count }, (_, i) => i);
  }

  if (axisValues.length > count) {
    return Float64Array.from(
      { length: count },
      (_, i) => (axisValues[i] + axisValues[i + 1]) / 2,
    );
  }

  return axisValues;
}

// Unwrap phase values by removing 2π discontinuities
export function unwrapPhase(values: Float64Array): Float64Array {
  const unwrapped = new Float64Array(values.length);

  if (values.length === 0) {
    return unwrapped;
  }

  let previous = values[0]; // eslint-disable-line @typescript-eslint/prefer-destructuring
  unwrapped[0] = previous;

  for (let i = 1; i < values.length; i += 1) {
    const val = values[i];
    const diff = val - previous;

    previous = val - TWO_PI * Math.round(diff / TWO_PI);
    unwrapped[i] = previous;
  }

  return unwrapped;
}

export function getPhaseAmplitudeArrays(
  values: ArrayValue<NumericLikeType | ComplexType>[],
): {
  phaseArrays: NumArray[];
  unwrappedPhaseArrays: NumArray[];
  amplitudeArrays: NumArray[];
} {
  const phaseArrays: NumArray[] = [];
  const unwrappedPhaseArrays: NumArray[] = [];
  const amplitudeArrays: NumArray[] = [];

  values.forEach((arr) => {
    if (isComplexArray(arr)) {
      const { phase, amplitude } = getPhaseAmplitude(arr);
      phaseArrays.push(phase);
      unwrappedPhaseArrays.push(unwrapPhase(phase));
      amplitudeArrays.push(amplitude);
      return;
    }

    // Consider real numbers as complex numbers with no imaginary parts
    const numArray = toNumArray(arr);
    const phaseArray = numArray.map(() => 0);

    phaseArrays.push(phaseArray);
    unwrappedPhaseArrays.push([...phaseArray]);
    amplitudeArrays.push(numArray.map((v) => Math.abs(v)));
  });

  return { phaseArrays, unwrappedPhaseArrays, amplitudeArrays };
}
