import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

test('visualize dataset with `valid_min` and/or `valid_max` attributes', async () => {
  const { selectExplorerNode } = await renderApp('/netcdf/valid_min');

  expect(page.getByLabelText('Min: 5')).toBeVisible(); // valid_min
  expect(page.getByLabelText('Max: 400')).toBeVisible(); // data max

  await selectExplorerNode('valid_max');
  expect(page.getByLabelText('Min: −95')).toBeVisible(); // data min
  expect(page.getByLabelText('Max: 200')).toBeVisible(); // valid_max

  await selectExplorerNode('valid_min_max');
  expect(page.getByLabelText('Min: 5')).toBeVisible(); // valid_min
  expect(page.getByLabelText('Max: 200')).toBeVisible(); // valid_max
});

test('visualize dataset with `valid_range` attribute', async () => {
  await renderApp('/netcdf/valid_range');

  expect(page.getByLabelText('Min: 5')).toBeVisible(); // valid_range[0]
  expect(page.getByLabelText('Max: 200')).toBeVisible(); // valid_range[1]
});

test('visualize dataset with `_FillValue` attribute', async () => {
  const { selectExplorerNode } = await renderApp('/netcdf/_FillValue');

  expect(page.getByLabelText('Min: −95')).toBeVisible(); // data min
  expect(page.getByLabelText('Max: 99')).toBeVisible(); // closest data value lower than _FillValue

  await selectExplorerNode('_FillValue (negative)');
  expect(page.getByLabelText('Min: −6')).toBeVisible(); // closest data value greater than _FillValue
  expect(page.getByLabelText('Max: 400')).toBeVisible(); // data max
});

test('visualize dataset with `scale_factor` attribute', async () => {
  const { selectVisTab } = await renderApp('/netcdf/scale_factor');

  expect(page.getByLabelText('Min: −47.5')).toBeVisible(); // data min * scale_factor
  expect(page.getByLabelText('Max: 200')).toBeVisible(); // data max * scale_factor

  await selectVisTab(Vis.Line);
  const figure = page.getByRole('figure', { name: 'scale_factor' });
  await expect.element(figure.getByText('200', { exact: true })).toBeVisible(); // y-axis tick at slice max * scale_factor
  expect(figure.getByText('400', { exact: true })).not.toBeInTheDocument();

  await selectVisTab(Vis.Matrix);
  expect(page.getByText('2.000e+2')).toBeVisible(); // first packed value * scale_factor
  expect(page.getByText('4.000e+2')).not.toBeInTheDocument(); // first packed value
});

test('visualize dataset with `scale_factor`, `add_offset` and `_FillValue` attributes', async () => {
  await renderApp('/netcdf/scale_factor_add_offset');

  expect(page.getByLabelText('Min: −37.5')).toBeVisible(); // data min * scale_factor + add_offset
  expect(page.getByLabelText('Max: 59.5')).toBeVisible(); // closest packed value lower than _FillValue, unpacked
});

test('visualize dataset with `scale_factor` and `valid_range` in unpacked units', async () => {
  await renderApp('/netcdf/scale_factor_valid_range');

  expect(page.getByLabelText('Min: 0')).toBeVisible(); // valid_range[0]
  expect(page.getByLabelText('Max: 50')).toBeVisible(); // valid_range[1]
});
