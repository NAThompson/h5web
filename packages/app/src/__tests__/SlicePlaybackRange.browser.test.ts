import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
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
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => {
      expect(
        page.getByRole('slider', { name: 'D0' }).element(),
      ).toHaveAttribute('aria-valuenow', '4');
    });
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
