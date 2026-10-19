import { assertNonNull } from '@h5web/shared/guards';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { MockApi } from '../providers/mock/mock-api';
import { getSelectedVisTab, renderApp, waitForAllLoaders } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

/* Value in the tooltip of pixel (row, col) of a heatmap whose image fills the canvas */
async function hoverPixel(
  row: number,
  col: number,
  shape: [number, number],
): Promise<string | null | undefined> {
  await waitForAllLoaders();
  const area = document.querySelector('figure [class*="canvasArea"]');
  assertNonNull(area);
  const { width, height } = area.getBoundingClientRect();
  const [rows, cols] = shape;
  await userEvent.hover(page.elementLocator(area), {
    position: {
      x: ((col + 0.5) / cols) * width,
      y: (1 - (row + 0.5) / rows) * height, // rows go up
    },
  });
  return vi.waitFor(() => {
    const value = document.querySelector('[class*="tooltipValue"] strong');
    assertNonNull(value);
    return value.textContent;
  });
}

beforeEach(async () => {
  await page.viewport(2560, 1080); // whole heatmap toolbar
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('project a stack along the hinted dimension, ignoring NaN', async () => {
  // Value at (κ, row, col) is 10 (κ + 1) + row + col / 10, NaN at (3, 0, 0)
  const getValue = vi.spyOn(MockApi.prototype, 'getValue');
  await renderApp('/view_hints/projection_max');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  await expect
    .element(page.getByRole('figure', { name: /\(max over kappa\)$/u }))
    .toBeVisible();

  // Projected dimension shown as such, without slider
  const projected = page.getByRole('group', { name: /projected$/u });
  await expect.element(projected).toHaveTextContent('max');
  expect(projected).toHaveTextContent('over 0:3');
  expect(page.getByRole('slider', { name: 'kappa' })).not.toBeInTheDocument();

  // Whole stack fetched once
  const calls = getValue.mock.calls.filter(
    ([dataset]) => dataset.path === '/view_hints/projection_max',
  );
  expect(calls.map(([, selection]) => selection)).toStrictEqual([undefined]);
  getValue.mockRestore();

  await expect(hoverPixel(0, 0, [3, 5])).resolves.toBe('30'); // NaN at κ = 3 ignored
  await expect(hoverPixel(1, 2, [3, 5])).resolves.toBe('41.2');
});

test('switch between projections and slices', async () => {
  const { user } = await renderApp('/view_hints/projection_mean');

  // Hinted dimension (by index), mean of 11.2, 21.2, 31.2, 41.2
  await expect
    .element(page.getByRole('figure', { name: /\(mean over D0\)$/u }))
    .toBeVisible();
  await expect(hoverPixel(1, 2, [3, 5])).resolves.toBe('26.2');
  await expect(hoverPixel(0, 0, [3, 5])).resolves.toBe('20'); // mean of 10, 20, 30

  await user.click(page.getByRole('combobox', { name: 'Mean' }));
  await user.click(page.getByRole('option', { name: 'Sum' }));
  await expect
    .element(page.getByRole('figure', { name: /\(sum over D0\)$/u }))
    .toBeVisible();
  await expect(hoverPixel(0, 0, [3, 5])).resolves.toBe('60');

  // No projection: slider back, first slice shown
  await user.click(page.getByRole('combobox', { name: 'Sum' }));
  await user.click(page.getByRole('option', { name: 'None' }));
  await expect
    .element(page.getByRole('figure', { name: 'projection_mean' }))
    .toBeVisible();
  expect(page.getByRole('slider', { name: 'D0' })).toBeVisible();
  await expect(hoverPixel(1, 2, [3, 5])).resolves.toBe('11.2');
});

test('stop playback when projecting', async () => {
  const { user } = await renderApp('/arrays/threeD');
  const playBtn = page.getByRole('button', { name: 'Play D0' });
  await user.click(playBtn);
  await expect.element(playBtn).toHaveAttribute('aria-pressed', 'true');

  await user.click(page.getByRole('combobox', { name: 'None' }));
  await user.click(page.getByRole('option', { name: 'Max' }));
  await expect
    .element(page.getByRole('group', { name: 'D0 projected' }))
    .toBeVisible();

  // Slices again: not playing (the playback range of slices didn't apply to the projection)
  await user.click(page.getByRole('combobox', { name: 'Max' }));
  await user.click(page.getByRole('option', { name: 'None' }));
  await expect.element(playBtn).toHaveAttribute('aria-pressed', 'false');
});

test('project in 3D too, with the control in the toolbar', async () => {
  const { user } = await renderApp('/view_hints/projection_max');
  await user.click(page.getByRole('button', { name: 'Show as 3D surface' }));

  await expect
    .element(page.getByRole('figure', { name: /\(max over kappa\)$/u }))
    .toBeVisible();
  await user.click(page.getByRole('combobox', { name: 'Max' }));
  await user.click(page.getByRole('option', { name: 'Min' }));
  await expect
    .element(page.getByRole('figure', { name: /\(min over kappa\)$/u }))
    .toBeVisible();
});

test('leave the playback range of slices out of projections', async () => {
  // Stack from 10 to 42.4; max over κ from 30 (NaN at κ = 3 ignored) to 42.4
  const { user } = await renderApp('/view_hints/projection_max');
  await user.click(page.getByRole('combobox', { name: 'Max' }));
  await user.click(page.getByRole('option', { name: 'None' }));

  // Play through the stack with its whole range (default), then stop
  const playBtn = page.getByRole('button', { name: 'Play D0' });
  await user.click(playBtn);
  await expect.element(page.getByLabelText('Min: 10')).toBeVisible();
  await user.click(playBtn);
  await expect.element(playBtn).toHaveAttribute('aria-pressed', 'false');

  await user.click(page.getByRole('combobox', { name: 'None' }));
  await user.click(page.getByRole('option', { name: 'Max' }));
  await expect.element(page.getByLabelText('Min: 30')).toBeVisible();
  expect(page.getByLabelText('Max: 42.4')).toBeVisible();
});
