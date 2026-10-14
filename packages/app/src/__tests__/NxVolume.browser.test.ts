import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';
import { NxDataVis } from '../vis-packs/nexus/visualizations';

// Leave room for the whole volume toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('open NXdata with a 3D signal and an axis on every dimension as a volume', async () => {
  const { user } = await renderApp('/dimension_scales/fermi_nxdata');

  expect(getVisTabs()).toEqual([
    NxDataVis.NxLine,
    NxDataVis.NxVolume,
    NxDataVis.NxHeatmap,
  ]);
  expect(getSelectedVisTab()).toBe(NxDataVis.NxVolume);

  await expect
    .element(page.getByRole('figure', { name: 'Tight-binding band' }))
    .toBeVisible();

  // Same controls as the core Volume vis, including isosurfaces
  expect(page.getByRole('button', { name: 'Show volume' })).toBeVisible();
  expect(
    page.getByRole('radiogroup', { name: 'Rendering mode' }),
  ).toBeVisible();

  await user.click(
    page.getByRole('button', { name: 'Isosurfaces', exact: true }),
  );
  await user.click(page.getByRole('button', { name: 'Add level' }));
  await user.click(page.getByRole('radio', { name: '|∇f|' }));

  // Gradients are expressed in the units of the signal and of the NeXus axes
  await expect
    .element(page.getByLabelText('Gradient magnitude'), { timeout: 10_000 })
    .toHaveTextContent('|∇f| (eV per 1/a)');

  // Presentation changes keep the extracted surface (no new extraction)
  await expect.poll(() => document.querySelector('[role="status"]')).toBeNull();
  await user.click(page.getByRole('radio', { name: 'Solid' }));
  await user.click(page.getByRole('button', { name: 'Show volume' }));
  expect(document.querySelector('[role="status"]')).toBeNull();
}, 20_000); // WebGL contexts and extraction are slow when many test files run in parallel

test('offer volume for stacks of images without making it the default', async () => {
  const { selectVisTab } = await renderApp('/nexus/image');

  expect(getVisTabs()).toContain(NxDataVis.NxVolume);
  expect(getSelectedVisTab()).toBe(NxDataVis.NxHeatmap);

  // 4D signal: the leading dimension is sliced, the last three form the volume
  await selectVisTab(NxDataVis.NxVolume);
  await expect.element(page.getByRole('slider', { name: 'D0' })).toBeVisible();
  expect(page.getByRole('slider', { name: 'D1' })).not.toBeInTheDocument();
  expect(
    page.getByRole('button', { name: 'Isosurfaces', exact: true }),
  ).toBeVisible();
});

test.each<`/${string}`>([
  '/nexus/spectrum', // 1D
  '/nexus/NXdata', // 2D
  '/nexus/rgba-image',
  '/nexus/image_complex',
])('do not offer volume for %s', async (path) => {
  await renderApp(path);
  expect(getVisTabs()).not.toContain(NxDataVis.NxVolume);
});

test('ignore default slice indices on the volume dimensions', async () => {
  // `default_slice` ['.', '.', '.', '5']
  const { selectVisTab } = await renderApp(
    '/dimension_scales/volume_default_slice',
  );
  await selectVisTab(NxDataVis.NxVolume);
  await expect
    .element(page.getByRole('figure', { name: 'fourD' }))
    .toBeVisible();
  expect(page.getByRole('slider', { name: 'D0' })).toHaveValue(0);
  expect(page.getByRole('slider', { name: 'D3' })).not.toBeInTheDocument();
});

test('keep default slice indices on leading dimensions', async () => {
  // `default_slice` ['1', '.', '2', '.']: index on a volume dimension is ignored
  const { selectVisTab } = await renderApp('/nexus/default_slice');
  await selectVisTab(NxDataVis.NxVolume);
  await expect.element(page.getByRole('slider', { name: 'D0' })).toHaveValue(1);
  expect(page.getByRole('slider', { name: 'D2' })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole('figure', { name: 'fourD' }))
    .toBeVisible();
});

test('keep heatmap as default after selecting a volume once', async () => {
  const { selectVisTab, selectNexusExplorerNode } =
    await renderApp('/nexus/image');

  await selectVisTab(NxDataVis.NxVolume);
  expect(getSelectedVisTab()).toBe(NxDataVis.NxVolume);

  // Another stack of images: volume is not remembered as the preferred vis
  await selectNexusExplorerNode('default_slice');
  expect(getSelectedVisTab()).toBe(NxDataVis.NxHeatmap);
});

test('keep core heatmap as default after selecting a volume once', async () => {
  const { selectVisTab, selectExplorerNode } =
    await renderApp('/arrays/threeD');

  await selectVisTab(Vis.Volume);
  await selectExplorerNode('threeD_volume');
  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
});

test('use bin-edge axes and SILX_style scale type', async () => {
  await renderApp('/dimension_scales/fermi_nxdata_bins');

  expect(getSelectedVisTab()).toBe(NxDataVis.NxVolume); // bin edges count as axes
  await expect
    .element(page.getByRole('combobox', { name: 'SymLog' }))
    .toBeVisible();
});

test('show title over the canvas, above status messages', async () => {
  const { user } = await renderApp('/dimension_scales/fermi_nxdata');

  const title = page.getByText('Tight-binding band', { exact: true });
  await expect.element(title).toBeVisible();
  expect(getComputedStyle(title.element()).textOverflow).toBe('ellipsis');

  // Hide the volume without isosurfaces: the hint appears below the title
  await user.click(page.getByRole('button', { name: 'Show volume' }));
  const hint = page.getByRole('note');
  await expect.element(hint).toHaveTextContent(/Volume hidden/u);
  expect(hint.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(
    title.element().getBoundingClientRect().bottom,
  );
});
