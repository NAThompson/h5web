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

    // 3D has its own mode, "Phase & Amplitude" by default: amplitude as height, phase as colour
    const figure = page.getByRole('figure', {
      name: 'twoD_complex (phase & amplitude)',
    });
    await expect.element(figure).toBeVisible();
    await expect.element(resetViewBtn()).toBeVisible();
    expect(
      page.getByRole('combobox', { name: 'φ𝓐 Phase & Amp.' }),
    ).toBeVisible();

    // Colour bar shows phase over [-π, π], with a cyclic colour map
    expect(figure.getByLabelText(/^Min: [-−]3\.142$/u)).toBeVisible();
    expect(figure.getByLabelText('Max: 3.142')).toBeVisible();
    expect(page.getByRole('combobox', { name: /Twilight/u })).toBeVisible();

    // Back to 2D: amplitude, as before (2D mode untouched)
    await user.click(surfaceBtn());
    expect(resetViewBtn()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (amplitude)' }))
      .toBeVisible();
    expect(page.getByRole('combobox', { name: '𝓐 Amplitude' })).toBeVisible();
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
    expect(figure.getByLabelText('Max: 5')).toBeVisible();
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

test(
  'keep 2D and 3D complex modes separate, across reloads',
  async () => {
    const { user, unmount } = await renderApp('/arrays/twoD_complex');

    // 2D: phase
    await user.click(page.getByRole('combobox', { name: '𝓐 Amplitude' }));
    await user.click(page.getByRole('option', { name: 'φ Phase' }));

    // 3D: amplitude
    await user.click(surfaceBtn());
    await user.click(page.getByRole('combobox', { name: 'φ𝓐 Phase & Amp.' }));
    await user.click(page.getByRole('option', { name: '𝓐 Amplitude' }));
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (amplitude)' }))
      .toBeVisible();

    await user.click(surfaceBtn());
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (phase)' }))
      .toBeVisible();

    // Reload: 2D opens in phase mode (3D mode itself is not restored)...
    await unmount();
    const { user: user2 } = await renderApp('/arrays/twoD_complex');
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (phase)' }))
      .toBeVisible();
    expect(resetViewBtn()).not.toBeInTheDocument();

    // ... and 3D comes back in amplitude mode
    await user2.click(surfaceBtn());
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (amplitude)' }))
      .toBeVisible();
    await expect.element(resetViewBtn()).toBeVisible();
  },
  SURFACE_TEST_TIMEOUT,
);

test(
  'colour phase with cyclic colour map in 2D too, and keep phase height linear',
  async () => {
    const { user } = await renderApp('/arrays/twoD_complex');

    // 2D phase: cyclic colour map, while amplitude keeps Viridis
    expect(page.getByRole('combobox', { name: /Viridis/u })).toBeVisible();
    await user.click(page.getByRole('combobox', { name: '𝓐 Amplitude' }));
    await user.click(page.getByRole('option', { name: 'φ Phase' }));
    expect(page.getByRole('combobox', { name: /Twilight/u })).toBeVisible();

    // Log scale for amplitude...
    await user.click(page.getByRole('combobox', { name: /Linear/u }));
    await user.click(page.getByRole('option', { name: 'Log', exact: true }));

    // ... does not apply to phase as height: no scale selector
    await user.click(surfaceBtn());
    await user.click(page.getByRole('combobox', { name: 'φ𝓐 Phase & Amp.' }));
    await user.click(page.getByRole('option', { name: 'φ Phase' }));
    await expect
      .element(page.getByRole('figure', { name: 'twoD_complex (phase)' }))
      .toBeVisible();
    expect(
      page.getByRole('combobox', { name: /Linear|Log/u }),
    ).not.toBeInTheDocument();
  },
  SURFACE_TEST_TIMEOUT,
);

test(
  'show transposed complex slices in 3D',
  async () => {
    const { user } = await renderApp('/arrays/twoD_complex');
    await user.click(surfaceBtn());
    await expect.element(resetViewBtn()).toBeVisible();

    // Swap axes: height and colour arrays are both transposed views
    const xRadioGroup = page.getByLabelText('Dimension as x axis');
    await user.click(xRadioGroup.getByRole('radio', { name: 'D0' }));

    const figure = page.getByRole('figure', {
      name: 'twoD_complex (phase & amplitude)',
    });
    await expect.element(figure).toBeVisible();
    expect(resetViewBtn()).toBeVisible();
    expect(figure.getByLabelText('Max: 3.142')).toBeVisible();
  },
  SURFACE_TEST_TIMEOUT,
);
