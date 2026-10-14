import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';
import { NxDataVis } from '../vis-packs/nexus/visualizations';

// Rendering in 3D creates a WebGL context (slow with SwiftShader), cf. `HeatmapSurface.browser.test.ts`
const CURVE_TEST_TIMEOUT = 20_000;

test(
  'show complex 1D dataset as 3D curve coloured by phase or amplitude',
  async () => {
    const { user, selectVisTab } = await renderApp('/arrays/oneD_complex');

    // Amplitude/phase line plot stays the default
    expect(getVisTabs()).toEqual([Vis.Matrix, Vis.ComplexCurve, Vis.Line]);
    expect(getSelectedVisTab()).toBe(Vis.Line);

    await selectVisTab(Vis.ComplexCurve);

    const phaseFigure = page.getByRole('figure', {
      name: 'oneD_complex (coloured by phase)',
    });
    await expect.element(phaseFigure).toBeVisible();
    expect(page.getByRole('button', { name: 'Reset view' })).toBeVisible();

    // Phase is mapped over [-π, π] with a cyclic colour map; no domain/scale controls
    expect(phaseFigure.getByLabelText(/^Min: [-−]3\.142e\+0$/u)).toBeVisible();
    expect(phaseFigure.getByLabelText('Max: 3.142e+0')).toBeVisible();
    expect(page.getByRole('combobox', { name: /Twilight/u })).toBeVisible();
    expect(
      page.getByRole('button', { name: 'Edit domain' }),
    ).not.toBeInTheDocument();

    await user.click(page.getByRole('combobox', { name: 'φ Phase' }));
    await user.click(page.getByRole('option', { name: '𝓐 Amplitude' }));

    const amplitudeFigure = page.getByRole('figure', {
      name: 'oneD_complex (coloured by amplitude)',
    });
    await expect.element(amplitudeFigure).toBeVisible();
    expect(page.getByRole('combobox', { name: /Viridis/u })).toBeVisible();
    expect(page.getByRole('button', { name: 'Edit domain' })).toBeVisible();
  },
  CURVE_TEST_TIMEOUT,
);

test(
  'show complex NeXus signal as 3D curve',
  async () => {
    const { selectVisTab } = await renderApp('/nexus/spectrum_complex');
    expect(getSelectedVisTab()).toBe(NxDataVis.NxLine);

    await selectVisTab(NxDataVis.NxComplexCurve);
    await expect
      .element(page.getByRole('button', { name: 'Reset view' }))
      .toBeVisible();
    expect(
      page.getByRole('figure', { name: /coloured by phase/u }),
    ).toBeVisible();
  },
  CURVE_TEST_TIMEOUT,
);

test(
  'only make Complex Curve the preferred vis for 1D datasets',
  async () => {
    const { selectVisTab, selectExplorerNode } = await renderApp(
      '/arrays/twoD_complex',
    );

    // A 2D complex dataset maps C → C, so it doesn't offer a curve...
    expect(
      page.getByRole('tab', { name: Vis.ComplexCurve }),
    ).not.toBeInTheDocument();
    await selectExplorerNode('oneD_complex');

    // ... whereas a 1D dataset does, and picking it is saved as preference
    await selectVisTab(Vis.ComplexCurve);
    await selectExplorerNode('oneD');
    await selectExplorerNode('oneD_complex');
    expect(getSelectedVisTab()).toBe(Vis.ComplexCurve);

    // ... but does not apply to 2D datasets
    await selectExplorerNode('twoD_complex');
    expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  },
  CURVE_TEST_TIMEOUT,
);

test(
  'slice and play back complex NeXus signal as 3D curve',
  async () => {
    const { selectVisTab } = await renderApp('/nexus/spectrum_complex');
    await selectVisTab(NxDataVis.NxComplexCurve);
    await expect
      .element(page.getByRole('button', { name: 'Reset view' }))
      .toBeVisible();

    const slider = page.getByRole('slider', { name: 'D0' });
    expect(slider).toHaveValue(0);

    // Playback only waits for the signal (no errors or auxiliary signals to fetch)
    await page.getByRole('button', { name: 'Play D0' }).click();
    await expect
      .poll(() => Number(slider.element().getAttribute('aria-valuenow')), {
        timeout: 10_000,
      })
      .toBe(1); // `twoD_complex` signal has dims [2, 2]
    await page.getByRole('button', { name: 'Play D0' }).click();

    expect(
      page.getByRole('figure', { name: /coloured by phase/u }),
    ).toBeVisible();
  },
  CURVE_TEST_TIMEOUT,
);
