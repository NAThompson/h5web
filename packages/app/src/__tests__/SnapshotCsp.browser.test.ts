import { exportSnapshot } from '@h5web/lib';
import { assertNonNull } from '@h5web/shared/guards';
import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';

// Same image policy as the VS Code extension's webview (no `data:` images);
// a CSP can't be lifted, hence this separate test file
const meta = document.createElement('meta');
meta.httpEquiv = 'Content-Security-Policy';
meta.content = 'img-src blob:';
document.head.append(meta);

test('draw axes under a CSP that only allows blob images, in dark mode', async () => {
  document.body.style.filter = 'invert()'; // filter-based dark mode, as in VS Code
  await renderApp('/nexus/spectrum_with_aux');

  const root = page.getByRole('figure').element() as HTMLElement;
  const axis = root.querySelector('svg[data-type="abscissa"]');
  assertNonNull(axis);

  const bitmap = await createImageBitmap(await exportSnapshot(root));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(bitmap, 0, 0);

  const rootRect = root.getBoundingClientRect();
  const rect = axis.getBoundingClientRect();
  const { data } = ctx.getImageData(
    Math.round(rect.x - rootRect.x),
    Math.round(rect.y - rootRect.y),
    Math.round(rect.width),
    Math.round(rect.height),
  );

  // Background is dark and axis ticks and labels are light
  expect(ctx.getImageData(0, 0, 1, 1).data[0]).toBeLessThan(40);
  const lightPixels = data.filter((val, i) => i % 4 === 0 && val > 150);
  expect(lightPixels.length).toBeGreaterThan(100);

  document.body.style.filter = '';
});
