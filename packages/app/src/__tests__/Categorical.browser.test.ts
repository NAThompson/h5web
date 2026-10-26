import { renderSvgSnapshot } from '@h5web/lib';
import { assertNonNull } from '@h5web/shared/guards';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

function getLegend() {
  return page.getByLabelText('Categories', { exact: true });
}

function getLegendItems(): string[] {
  return getLegend()
    .getByRole('listitem')
    .elements()
    .map((item) => item.textContent);
}

function getToggle() {
  return page.getByRole('button', { name: 'Categorical colors' });
}

beforeEach(async () => {
  await page.viewport(1920, 1080);
});

afterEach(() => {
  globalThis.localStorage.clear();
});

test('show CF flags with categorical colors and their meanings', async () => {
  await renderApp('/categorical/land_cover');
  expect(getSelectedVisTab()).toBe(Vis.Heatmap);

  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toEqual([
    '1water',
    '2forest',
    '3grassland',
    '4cropland',
    '5urban',
    '6bare soil',
  ]);
  expect(getToggle()).toHaveAttribute('aria-pressed', 'true');

  // No color domain nor color map: they make no sense for categories
  expect(page.getByRole('button', { name: 'Edit domain' }).query()).toBeNull();
  expect(page.getByRole('button', { name: 'Invert' }).query()).toBeNull();
});

test('switch label data between categories and color map', async () => {
  await renderApp('/categorical/segmentation'); // `H5WEB_categorical`

  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toEqual(['0', '1', '2', '3', '4', '5', '9']);

  await getToggle().click();
  await expect.element(getToggle()).toHaveAttribute('aria-pressed', 'false');
  expect(getLegend().query()).toBeNull();
  await expect
    .element(page.getByRole('button', { name: 'Edit domain' }))
    .toBeVisible();
});

test('turn on categorical colors of integers without hint', async () => {
  await renderApp('/arrays/typed/uint8');

  await expect.element(getToggle()).toHaveAttribute('aria-pressed', 'false');
  expect(getLegend().query()).toBeNull();

  await getToggle().click();
  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toEqual(['0', '1', '2', '3']);
  await expect
    .element(page.getByRole('combobox', { name: 'Palette' }))
    .toHaveTextContent('Glasbey');
});

test('label categories of an enum by its members', async () => {
  await renderApp('/arrays/twoD_enum');

  await getToggle().click();
  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toEqual(['0FOO', '1BAR', '2BAZ']);
});

test('not offer categorical colors for floats', async () => {
  await renderApp('/arrays/twoD');
  await expect
    .element(page.getByRole('button', { name: 'Edit domain' }))
    .toBeVisible();
  expect(getToggle().query()).toBeNull();
});

test('color a labelled point cloud by category', async () => {
  await renderApp('/categorical/clusters');
  expect(getSelectedVisTab()).toBe(Vis.Scatter3D);

  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toHaveLength(12);
  expect(getLegend()).toHaveTextContent('cluster');
});

test('show orthoslices of material IDs with a discrete legend', async () => {
  await page.viewport(2560, 1440);
  await renderApp('/categorical/materials');
  expect(getSelectedVisTab()).toBe(Vis.Orthoslices);

  await expect.element(getLegend()).toBeVisible();
  expect(getLegendItems()).toEqual([
    '0core',
    '1inner shell',
    '2outer shell',
    '3coating',
    '4air',
  ]);
});

test('export the discrete legend in snapshots', async () => {
  await renderApp('/categorical/land_cover');
  await expect.element(getLegend()).toBeVisible();

  const figure = page.getByRole('figure').element();
  assertNonNull(figure);
  const svg = renderSvgSnapshot(figure as HTMLElement);
  const texts = [...svg.querySelectorAll('text')].map((t) => t.textContent);
  expect(texts).toContain('water');
  expect(texts).toContain('bare soil');

  // Swatches as filled shapes of the palette's colors (Glasbey starts with Tableau10)
  const fills = [...svg.querySelectorAll('[fill]')].map((elem) =>
    elem.getAttribute('fill')?.replaceAll(' ', ''),
  );
  expect(fills).toContain('rgb(78,121,167)'); // #4e79a7
  expect(fills).toContain('rgb(242,142,44)'); // #f28e2c
});
