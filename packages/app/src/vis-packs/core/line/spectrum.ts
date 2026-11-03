import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type BoostMath } from 'boost-math-wasm';

import { isValidValue } from './qq';

const UNIFORM_TOLERANCE = 1e-3; // relative to the mean spacing

let boostMath: Promise<BoostMath | Error> | undefined;

async function loadBoostMath(): Promise<BoostMath | Error> {
  try {
    const { default: createModule } = await import('boost-math-wasm');
    return await createModule();
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Boost.Math failed to load');
  }
}

/* Boost.Math WASM module, fetched on first use (about 1 MB) and cached; resolves to the error if
 * it can't be loaded (e.g. CSP), to show the signal instead */
// eslint-disable-next-line @typescript-eslint/promise-function-async -- same promise each call, for `use()`
export function getBoostMath(): Promise<BoostMath | Error> {
  if (!boostMath) {
    boostMath = loadBoostMath();
  }
  return boostMath;
}

/* Why the spectrum of a slice can't be shown, if it can't */
export function getSpectrumBlocker(
  array: NumArray,
  ignoreValue?: IgnoreValue,
): string | undefined {
  if (array.length < 2) {
    return 'Spectrum: needs at least 2 values';
  }
  if (!array.every((val) => isValidValue(val, ignoreValue))) {
    return 'Spectrum: needs finite, valid values (no NaN, ∞, fill or out-of-range value)';
  }
  return undefined;
}

/* Spacing of uniformly spaced abscissas (within tolerance), else `undefined` */
export function getUniformSpacing(abscissas: NumArray): number | undefined {
  const n = abscissas.length;
  if (n < 2) {
    return undefined;
  }
  const dx = (abscissas[n - 1] - abscissas[0]) / (n - 1);
  if (!Number.isFinite(dx) || dx === 0) {
    return undefined;
  }
  for (let i = 1; i < n; i += 1) {
    const step = abscissas[i] - abscissas[i - 1];
    if (!(Math.abs(step - dx) <= UNIFORM_TOLERANCE * Math.abs(dx))) {
      return undefined;
    }
  }
  return Math.abs(dx);
}

/* Frequencies f_k = k / (N Δx), k = 0, ..., floor(N/2), and their axis label; Δx = 1 (cycles per
 * sample) unless the abscissas are uniformly spaced */
export function getSpectrumAxis(
  n: number,
  abscissas?: NumArray,
  label?: string,
): { frequencies: Float64Array; label: string } {
  const dx =
    abscissas && [n, n + 1].includes(abscissas.length) // values or bin edges
      ? getUniformSpacing(abscissas.slice(0, n))
      : undefined;
  const frequencies = Float64Array.from(
    { length: Math.floor(n / 2) + 1 },
    (_, k) => k / (n * (dx ?? 1)),
  );
  if (dx === undefined) {
    return { frequencies, label: 'Frequency (cycles/sample)' };
  }
  return { frequencies, label: label ? `Frequency (1/${label})` : 'Frequency' };
}
