import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

// Lower threshold so that confirmed values are small enough to be fetched and visualized
vi.mock(import('../vis-packs/utils'), async (importOriginal) => ({
  ...(await importOriginal()),
  MAX_AUTO_FETCH_SIZE: 100 as never, // bytes (constant has literal type)
}));

test('visualize large dataset value once fetch is confirmed', async () => {
  await renderApp({ initialPath: '/arrays/twoD', waitForLoaders: false });

  await expect
    .element(page.getByText(/too large to be loaded automatically/u))
    .toBeVisible();

  // Rendering the fetched value must not update the guard (cf. `failOnConsole`)
  await page.getByRole('button', { name: 'Load anyway?' }).click();
  await expect.element(page.getByRole('figure')).toBeVisible();
});

test('wait for confirmation before playing through large slices', async () => {
  await renderApp({
    initialPath: '/arrays/threeD',
    preferredVis: Vis.Heatmap,
    waitForLoaders: false,
  });
  await expect
    .element(page.getByText(/too large to be loaded automatically/u))
    .toBeVisible();

  // Playback must not fetch large slices without confirmation, and says so
  const playBtn = page.getByRole('button', { name: 'Play D0' });
  await playBtn.click();
  await expect
    .element(playBtn)
    .toHaveAttribute(
      'title',
      expect.stringContaining('Waiting for confirmation to load next slice'),
    );
  const slider = page.getByRole('slider', { name: 'D0' });
  expect(slider).toHaveValue(0);

  // Once a slice is confirmed, slices of the same size get fetched for playback
  await page.getByRole('button', { name: 'Load anyway?' }).click();
  await expect
    .poll(() => Number(slider.element().getAttribute('aria-valuenow')), {
      timeout: 5000,
    })
    .toBeGreaterThan(0);
  await playBtn.click();
});
