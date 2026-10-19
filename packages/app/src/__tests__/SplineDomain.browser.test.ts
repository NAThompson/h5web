import { getSplineDomain } from '@h5web/lib';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

// Spy on spline solves (each `getSplineDomain` call solves one curve)
vi.mock(import('@h5web/lib'), async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    getSplineDomain: vi.fn<typeof mod.getSplineDomain>(mod.getSplineDomain),
  };
});

async function selectInterpolation(name: string): Promise<void> {
  await page.getByRole('button', { name: 'Aspect' }).click();
  await page.getByRole('radio', { name }).click();
  await page.getByRole('button', { name: 'Aspect' }).click(); // close menu
}

test('solve splines only when curves change', async () => {
  await renderApp({ initialPath: '/arrays/fourD', preferredVis: Vis.Line });
  await selectInterpolation('Spline');
  const calls = vi.mocked(getSplineDomain).mock.calls.length;
  expect(calls).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Grid' }).click(); // re-render
  expect(getSplineDomain).toHaveBeenCalledTimes(calls);
});

test('keep overshoot of envelopes in view', async () => {
  await renderApp('/view_hints/envelope_add');
  vi.mocked(getSplineDomain).mockClear();
  await selectInterpolation('Spline');

  // Data and its running min
  const curves = vi.mocked(getSplineDomain).mock.calls.map(([, ys]) => ys);
  expect(new Set(curves).size).toBe(2);
});
