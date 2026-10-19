import { assertNonNull } from '@h5web/shared/guards';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { MockApi } from '../providers/mock/mock-api';
import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

function getReadout() {
  return page.getByRole('status', { name: 'Crosshair' });
}

function getPlane(name: RegExp) {
  return page.getByRole('figure', { name });
}

/* Click pixel (row, col) of the heatmap of a plane, whose image fills its canvas (no kept ratio) */
async function clickPixel(
  plane: RegExp,
  row: number,
  col: number,
  shape: [number, number],
) {
  const area = getPlane(plane).element().querySelector('[class*="canvasArea"]');
  assertNonNull(area);
  const { width, height } = area.getBoundingClientRect();
  const [rows, cols] = shape;
  await userEvent.click(page.elementLocator(area), {
    position: {
      x: ((col + 0.5) / cols) * width,
      y: (1 - (row + 0.5) / rows) * height, // rows go up
    },
  });
}

// Room for the whole toolbar and four plots
beforeEach(async () => {
  await page.viewport(2560, 1440);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('open orthoslices through the hinted point', async () => {
  // Value at (z, y, x) is 100 z + 10 y + x
  await renderApp('/view_hints/ortho');

  expect(getSelectedVisTab()).toBe(Vis.Orthoslices);
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [1, 2, 3]');
  expect(getReadout()).toHaveTextContent('z = 1, y = 2, x = 3');
  expect(getReadout()).toHaveTextContent('123');

  await expect.element(getPlane(/^XY · z = 1$/u)).toBeVisible();
  expect(getPlane(/^YZ · x = 3$/u)).toBeVisible();
  expect(getPlane(/^XZ · y = 2$/u)).toBeVisible();
  expect(getPlane(/^3D$/u)).toBeVisible();
  expect(page.getByTestId('ortho-crosshair').elements()).toHaveLength(3);
});

test('move the crosshair by clicking a plane, without fetching again', async () => {
  const getValue = vi.spyOn(MockApi.prototype, 'getValue');
  await renderApp('/view_hints/ortho');
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [1, 2, 3]');
  function fetches(): number {
    return getValue.mock.calls.filter(
      ([dataset]) => dataset.path === '/view_hints/ortho',
    ).length;
  }
  expect(fetches()).toBe(1); // whole volume

  // XY plane (8 rows along y, 10 columns along x): moves x and y, so the other two planes
  await clickPixel(/^XY/u, 5, 7, [8, 10]);
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [1, 5, 7]');
  expect(getReadout()).toHaveTextContent('157');
  expect(getPlane(/^YZ · x = 7$/u)).toBeVisible();
  expect(getPlane(/^XZ · y = 5$/u)).toBeVisible();

  // XZ plane (6 rows along z, 10 columns along x): moves x and z
  await clickPixel(/^XZ/u, 4, 2, [6, 10]);
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [4, 5, 2]');
  expect(getReadout()).toHaveTextContent('452');
  expect(getPlane(/^XY · z = 4$/u)).toBeVisible();

  // YZ plane (8 rows along y, 6 columns along z): moves y and z
  await clickPixel(/^YZ/u, 0, 5, [8, 6]);
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [5, 0, 2]');
  expect(getReadout()).toHaveTextContent('502');

  expect(fetches()).toBe(1);
  getValue.mockRestore();
});

test('set slice indices in the toolbar', async () => {
  const { user } = await renderApp('/view_hints/ortho');

  const zIndex = page.getByRole('slider', { name: 'z index' });
  await expect.element(zIndex).toHaveValue('1');
  (zIndex.element() as HTMLInputElement).focus();
  await user.keyboard('{ArrowRight>3}');
  await expect.element(getPlane(/^XY · z = 4$/u)).toBeVisible();
  expect(getReadout()).toHaveTextContent('423');
});

test('slice leading dimensions of a stack of volumes', async () => {
  const { user } = await renderApp('/view_hints/ortho_stack');

  // Centre of a 6 × 8 × 10 volume
  await expect.element(getReadout()).toHaveTextContent('[i, j, k] = [2, 3, 4]');
  expect(getReadout()).toHaveTextContent('234');

  const slider = page.getByRole('slider', { name: 'D0' });
  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(getReadout()).toHaveTextContent('1234'); // crosshair kept
});

test('offer orthoslices for volumes, never as the preferred vis', async () => {
  await renderApp({
    initialPath: '/arrays/threeD',
    preferredVis: Vis.Orthoslices,
  });
  expect(getVisTabs()).toContain(Vis.Orthoslices);
  expect(getSelectedVisTab()).not.toBe(Vis.Orthoslices);
});
