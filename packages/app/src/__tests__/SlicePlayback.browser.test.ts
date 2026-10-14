import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { delay } from '../providers/mock/utils';
import {
  advanceFakeTimers as advance,
  mockConsoleMethod,
  mockDelay,
  renderApp,
} from '../test-utils';
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

function getPlayBtn() {
  return page.getByRole('button', { name: 'Play D0' });
}

function isPlaying(): boolean {
  return getPlayBtn().element().getAttribute('aria-pressed') === 'true';
}

async function openSettings() {
  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  return page.getByRole('dialog', { name: 'D0 playback settings' });
}

async function setSettings(opts: { fps?: number; option?: string }) {
  const dialog = await openSettings();
  if (opts.option) {
    await dialog.getByLabelText(opts.option).click();
  }
  if (opts.fps) {
    await dialog.getByLabelText('Speed').fill(opts.fps.toString());
  }
  await userEvent.keyboard('{Escape}');
}

/* Fake timers (and clock) used by playback, so tests don't depend on machine load */
function installFakeTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}

// `threeD` has dims [9, 20, 41], so D0 goes from 0 to 8
test('play and pause slicing', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  expect(getSlider()).toHaveValue(0);
  installFakeTimers();

  await getPlayBtn().click(); // 10 slices/s by default
  expect(isPlaying()).toBe(true);
  await advance(350);
  expect(getSliderValue()).toBe(3);

  await getPlayBtn().click();
  expect(isPlaying()).toBe(false);
  await advance(1000);
  expect(getSliderValue()).toBe(3);
});

test('advance at the requested speed', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  await setSettings({ fps: 4 }); // 250 ms per slice
  installFakeTimers();

  await getPlayBtn().click();
  await advance(200);
  expect(getSliderValue()).toBe(0);

  await advance(100);
  expect(getSliderValue()).toBe(1);

  await advance(500);
  expect(getSliderValue()).toBe(3);
});

async function playFromLastSlice(option: string) {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });

  const slider = getSlider();
  await slider.click();
  await userEvent.keyboard('{End}');
  await expect.element(slider).toHaveValue(8);

  await setSettings({ option, fps: 10 });
  installFakeTimers();
  await advance(500); // let debounced slicing through

  await getPlayBtn().click();
}

test('loop back to the first slice', async () => {
  await playFromLastSlice('Loop');
  await advance(100);
  expect(getSliderValue()).toBe(0);
  await advance(100);
  expect(getSliderValue()).toBe(1);
});

test('bounce back from the last slice', async () => {
  await playFromLastSlice('Bounce');
  await advance(100);
  expect(getSliderValue()).toBe(7);
  await advance(100);
  expect(getSliderValue()).toBe(6);
});

test('play once from the first slice to the last', async () => {
  await playFromLastSlice('Once');
  await advance(100);
  expect(getSliderValue()).toBe(0); // restart from first slice

  await advance(800);
  expect(getSliderValue()).toBe(8);
  await advance(200); // stop once last slice has been shown for its duration
  expect(isPlaying()).toBe(false);

  await advance(500);
  expect(getSliderValue()).toBe(8);
});

test('keep speed typed during playback', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  installFakeTimers();
  await getPlayBtn().click();
  await advance(250);

  // Type new speed while playback re-renders the slider
  const dialog = await openSettings();
  const speedInput = dialog.getByLabelText('Speed');
  await speedInput.click();
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}4{Enter}');
  await advance(500);
  expect(speedInput).toHaveValue(4);

  // Speed is applied and remembered
  const value = getSliderValue();
  await advance(1000);
  expect(getSliderValue() - value).toBe(4);
  expect(speedInput).toHaveValue(4);
  expect(localStorage.getItem('h5web:playback')).toContain('"fps":4');
});

function getOrdinateTicks(): string | null | undefined {
  return document.querySelector('svg[data-type="ordinate"]')?.textContent;
}

// `threeD` slices are multiples of the same values, from -1 to 1 times: amplitude falls then rises
test('keep range of whole sequence during playback', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Line });
  installFakeTimers();

  await getPlayBtn().click();
  await advance(100);

  const ticks = new Set<string | null | undefined>();
  for (let i = 0; i < 9; i += 1) {
    await advance(100); // eslint-disable-line no-await-in-loop -- sequential frames
    ticks.add(getOrdinateTicks());
  }
  expect(ticks.size).toBe(1);

  // Range is kept after pausing, until slicing another dimension
  await getPlayBtn().click();
  await advance(100);
  expect(ticks.has(getOrdinateTicks())).toBe(true);
});

