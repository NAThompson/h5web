import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';

function surfaceBtn() {
  return page.getByRole('button', { name: 'Show as 3D surface' });
}

function resetViewBtn() {
  return page.getByRole('button', { name: 'Reset view' });
}

// Switching to 3D creates a WebGL context (slow with SwiftShader), cf. `HeatmapSurface.browser.test.ts`
const SURFACE_TEST_TIMEOUT = 20_000;

// Wide enough for the whole 3D toolbar to fit, so no control moves to the overflow menu after switching
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test(
  'show complex 2D dataset as analytic landscape: height = amplitude, colour = phase',
  async () => {
    const { user } = await renderApp('/arrays/twoD_complex');
    expect(
      page.getByRole('figure', { name: 'twoD_complex (amplitude)' }),
    ).toBeVisible();

    await user.click(surfaceBtn());

    // Switches to "Phase & Amplitude": amplitude as height, phase as colour
    const figure = page.getByRole('figure', {
      name: 'twoD_complex (phase & amplitude)',
    });
    await expect.element(figure).toBeVisible();
    await expect.element(resetViewBtn()).toBeVisible();
    expect(
      page.getByRole('combobox', { name: 'φ𝓐 Phase & Amp.' }),
    ).toBeVisible();

    // Colour bar shows phase over [-π, π], with a cyclic colour map
    expect(figure.getByLabelText(/^Min: [-−]3\.142e\+0$/u)).toBeVisible();
    expect(figure.getByLabelText('Max: 3.142e+0')).toBeVisible();
    expect(page.getByRole('combobox', { name: /HSL/u })).toBeVisible();

    // Back to 2D: phase coloured, amplitude as alpha
    await user.click(surfaceBtn());
    expect(resetViewBtn()).not.toBeInTheDocument();
    await expect.element(figure).toBeVisible();
  },
  SURFACE_TEST_TIMEOUT,
);

test(
  'keep amplitude colours in 3D when picking amplitude mode',
  async () => {
    const { user } = await renderApp('/arrays/twoD_complex');
    await user.click(surfaceBtn());

    await user.click(page.getByRole('combobox', { name: 'φ𝓐 Phase & Amp.' }));
    await user.click(page.getByRole('option', { name: '𝓐 Amplitude' }));

    const figure = page.getByRole('figure', {
      name: 'twoD_complex (amplitude)',
    });
    await expect.element(figure).toBeVisible();
    expect(resetViewBtn()).toBeVisible();
    expect(figure.getByLabelText('Max: 5e+0')).toBeVisible();
    expect(page.getByRole('combobox', { name: /Viridis/u })).toBeVisible();
  },
  SURFACE_TEST_TIMEOUT,
);

test(
  'offer 3D toggle for complex NeXus images',
  async () => {
    const { user } = await renderApp('/nexus/image_complex');
    await user.click(surfaceBtn());
    await expect.element(resetViewBtn()).toBeVisible();
  },
  SURFACE_TEST_TIMEOUT,
);
