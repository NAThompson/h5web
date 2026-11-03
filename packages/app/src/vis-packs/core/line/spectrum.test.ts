import { assert, expect, test } from 'vitest';

import {
  getBoostMath,
  getSpectrumAxis,
  getSpectrumBlocker,
  getUniformSpacing,
} from './spectrum';

const N = 200;
const DT = 0.01; // 100 Hz
const TIME = Float64Array.from({ length: N }, (_, i) => i * DT);

test('frequency axis of uniform abscissas, else cycles per sample', () => {
  expect(getUniformSpacing(TIME)).toBeCloseTo(DT);
  expect(getUniformSpacing([0, 1, 3])).toBeUndefined();
  expect(getUniformSpacing([3, 2, 1])).toBe(1); // descending

  const { frequencies, label } = getSpectrumAxis(N, TIME, 'time');
  expect(frequencies).toHaveLength(N / 2 + 1);
  expect(frequencies[1]).toBeCloseTo(0.5); // 1 / (N Δt)
  expect(frequencies.at(-1)).toBeCloseTo(50); // Nyquist
  expect(label).toBe('Frequency (1/time)');

  const byIndex = getSpectrumAxis(5, [0, 1, 3, 4, 9]);
  expect(byIndex.frequencies).toEqual(Float64Array.from([0, 0.2, 0.4]));
  expect(byIndex.label).toBe('Frequency (cycles/sample)');
});

test('no spectrum of too few values, or values not finite or invalid', () => {
  expect(getSpectrumBlocker([1, 2])).toBeUndefined();
  expect(getSpectrumBlocker([1, Number.NaN])).toBeDefined();
  expect(getSpectrumBlocker([1, 2], (val) => val === 2)).toMatch('valid');
  expect(getSpectrumBlocker([1])).toBeDefined();
});

test('power spectrum of a 5 Hz sine peaks at 5 Hz', async () => {
  const signal = TIME.map((t) => 3 * Math.sin(2 * Math.PI * 5 * t));
  const boostMath = await getBoostMath();
  assert(!(boostMath instanceof Error));
  const power = boostMath.power_spectrum(signal);
  const { frequencies } = getSpectrumAxis(N, TIME);

  const peak = power.indexOf(Math.max(...power));
  expect(frequencies[peak]).toBeCloseTo(5);
  expect(power[peak]).toBeCloseTo(4.5); // A²/2
  expect(power.reduce((a, b) => a + b)).toBeCloseTo(4.5); // mean(x²)
});