test('keep range of sequence when switching range setting back and forth', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Line });
  installFakeTimers();

  await getPlayBtn().click();
  await advance(300);
  await getPlayBtn().click(); // pause on slice with smaller amplitude
  await advance(100);
  const sequenceTicks = getOrdinateTicks();

  await setSettings({ option: 'Range: Each slice' });
  await advance(100);
  await setSettings({ option: 'Range: Whole sequence' });
  await advance(100);
  expect(getOrdinateTicks()).toBe(sequenceTicks);

  await getPlayBtn().click();
  const ticks = new Set<string | null | undefined>();
  for (let i = 0; i < 9; i += 1) {
    await advance(100); // eslint-disable-line no-await-in-loop -- sequential frames
    ticks.add(getOrdinateTicks());
  }
  expect([...ticks]).toStrictEqual([sequenceTicks]);
});

test('autoscale each slice during playback when asked', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Line });
  await setSettings({ option: 'Range: Each slice' });
  installFakeTimers();

  await getPlayBtn().click();
  const ticks = new Set<string | null | undefined>();
  for (let i = 0; i < 9; i += 1) {
    await advance(100); // eslint-disable-line no-await-in-loop -- sequential frames
    ticks.add(getOrdinateTicks());
  }
  expect(ticks.size).toBeGreaterThan(1);
});

test('keep playback settings when slider is remounted', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Line });
  await setSettings({ fps: 4, option: 'Bounce' });

  // Map D0 to X axis and back, which unmounts D0's slider
  const xRadioGroup = page.getByLabelText('Dimension as x axis');
  await xRadioGroup.getByRole('radio', { name: 'D0' }).click();
  await xRadioGroup.getByRole('radio', { name: 'D2' }).click();

  const dialog = await openSettings();
  await expect.element(dialog.getByLabelText('Speed')).toHaveValue(4);
  await expect.element(dialog.getByLabelText('Bounce')).toBeChecked();
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
  await setSettings({ option: 'Range: Each slice' }); // don't fetch whole sequence
  installFakeTimers();

  await getPlayBtn().click();

  // Next slices are being prefetched, but playback can't advance until they're loaded
  await advance(1000);
  expect(getSliderValue()).toBe(0);
  expect(page.getByTestId(/^Loading/u)).not.toBeInTheDocument(); // keep showing current slice
  expect(getPlayBtn()).toHaveAttribute('aria-busy', 'true');
  expect(getPlayBtn()).toHaveAttribute(
    'title',
    expect.stringContaining('Waiting for next slice to load'),
  );

  resolveAll();
  await advance(100);
  expect(getSliderValue()).toBe(1);
  expect(getPlayBtn()).toHaveAttribute('aria-busy', 'false');

  // Pending prefetches get cancelled on pause
  await getPlayBtn().click();
  await advance(100);
  const signals = vi.mocked(delay).mock.calls.map(([signal]) => signal);
  expect(signals.filter((signal) => signal?.aborted).length).toBeGreaterThan(0);
});

test('keep fetching slice picked by user during playback', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Heatmap,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();
  installFakeTimers();

  await getPlayBtn().click();
  await advance(200); // slices 1 to 5 are being prefetched
  const fetchCount = vi.mocked(delay).mock.calls.length;

  // Picking slice 1 pauses playback, but its pending fetch is reused, not cancelled
  (getSlider().element() as HTMLElement).focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(isPlaying()).toBe(false);
  await advance(500);
  expect(delay).toHaveBeenCalledTimes(fetchCount);

  resolveAll();
  await advance(100);
  expect(getSliderValue()).toBe(1);
  expect(page.getByRole('figure')).toBeVisible();
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
  await setSettings({ option: 'Skip slices to keep up', fps: 10 });
  installFakeTimers();

  await getPlayBtn().click();

  // Slices take a while to load: by then, they're all late
  await advance(800);
  expect(getSliderValue()).toBe(0);

  // Show latest slice that is due rather than the next one
  resolveAll();
  await advance(50);
  expect(getSliderValue()).toBeGreaterThan(1);
});

test('keep playing when getting range of sequence is cancelled', async () => {
  const resolveAll = mockDelay();
  const { selectExplorerNode } = await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Line,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();
  installFakeTimers();

  await getPlayBtn().click(); // starts getting range of whole sequence
  await advance(100);

  // Selecting dataset again cancels pending fetches, including that of the sequence's range
  await selectExplorerNode('slow_slicing');
  await advance(100);

  for (let i = 0; i < 4; i += 1) {
    resolveAll();
    await advance(200); // eslint-disable-line no-await-in-loop -- sequential ticks
  }
  expect(getSliderValue()).toBeGreaterThan(0);
  expect(isPlaying()).toBe(true);
});

