import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { delay } from '../providers/mock/utils';
import { mockDelay, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

afterEach(() => {
  vi.useRealTimers();
});

function getSlider() {
  return page.getByRole('slider', { name: 'D0' });
}

function getSliderValue(): number {
  return Number(getSlider().element().getAttribute('aria-valuenow'));
}

async function openSettings() {
  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  return page.getByRole('dialog', { name: 'D0 playback settings' });
}

// `threeD` has dims [9, 20, 41], so D0 goes from 0 to 8
test('play and pause slicing', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  expect(getSlider()).toHaveValue(0);

  await page.getByRole('button', { name: 'Play D0' }).click();
  await expect.poll(getSliderValue).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Pause D0' }).click();
  const pausedValue = getSliderValue();
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  expect(getSliderValue()).toBe(pausedValue);
  expect(page.getByRole('button', { name: 'Play D0' })).toBeVisible();
});

test('advance at the requested speed', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  await userEvent.keyboard('{Escape}');

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

  const dialog = await openSettings();
  await dialog.getByLabelText('Slices per second').fill('4'); // 250 ms per slice
  await userEvent.keyboard('{Escape}');

  await page.getByRole('button', { name: 'Play D0' }).click();
  await vi.advanceTimersByTimeAsync(200);
  expect(getSliderValue()).toBe(0);

  await vi.advanceTimersByTimeAsync(100);
  expect(getSliderValue()).toBe(1);

  await vi.advanceTimersByTimeAsync(500);
  expect(getSliderValue()).toBe(3);
});

test('loop, bounce or stop at the end', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });

  const slider = getSlider();
  await slider.click();
  await userEvent.keyboard('{End}');
  await expect.element(slider).toHaveValue(8);

  const dialog = await openSettings();
  await dialog.getByLabelText('Slices per second').fill('60');

  // Loop: from the last slice back to the first
  await page.getByRole('button', { name: 'Play D0' }).click();
  await expect.poll(getSliderValue).toBeLessThan(8);
  await page.getByRole('button', { name: 'Pause D0' }).click();

  // Bounce: from the last slice back down
  await slider.click();
  await userEvent.keyboard('{End}');
  const bounceDialog = await openSettings();
  await bounceDialog.getByLabelText('Bounce').click();
  await bounceDialog.getByLabelText('Slices per second').fill('2'); // slow enough not to miss slice 7
  await page.getByRole('button', { name: 'Play D0' }).click();
  await expect.poll(getSliderValue).toBe(7);
  await page.getByRole('button', { name: 'Pause D0' }).click();

  // Once: restart from the first slice and stop at the last one
  const onceDialog = await openSettings();
  await onceDialog.getByLabelText('Once').click();
  await onceDialog.getByLabelText('Slices per second').fill('60');
  await slider.click();
  await userEvent.keyboard('{End}');
  await page.getByRole('button', { name: 'Play D0' }).click();
  await expect
    .element(page.getByRole('button', { name: 'Play D0' }))
    .toBeVisible();
  expect(getSliderValue()).toBe(8);
});

test('wait for each slice to load before showing it', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Heatmap,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();

  await page.getByRole('button', { name: 'Play D0' }).click();

  // Next slices are being prefetched, but playback can't advance until they're loaded
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  expect(getSliderValue()).toBe(0);
  expect(page.getByTestId(/^Loading/u)).not.toBeInTheDocument(); // keep showing current slice

  resolveAll();
  await expect.poll(getSliderValue).toBeGreaterThan(0);
  await expect.element(page.getByRole('figure')).toBeVisible();

  await page.getByRole('button', { name: 'Pause D0' }).click();

  // Pending prefetches get cancelled
  const signals = vi.mocked(delay).mock.calls.map(([signal]) => signal);
  await expect
    .poll(() => signals.filter((signal) => signal?.aborted).length)
    .toBeGreaterThan(0);
});

test('pause when interacting with slider', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  const slider = getSlider();

  // Toggle playback with Space key on slider
  await slider.click();
  await userEvent.keyboard(' ');
  await expect
    .element(page.getByRole('button', { name: 'Pause D0' }))
    .toBeVisible();

  await userEvent.keyboard('{Home}');
  await expect
    .element(page.getByRole('button', { name: 'Play D0' }))
    .toBeVisible();
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  expect(getSliderValue()).toBe(0);

  // Step buttons also pause
  await userEvent.keyboard(' ');
  await expect
    .element(page.getByRole('button', { name: 'Pause D0' }))
    .toBeVisible();
  await (
    await openSettings()
  )
    .getByRole('button', { name: 'Step back' })
    .click();
  await expect
    .element(page.getByRole('button', { name: 'Play D0' }))
    .toBeVisible();
});

test('stop when changing dataset', async () => {
  const { selectExplorerNode } = await renderApp({
    initialPath: '/arrays/threeD',
    preferredVis: Vis.Heatmap,
  });

  await page.getByRole('button', { name: 'Play D0' }).click();
  await expect.poll(getSliderValue).toBeGreaterThan(0);

  await selectExplorerNode('threeD_boolean');
  await expect
    .element(page.getByRole('button', { name: 'Play D0' }))
    .toBeVisible();
  const value = getSliderValue();
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  expect(getSliderValue()).toBe(value);
});
