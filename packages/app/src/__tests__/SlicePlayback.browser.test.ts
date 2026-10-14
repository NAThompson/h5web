import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { delay } from '../providers/mock/utils';
import { mockConsoleMethod, mockDelay, renderApp } from '../test-utils';
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

async function playFromLastSlice(mode: string, fps: number) {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });

  const slider = getSlider();
  await slider.click();
  await userEvent.keyboard('{End}');
  await expect.element(slider).toHaveValue(8);

  const dialog = await openSettings();
  await dialog.getByLabelText(mode).click();
  await dialog.getByLabelText('Slices per second').fill(fps.toString());

  await page.getByRole('button', { name: 'Play D0' }).click();
}

test('loop back to the first slice', async () => {
  await playFromLastSlice('Loop', 60);
  await expect.poll(getSliderValue).toBeLessThan(8);
  await page.getByRole('button', { name: 'Pause D0' }).click();
});

test('bounce back from the last slice', async () => {
  await playFromLastSlice('Bounce', 2); // slow enough not to miss slice 7
  await expect.poll(getSliderValue).toBe(7);
  await page.getByRole('button', { name: 'Pause D0' }).click();
});

test('play once from the first slice to the last', async () => {
  await playFromLastSlice('Once', 20);
  await expect.poll(getSliderValue).toBeLessThan(8); // restart from first slice
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

test('skip slices to keep up when data is slow', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Heatmap,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();

  const settings = await openSettings();
  await settings.getByLabelText('Skip slices to keep up').click();
  await settings.getByLabelText('Slices per second').fill('10');
  await page.getByRole('button', { name: 'Play D0' }).click();

  // Slices take a while to load: by then, they're all late
  await new Promise((resolve) => {
    setTimeout(resolve, 800);
  });
  expect(getSliderValue()).toBe(0);

  // Show latest slice that is due rather than the next one
  resolveAll();
  await expect.poll(getSliderValue).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause D0' }).click();
  resolveAll();
});

test('keep playing when slicing another dimension', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Line,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();

  await page.getByRole('button', { name: 'Play D0' }).click();
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
  expect(getSliderValue()).toBe(0); // waiting for next slice

  // Slice another dimension: upcoming D0 slices must be fetched for the new D1 index
  const d1Slider = page.getByRole('slider', { name: 'D1' });
  await d1Slider.click();
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(d1Slider).toHaveValue(1);
  await new Promise((resolve) => {
    setTimeout(resolve, 500); // wait for debounced mapping change
  });

  await expect
    .poll(() => {
      resolveAll();
      return getSliderValue();
    })
    .toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Pause D0' }).click();
  resolveAll();
});

test('show slices that fail to load instead of stalling', async () => {
  mockConsoleMethod('error'); // error boundary logs errors

  let callCount = 0;
  vi.mocked(delay).mockImplementation(async () => {
    callCount += 1;
    if (callCount > 1) {
      throw new Error('Slice failed to load'); // all slices but the first
    }
  });

  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Heatmap,
  });

  const settings = await openSettings();
  await settings.getByLabelText('Slices per second').fill('4');
  await page.getByRole('button', { name: 'Play D0' }).click();

  await expect.element(page.getByText('Slice failed to load')).toBeVisible();
  await expect.poll(getSliderValue).toBeGreaterThan(1); // playback goes on
  await page.getByRole('button', { name: 'Pause D0' }).click();
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
  const dialog = await openSettings();
  await dialog.getByRole('button', { name: 'Step back' }).click();
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
