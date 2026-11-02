import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, renderApp, waitForAllLoaders } from '../test-utils';
import { NxDataVis } from '../vis-packs/nexus/visualizations';

test('pick auxiliary signal on NX Line', async () => {
  await renderApp('/nexus/spectrum_with_aux');
  expect(getSelectedVisTab()).toBe(NxDataVis.NxLine);
  expect(page.getByRole('figure', { name: 'twoD (arb. units)' })).toBeVisible();

  await page.getByRole('button', { name: 'Signals' }).click();
  await page.getByRole('checkbox', { name: 'secondary' }).click();
  await page.getByRole('checkbox', { name: 'tertiary_cplx' }).click();
  await waitForAllLoaders();

  expect(
    page.getByRole('checkbox', { name: 'Auxiliary signals' }),
  ).not.toBeChecked();
});

test('pick auxiliary signal on NX Heatmap', async () => {
  await renderApp('/nexus/image_with_aux');
  expect(getSelectedVisTab()).toBe(NxDataVis.NxHeatmap);
  expect(page.getByRole('figure', { name: 'twoD' })).toBeVisible();

  await page.getByRole('button', { name: 'Signals' }).click();
  await page.getByRole('radio', { name: 'tertiary' }).click();
  await waitForAllLoaders();

  expect(page.getByRole('figure', { name: 'tertiary' })).toBeVisible();
});

test('color auxiliary signal checkboxes like their curves on NX Line', async () => {
  await renderApp('/nexus/spectrum_with_aux');
  await page.getByRole('button', { name: 'Signals' }).click();

  const accent = (name: string) =>
    getComputedStyle(
      page.getByRole('checkbox', { name, exact: true }).element(),
    ).accentColor;

  await expect
    .element(page.getByRole('checkbox', { name: 'secondary' }))
    .toBeVisible();
  expect(accent('twoD (arb. units)')).toBe('rgb(0, 0, 139)'); // darkblue
  expect(accent('secondary')).toBe('rgb(255, 69, 0)'); // orangered
  expect(accent('tertiary_cplx')).toBe('rgb(34, 139, 34)'); // forestgreen
});

test('toggle series of a hint on Line, with checkboxes colored like their curves', async () => {
  await renderApp('/view_hints/series_data');
  const getLegend = () =>
    [...document.querySelectorAll('figure li')].map((li) => li.textContent);
  await expect.poll(getLegend).toEqual(['measured', 'fit e⁻ˣ/⁶', 'bound']);

  await page.getByRole('button', { name: 'Signals' }).click();
  const accent = (name: string) =>
    getComputedStyle(
      page.getByRole('checkbox', { name, exact: true }).element(),
    ).accentColor;

  expect(accent('measured')).toBe('rgb(235, 104, 52)'); // `H5WEB_color` of the dataset
  expect(accent('fit e⁻ˣ/⁶')).toBe('rgb(207, 23, 23)'); // `H5WEB_color` of the series
  expect(accent('bound')).toBe('rgb(0, 0, 0)'); // `foreground`: black in light mode
  const marks = document.querySelectorAll<HTMLElement>('figure li > span');
  expect(getComputedStyle(marks[2]).color).toBe('rgb(0, 0, 0)'); // its curve's

  await page.getByRole('checkbox', { name: 'fit e⁻ˣ/⁶' }).click();
  await expect.poll(getLegend).toEqual(['measured', 'bound']);
  expect(page.getByRole('checkbox', { name: 'Series' })).toBePartiallyChecked();

  await page.getByRole('checkbox', { name: 'measured' }).click();
  await expect.poll(getLegend).toEqual(['bound']);
});
