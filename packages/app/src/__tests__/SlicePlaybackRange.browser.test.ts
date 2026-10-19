import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { advanceFakeTimers, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

// Pretend sequences are too large to fetch to get their range
vi.mock(import('../vis-packs/utils'), async (importOriginal) => ({
  ...(await importOriginal()),
  MAX_SEQUENCE_RANGE_SIZE: 1 as never, // bytes (constant has literal type)
}));

function getOrdinateTicks(): string | null | undefined {
  return document.querySelector('svg[data-type="ordinate"]')?.textContent;
}

// `threeD` slices are multiples of the same values, from -1 to 1 times: amplitude falls then rises
test('fall back to range of slices shown so far', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Line });
  const firstTicks = getOrdinateTicks();

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    await page.getByRole('button', { name: 'Play D0' }).click();

    // Slice 4 is all zeros, yet range doesn't shrink
    await advanceFakeTimers(400);
    expect(page.getByRole('slider', { name: 'D0' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    );
    expect(getOrdinateTicks()).toBe(firstTicks);

    await page.getByRole('button', { name: 'Play D0' }).click();
  } finally {
    vi.useRealTimers();
  }

  // Playback settings say so
  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  await expect
    .element(page.getByText(/using range of slices shown so far/u))
    .toBeVisible();
});

// `fourD` slices are `sin(x² / 10)` at integers: their splines overshoot ±1
test('keep ranges seen with splines apart', async () => {
  await renderApp({ initialPath: '/arrays/fourD', preferredVis: Vis.Line });

  async function selectInterpolation(name: string): Promise<void> {
    await page.getByRole('button', { name: 'Aspect' }).click();
    await page.getByRole('radio', { name }).click();
    await page.getByRole('button', { name: 'Aspect' }).click(); // close menu
  }

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  try {
    await page.getByRole('button', { name: 'Play D0' }).click();
    await advanceFakeTimers(400);
    await page.getByRole('button', { name: 'Play D0' }).click();
  } finally {
    vi.useRealTimers();
  }
  const linearTicks = getOrdinateTicks();

  await selectInterpolation('Spline');
  await expect.poll(getOrdinateTicks).not.toBe(linearTicks);

  await selectInterpolation('Linear');
  await expect.poll(getOrdinateTicks).toBe(linearTicks);
});
