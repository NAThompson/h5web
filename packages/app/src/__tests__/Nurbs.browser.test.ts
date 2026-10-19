import { exportSnapshot } from '@h5web/lib';
import { assertDefined } from '@h5web/shared/guards';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import {
  getSelectedVisTab,
  getVisTabs,
  mockConsoleMethod,
  renderApp,
} from '../test-utils';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'gpu'); // remove stub, if any
});

function getFigure(name: string) {
  return page.getByRole('figure', { name });
}

/*
 * Pixels drawn in each frame of WebGPU canvases, and devices of the canvases. Headless Chromium
 * can't copy WebGPU canvases to 2D canvases, so each frame's texture is copied to a buffer right
 * after it is submitted.
 */
function captureGpuFrames() {
  const frames: Promise<number>[] = [];
  const devices: GPUDevice[] = [];
  // eslint-disable-next-line vitest/unbound-method -- called with `this` below
  const { configure, getCurrentTexture } = GPUCanvasContext.prototype;
  const { submit } = GPUQueue.prototype; // eslint-disable-line vitest/unbound-method
  let device: GPUDevice | undefined;
  let texture: GPUTexture | undefined;

  vi.spyOn(GPUCanvasContext.prototype, 'configure').mockImplementation(
    function mock(this: GPUCanvasContext, config) {
      ({ device } = config);
      devices.push(device);
      configure.call(this, { ...config, usage: 0x11 }); // `RENDER_ATTACHMENT | COPY_SRC`
    },
  );
  vi.spyOn(GPUCanvasContext.prototype, 'getCurrentTexture').mockImplementation(
    function mock(this: GPUCanvasContext) {
      texture = getCurrentTexture.call(this);
      return texture;
    },
  );
  vi.spyOn(GPUQueue.prototype, 'submit').mockImplementation(function mock(
    this: GPUQueue,
    buffers,
  ) {
    submit.call(this, buffers);
    if (device && texture) {
      frames.push(countPixels(device, texture, submit));
    }
    texture = undefined;
  });

  return { frames, devices };
}

async function countPixels(
  device: GPUDevice,
  texture: GPUTexture,
  submit: GPUQueue['submit'],
): Promise<number> {
  const { width, height } = texture;
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: 0x09, // `MAP_READ | COPY_DST`
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
    width,
    height,
  ]);
  submit.call(device.queue, [encoder.finish()]);

  await buffer.mapAsync(0x01); // `READ`
  const bytes = new Uint8Array(buffer.getMappedRange());
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      count += bytes[y * bytesPerRow + x * 4 + 3] > 0 ? 1 : 0; // alpha
    }
  }
  buffer.destroy();
  return count;
}

test('visualize NURBS group with WebGPU', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/circle');

  expect(getVisTabs()).toEqual(['NURBS']);
  expect(getSelectedVisTab()).toBe('NURBS');

  // Headless Chromium has a software adapter with `--enable-unsafe-webgpu` (cf. Vitest config)
  const figure = getFigure('circle');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();

  const counts = await Promise.all(frames);
  expect(counts.at(-1)).toBeGreaterThan(1000);
});

test('draw WebGPU canvas again for snapshots', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/circle');

  const figure = getFigure('circle');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();

  // Copied right after it is drawn again (its texture is gone once on screen)
  const count = frames.length;
  await exportSnapshot(figure.element() as HTMLElement);
  expect(frames.length).toBeGreaterThan(count);
  await expect(frames.at(-1)).resolves.toBeGreaterThan(1000);
});

test('request WebGPU device again if lost', async () => {
  const { frames, devices } = captureGpuFrames();
  await renderApp('/nurbs/circle');
  await expect.poll(() => devices.length).toBeGreaterThan(0);

  const lostDevice = devices.at(-1);
  assertDefined(lostDevice);
  lostDevice.destroy();

  await expect.poll(() => devices.at(-1)).not.toBe(lostDevice);
  await expect
    .element(getFigure('circle'))
    .toHaveAttribute('data-renderer', 'webgpu');
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(1000);
});

test('fall back to WebGL without WebGPU', async () => {
  Object.defineProperty(navigator, 'gpu', {
    value: undefined,
    configurable: true,
  });
  await renderApp('/nurbs/nonuniform');

  const figure = getFigure('nonuniform');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgl');
  expect(figure.element().querySelectorAll('canvas')).toHaveLength(1); // WebGL canvas only
});

test('toggle control points', async () => {
  const { user } = await renderApp('/nurbs/nonuniform');

  const btn = page.getByRole('button', { name: 'Control points' });
  await expect.element(btn).toHaveAttribute('aria-pressed', 'false');
  await user.click(btn);
  await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
});

test('visualize 3D NURBS curve', async () => {
  await renderApp('/nurbs/helix_3d');
  await expect.element(getFigure('helix_3d')).toBeVisible();
  expect(
    page.getByRole('button', { name: 'Control points' }),
  ).not.toBeInTheDocument(); // not drawn in 3D
});

test('show error for invalid knots', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/bad_knots');

  await expect
    .element(
      page.getByText('Invalid NURBS curve: Knots must be non-decreasing'),
    )
    .toBeVisible();
});
