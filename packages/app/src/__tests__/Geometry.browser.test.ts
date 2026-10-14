import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';
import { NxDataVis } from '../vis-packs/nexus/visualizations';

/* Creating a WebGL context is slow with SwiftShader (cf. `HeatmapSurface.browser.test.ts`) */
const TEST_TIMEOUT = 20_000;

function resetViewBtn() {
  return page.getByRole('button', { name: 'Reset view' });
}

// Wide enough for 3D toolbars to fit without moving controls into "More controls" menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test(
  'visualize field on 3D curve given by CF `coordinates` attribute',
  async () => {
    await renderApp('/geometry/knot_speed');

    expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line, Vis.Curve]);
    expect(getSelectedVisTab()).toBe(Vis.Curve);
    await expect
      .element(page.getByRole('figure', { name: 'knot_speed' }))
      .toBeVisible();
    await expect.element(resetViewBtn()).toBeVisible();

    // Nothing to slice
    expect(page.getByRole('slider', { name: 'D0' })).not.toBeInTheDocument();
  },
  TEST_TIMEOUT,
);

test(
  'visualize curve given by vertices, coloured by index',
  async () => {
    await renderApp('/geometry/helix');

    expect(getVisTabs()).toEqual([
      Vis.Matrix,
      Vis.Line,
      Vis.Heatmap,
      Vis.Curve,
    ]);
    expect(getSelectedVisTab()).toBe(Vis.Curve);
    await expect
      .element(page.getByRole('figure', { name: 'helix (coloured by index)' }))
      .toBeVisible();
  },
  TEST_TIMEOUT,
);

test(
  'change curve aspect',
  async () => {
    const { user } = await renderApp('/geometry/knot_speed');
    await expect.element(resetViewBtn()).toBeVisible();

    await user.click(page.getByRole('button', { name: 'Aspect' }));
    const pointsRadio = page.getByRole('radio', { name: 'Points' });
    const thickRadio = page.getByRole('radio', { name: '5 px' });
    expect(page.getByRole('radio', { name: 'Line' })).toBeChecked();
    expect(page.getByRole('radio', { name: '2 px' })).toBeChecked();

    await user.click(thickRadio);
    expect(thickRadio).toBeChecked();

    await user.click(pointsRadio);
    expect(pointsRadio).toBeChecked();
    expect(page.getByText('5 px').element().closest('label')).toHaveAttribute(
      'aria-disabled',
      'true',
    ); // no line to draw
  },
  TEST_TIMEOUT,
);

test(
  'visualize field on parametric surface given by CF `coordinates` attribute',
  async () => {
    await renderApp('/geometry/torus_curvature');

    expect(getVisTabs()).toEqual([
      Vis.Matrix,
      Vis.Line,
      Vis.Heatmap,
      Vis.Surface,
    ]);
    expect(getSelectedVisTab()).toBe(Vis.Surface);
    await expect
      .element(page.getByRole('figure', { name: 'torus_curvature' }))
      .toBeVisible();
  },
  TEST_TIMEOUT,
);

test(
  'switch surface representation',
  async () => {
    const { user } = await renderApp('/geometry/torus_curvature');
    await expect.element(resetViewBtn()).toBeVisible();

    const surfaceRadio = page.getByRole('radio', { name: 'Surface' });
    const wireframeRadio = page.getByRole('radio', { name: 'Wireframe' });
    const shadingBtn = page.getByRole('button', { name: 'Shading' });
    expect(surfaceRadio).toBeChecked();
    expect(shadingBtn).toHaveAttribute('aria-pressed', 'true');

    await user.click(wireframeRadio);
    expect(wireframeRadio).toBeChecked();
    expect(shadingBtn).toBeDisabled(); // wireframe is not shaded

    await user.click(page.getByRole('radio', { name: 'Both' }));
    expect(shadingBtn).toBeEnabled();

    await user.click(shadingBtn);
    expect(shadingBtn).toHaveAttribute('aria-pressed', 'false');
    await expect.element(resetViewBtn()).toBeVisible();
  },
  TEST_TIMEOUT,
);

test(
  'slice leading dimension of field defined on surface',
  async () => {
    const { user } = await renderApp('/geometry/torus_waves');

    expect(getSelectedVisTab()).toBe(Vis.Surface);
    const d0Slider = page.getByRole('slider', { name: 'D0' });
    expect(d0Slider).toHaveValue(0);

    // Geometry dimensions are locked
    expect(page.getByRole('slider', { name: 'D1' })).not.toBeInTheDocument();
    expect(page.getByRole('slider', { name: 'D2' })).not.toBeInTheDocument();

    await user.type(d0Slider, '{ArrowUp}');
    expect(d0Slider).toHaveValue(1);
    await expect
      .element(page.getByRole('figure', { name: 'torus_waves' }))
      .toBeVisible();
  },
  TEST_TIMEOUT,
);

test(
  'visualize NeXus signal defined on parametric surface',
  async () => {
    await renderApp('/geometry/nx_torus');

    expect(getVisTabs()).toEqual([
      NxDataVis.NxLine,
      NxDataVis.NxHeatmap,
      NxDataVis.NxSurface,
    ]);
    expect(getSelectedVisTab()).toBe(NxDataVis.NxSurface);
    await expect
      .element(page.getByRole('figure', { name: 'curvature' }))
      .toBeVisible();
  },
  TEST_TIMEOUT,
);

test('do not offer 3D visualizations for datasets that do not follow convention', async () => {
  const { selectExplorerNode } = await renderApp('/geometry/helix_table');

  // (N, 3) dataset without `interpretation="vertex"`
  expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line, Vis.Heatmap]);

  // Coordinate not found
  await selectExplorerNode('knot_coordinates_missing');
  expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line]);

  // Only two coordinates (e.g. curvilinear lon/lat grid)
  await selectExplorerNode('torus_curvilinear');
  expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line, Vis.Heatmap]);

  // Coordinates themselves
  await selectExplorerNode('torus_x');
  expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line, Vis.Heatmap]);
});
