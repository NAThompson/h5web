import { afterEach, beforeEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

async function selectOption(label: string, option: string): Promise<void> {
  await userEvent.click(
    page.getByRole('combobox', { name: new RegExp(`^${label}`, 'u') }),
  );
  await userEvent.click(
    page.getByRole('option', { name: option, exact: true }),
  );
}

// Leave room for the whole volume toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2880, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('resample a VTKHDF unstructured grid into a volume', async () => {
  // Group holding a `VTKHDF` group (e.g. root of a `.vtkhdf` file) shows it
  const { selectVisTab } = await renderApp('/vtkhdf');

  expect(getVisTabs()).toEqual([Vis.Volume, Vis.Orthoslices]);
  expect(getSelectedVisTab()).toBe(Vis.Volume);
  await expect
    .element(page.getByRole('figure', { name: 'gaussian' }))
    .toBeVisible();

  await selectOption('Field', 'cell_index');
  await expect
    .element(page.getByRole('figure', { name: 'cell_index' }), {
      timeout: 10_000,
    })
    .toBeVisible();

  // Field is kept by the other visualization
  await selectVisTab(Vis.Orthoslices);
  await expect
    .element(page.getByRole('figure', { name: 'cell_index' }))
    .toBeVisible();
  expect(
    page.getByRole('combobox', { name: /^Resolution/u }),
  ).toHaveTextContent('auto (32)');

  await selectOption('Field', 'swirl');
  await expect
    .element(page.getByRole('note', { name: 'View hint notes' }))
    .toHaveTextContent('1 note');
}, 20_000); // WebGL contexts are slow when many test files run in parallel

test('show orthoslices of the resampled grid, with no value outside the mesh', async () => {
  const { selectVisTab } = await renderApp('/vtkhdf/VTKHDF');
  await selectVisTab(Vis.Orthoslices);
  await selectOption('Field', 'gaussian'); // selection is remembered from the previous test

  // Near the centre of the ball: exp(-2 × 0.33²) ≈ 0.80, interpolated between points of the mesh
  const readout = page.getByRole('status', { name: 'Crosshair' });
  await expect.element(readout).toHaveTextContent(/0\.78\d+$/u);

  // Corner of the grid (outside the ball)
  await selectOption('Resolution', '64');
  await userEvent.click(page.getByRole('slider', { name: 'x index' }));
  await userEvent.keyboard('{Home}');
  await userEvent.click(page.getByRole('slider', { name: 'y index' }));
  await userEvent.keyboard('{Home}');
  await expect.element(readout).toHaveTextContent(/—$/u);
}, 20_000);
