/* eslint-disable no-bitwise -- GIF flags */
import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

/* Delays of the frames of a GIF (hundredths of a second) */
function parseGif(bytes: Uint8Array): number[] {
  const delays: number[] = [];
  let i = 13;
  if (bytes[10] & 0x80) {
    i += 3 * 2 ** ((bytes[10] & 0x07) + 1); // global color table
  }
  function skipSubBlocks() {
    while (bytes[i] !== 0) {
      i += bytes[i] + 1;
    }
    i += 1;
  }
  while (bytes[i] !== 0x3b) {
    if (bytes[i] === 0x21) {
      if (bytes[i + 1] === 0xf9) {
        delays.push(bytes[i + 4] | (bytes[i + 5] << 8));
      }
      i += 2;
      skipSubBlocks();
    } else {
      expect(bytes[i]).toBe(0x2c); // image
      const flags = bytes[i + 9];
      i += 10 + (flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0) + 1;
      skipSubBlocks();
    }
  }
  return delays;
}

test('record slices as GIF', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  const createSpy = vi.spyOn(URL, 'createObjectURL');
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});

  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  await page.getByRole('button', { name: 'Record GIF' }).click();
  await userEvent.keyboard('{Escape}'); // closing settings doesn't stop recording
  await expect.element(page.getByText(/^Recording \d\/9…$/u)).toBeVisible();
  await expect
    .poll(() => clickSpy.mock.calls.length, { timeout: 20_000 })
    .toBe(1);

  // Back to the slice shown before, and not playing
  await expect
    .element(page.getByRole('slider', { name: 'D0' }))
    .toHaveAttribute('aria-valuenow', '0');
  await expect
    .element(page.getByRole('button', { name: 'Play D0' }))
    .toHaveAttribute('aria-pressed', 'false');

  // Blob of the link (other URLs are of snapshot layers)
  const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
  expect(anchor.download).toBe('threeD.gif');
  const index = createSpy.mock.results.findIndex(
    (result) => result.value === anchor.href,
  );
  const [blob] = createSpy.mock.calls[index];
  expect(blob).toBeInstanceOf(Blob);
  expect((blob as Blob).type).toBe('image/gif');

  const bytes = new Uint8Array(await (blob as Blob).arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe('GIF89a');
  expect(parseGif(bytes)).toStrictEqual(Array.from({ length: 9 }, () => 10)); // 10 slices/s
}, 30_000);

test('cancel recording', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  await page.getByRole('button', { name: 'Record GIF' }).click();
  await expect.element(page.getByText(/^Recording [2-8]\/9…$/u)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel recording' }).click();

  await expect.element(page.getByRole('status')).not.toBeInTheDocument();
  await expect
    .element(page.getByRole('slider', { name: 'D0' }))
    .toHaveAttribute('aria-valuenow', '0');
  expect(clickSpy).not.toHaveBeenCalled();
});

test('resume playback after recording', async () => {
  await renderApp({ initialPath: '/arrays/threeD', preferredVis: Vis.Heatmap });
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  const playBtn = page.getByRole('button', { name: 'Play D0' });

  await playBtn.click();
  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  await page.getByRole('button', { name: 'Record GIF' }).click();
  await expect
    .poll(() => clickSpy.mock.calls.length, { timeout: 20_000 })
    .toBe(1);
  await expect.element(playBtn).toHaveAttribute('aria-pressed', 'true');
});