test('show and cancel getting range of sequence', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Line,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();
  installFakeTimers();

  await getPlayBtn().click();
  await advance(500);
  expect(getSliderValue()).toBe(0); // waiting (briefly) for range of sequence
  const notice = page.getByRole('status').filter({
    hasText: 'Getting range of sequence…',
  });
  expect(notice).toBeVisible();

  // Cancel: play with range of slices shown so far
  await notice.getByRole('button', { name: 'Cancel' }).click();
  await advance(100);
  expect(notice).not.toBeInTheDocument();

  for (let i = 0; i < 3; i += 1) {
    resolveAll();
    await advance(200); // eslint-disable-line no-await-in-loop -- sequential ticks
  }
  expect(getSliderValue()).toBeGreaterThan(0);

  const dialog = await openSettings();
  expect(dialog.getByText(/Couldn't get range of sequence/u)).toBeVisible();
});

test('fetch each slice only once when getting range of sequence', async () => {
  const resolveAll = mockDelay();
  await renderApp({
    initialPath: '/resilience/slow_slicing',
    preferredVis: Vis.Heatmap,
    waitForLoaders: false,
  });

  resolveAll(); // first slice
  await expect.element(page.getByRole('figure')).toBeVisible();
  installFakeTimers();

  await getPlayBtn().click();
  await advance(200);
  resolveAll(); // whole sequence and slices prefetched so far
  await advance(100);
  const fetchCount = vi.mocked(delay).mock.calls.length;

  // Other slices come from the whole sequence's values
  await advance(500);
  expect(getSliderValue()).toBeGreaterThan(3);
  expect(delay).toHaveBeenCalledTimes(fetchCount);
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
  installFakeTimers();

  await getPlayBtn().click();
  await advance(200);
  expect(getSliderValue()).toBe(0); // waiting for next slice

  // Slice another dimension: upcoming D0 slices must be fetched for the new D1 index
  const d1Slider = page.getByRole('slider', { name: 'D1' });
  await d1Slider.click();
  await userEvent.keyboard('{ArrowUp}');
  await advance(500); // debounced slicing
  expect(d1Slider).toHaveValue(1);

  // Range of new sequence is fetched
  await advance(400);
  expect(page.getByText('Getting range of sequence…')).toBeVisible();

  for (let i = 0; i < 3; i += 1) {
    resolveAll();
    await advance(100); // eslint-disable-line no-await-in-loop -- sequential ticks
  }
  expect(getSliderValue()).toBeGreaterThan(0);
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

  await setSettings({ fps: 4 });
  await getPlayBtn().click();

  await expect
    .element(page.getByText('Slice failed to load'), { timeout: 5000 })
    .toBeVisible();
  await expect.poll(getSliderValue, { timeout: 5000 }).toBeGreaterThan(1); // playback goes on

  // Failed slices are fetched once per playback, not again on every pass
  const failedCount = callCount;
  await expect.poll(getSliderValue, { timeout: 5000 }).toBeGreaterThan(5);
  expect(callCount).toBeLessThanOrEqual(failedCount + 4);
});

test('pause when interacting with slider', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  const slider = getSlider();

  // Toggle playback with Space key on slider
  await slider.click();
  installFakeTimers();
  await userEvent.keyboard(' ');
  expect(isPlaying()).toBe(true);

  await userEvent.keyboard('{Home}');
  expect(isPlaying()).toBe(false);
  await advance(1000);
  expect(getSliderValue()).toBe(0);

  // Step buttons also pause
  await userEvent.keyboard(' ');
  expect(isPlaying()).toBe(true);
  const dialog = await openSettings();
  await dialog.getByRole('button', { name: 'Step back' }).click();
  expect(isPlaying()).toBe(false);
});

test('stop when changing dataset', async () => {
  const { selectExplorerNode } = await renderApp({
    initialPath: '/arrays/threeD',
    preferredVis: Vis.Heatmap,
  });

  await getPlayBtn().click();
  await expect.poll(getSliderValue, { timeout: 5000 }).toBeGreaterThan(0);

  await selectExplorerNode('threeD_boolean');
  expect(isPlaying()).toBe(false);

  installFakeTimers();
  const value = getSliderValue();
  await advance(1000);
  expect(getSliderValue()).toBe(value);
});
