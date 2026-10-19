import {
  exportSnapshot,
  NurbsColorBy,
  type NurbsSurface,
  NurbsSurfaceVis,
  NurbsVis,
} from '@h5web/lib';
import { assertDefined, hasChildren, isGroup } from '@h5web/shared/guards';
import { type Entity } from '@h5web/shared/hdf5-models';
import { type Domain } from '@h5web/shared/vis-models';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { MockApi } from '../providers/mock/mock-api';
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

  try {
    await buffer.mapAsync(0x01); // `READ`
  } catch {
    return 0; // e.g. device lost
  }
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

  expect(getVisTabs()).toEqual(['NURBS', 'Basis']);
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

const NO_WEBGPU_ERROR =
  "NURBS rendering needs WebGPU, which this browser doesn't provide";

function removeWebGpu() {
  Object.defineProperty(navigator, 'gpu', {
    value: undefined,
    configurable: true,
  });
}

test('show error without WebGPU', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  removeWebGpu();
  await renderApp('/nurbs/nonuniform');
  await expect.element(page.getByText(NO_WEBGPU_ERROR)).toBeVisible();
});

test('show error for degree above WebGPU maximum', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/high_degree');
  await expect
    .element(
      page.getByText('Degree 9 is above the maximum of 7 for WebGPU rendering'),
    )
    .toBeVisible();
});

test('toggle control points', async () => {
  const { user } = await renderApp('/nurbs/nonuniform');

  const btn = page.getByRole('button', { name: 'Control points' });
  await expect.element(btn).toHaveAttribute('aria-pressed', 'false');
  await user.click(btn);
  await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
});

test('toggle control points and axes of 3D NURBS curve', async () => {
  const { user } = await renderApp('/nurbs/helix_3d');
  await expect
    .element(getFigure('helix_3d'))
    .toHaveAttribute('data-renderer', 'webgpu');

  const btn = page.getByRole('button', { name: 'Control points' });
  await expect.element(btn).toHaveAttribute('aria-pressed', 'false');
  await user.click(btn);
  await expect.element(btn).toHaveAttribute('aria-pressed', 'true');

  await user.click(page.getByRole('button', { name: 'Axes' }));
  await expect
    .element(page.getByRole('button', { name: 'Grid' }))
    .toBeDisabled();
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

test('visualize periodic 3D NURBS curve with WebGPU, coloured by parameter', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/trefoil_3d');

  const figure = getFigure('trefoil_3d');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(1000);
  await expect.element(figure.getByText('𝑢', { exact: true })).toBeVisible(); // colour bar

  // WebGPU canvas over the WebGL one (axes, control points)
  const canvases = figure.element().querySelectorAll('canvas');
  expect(canvases).toHaveLength(2);
  expect(canvases[1]).toHaveAttribute('data-drawn');
});

test('draw WebGPU 3D curve again for snapshots', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/trefoil_3d');

  const figure = getFigure('trefoil_3d');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();

  const count = frames.length;
  await exportSnapshot(figure.element() as HTMLElement);
  expect(frames.length).toBeGreaterThan(count);
  await expect(frames.at(-1)).resolves.toBeGreaterThan(1000);
});

test('visualize NURBS surface with WebGPU', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/torus');
  expect(getVisTabs()).toEqual(['NURBS', 'Basis']);

  const figure = getFigure('torus');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);

  // WebGPU canvas under the WebGL one (axes, control net)
  const canvases = figure.element().querySelectorAll('canvas');
  expect(canvases).toHaveLength(2);
  expect(canvases[0]).toHaveAttribute('data-drawn');
});

test('draw WebGPU surface again for snapshots', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/sphere');

  const figure = getFigure('sphere');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();

  const count = frames.length;
  await exportSnapshot(figure.element() as HTMLElement);
  expect(frames.length).toBeGreaterThan(count);
  await expect(frames.at(-1)).resolves.toBeGreaterThan(10_000);
});

test('toggle control net, knot lines and axes of NURBS surface', async () => {
  const { user } = await renderApp('/nurbs/wave');
  await expect
    .element(getFigure('wave'))
    .toHaveAttribute('data-renderer', 'webgpu');

  const netBtn = page.getByRole('button', { name: 'Control net' });
  const knotsBtn = page.getByRole('button', { name: 'Knot lines' });
  await user.click(netBtn);
  await user.click(knotsBtn);
  await expect.element(netBtn).toHaveAttribute('aria-pressed', 'true');
  await expect.element(knotsBtn).toHaveAttribute('aria-pressed', 'true');

  const axesBtn = page.getByRole('button', { name: 'Axes' });
  await expect.element(axesBtn).toHaveAttribute('aria-pressed', 'true');
  await user.click(axesBtn);
  await expect
    .element(page.getByRole('button', { name: 'Grid' }))
    .toBeDisabled();
});

test('show error for NURBS surface without WebGPU', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  removeWebGpu();
  await renderApp('/nurbs/saddle');
  await expect.element(page.getByText(NO_WEBGPU_ERROR)).toBeVisible();
});

test('show error for invalid knots of NURBS surface', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/bad_surface_knots');

  await expect
    .element(
      page.getByText(
        'Invalid NURBS surface: Expected 11 knots along v (control points + degree + 1), got 2',
      ),
    )
    .toBeVisible();
});

test('visualize B-spline curve and surface', async () => {
  const { selectExplorerNode } = await renderApp('/nurbs/bspline_curve');
  expect(getVisTabs()).toEqual(['NURBS', 'Basis']);
  expect(getSelectedVisTab()).toBe('NURBS');
  await expect
    .element(getFigure('bspline_curve'))
    .toHaveAttribute('data-renderer');

  await selectExplorerNode('bspline_surface');
  await expect
    .element(getFigure('bspline_surface'))
    .toHaveAttribute('data-renderer');
});

test('show error for weights of B-spline', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/bad_bspline');

  await expect
    .element(
      page.getByText('B-splines have no weights; use H5WEB_geometry = "nurbs"'),
    )
    .toBeVisible();
});

test('plot basis functions with knots and their multiplicities', async () => {
  const { user } = await renderApp('/nurbs/nonuniform');
  await user.click(page.getByRole('tab', { name: 'Basis' }));

  const figure = getFigure('nonuniform');
  await expect.element(figure).toBeVisible();
  await expect.element(figure.getByText('𝑁₇', { exact: true })).toBeVisible(); // legend: 8 points
  expect(
    page.getByRole('button', { name: 'Rational' }),
  ).not.toBeInTheDocument(); // no weights

  // Knots 0, 0.5, 2 and 3, repeated 4, 1, 3 and 4 times
  const knots = page.getByTestId('knots');
  expect(knots.element().querySelectorAll('line')).toHaveLength(4);
  expect(
    [...knots.element().querySelectorAll('text')].map((el) => el.textContent),
  ).toEqual(['×4', '×3', '×4']);

  await user.click(page.getByRole('button', { name: 'Sum' }));
  await expect.element(figure.getByText('Σ', { exact: true })).toBeVisible();
});

test('toggle rational basis functions of weighted curve', async () => {
  const { user } = await renderApp('/nurbs/circle');
  await user.click(page.getByRole('tab', { name: 'Basis' }));

  const figure = getFigure('circle');
  const btn = page.getByRole('button', { name: 'Rational' });
  await expect.element(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.element(figure.getByText('𝑅₀', { exact: true })).toBeVisible();

  await user.click(btn);
  await expect.element(figure.getByText('𝑁₀', { exact: true })).toBeVisible();
});

test('plot basis functions of surface along u and v', async () => {
  const { user } = await renderApp('/nurbs/bspline_surface');
  await user.click(page.getByRole('tab', { name: 'Basis' }));

  const figure = getFigure('bspline_surface');
  await expect.element(figure.getByText('𝑁₅', { exact: true })).toBeVisible(); // 6 along u
  expect(figure.getByText('𝑁₆', { exact: true })).not.toBeInTheDocument();

  await user.click(page.getByRole('radio', { name: '𝑣' }));
  await expect.element(figure.getByText('𝑁₆', { exact: true })).toBeVisible(); // 7 along v
});

test('visualize multi-patch NURBS surface (teapot) with WebGPU', async () => {
  const { frames } = captureGpuFrames();
  const { user } = await renderApp('/nurbs/teapot');
  expect(getVisTabs()).toEqual(['NURBS']); // no basis of a single patch

  const figure = getFigure('teapot');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);
  expect(figure.element().querySelectorAll('canvas')).toHaveLength(2); // one WebGPU canvas

  await user.click(page.getByRole('button', { name: 'Knot lines' })); // patch boundaries
  await user.click(page.getByRole('button', { name: 'Control net' }));
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);
});

test('visualize lone patch of multi-patch surface', async () => {
  const { frames } = captureGpuFrames();
  await renderApp('/nurbs/teapot/lid_1');
  expect(getVisTabs()).toEqual(['NURBS', 'Basis']); // B-spline of the teapot group

  const figure = getFigure('lid_1');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect
    .poll(() => figure.element().querySelector('canvas[data-drawn]'))
    .not.toBeNull();
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);
});

test('show error naming invalid patch of multi-patch surface', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/bad_patches');

  await expect
    .element(
      page.getByText('Patch broken: Knots along u must be non-decreasing'),
    )
    .toBeVisible();
});

/* Bounds of the colour bar of a figure, as numbers */
function getColorBarBounds(figure: ReturnType<typeof getFigure>): number[] {
  return ['Min', 'Max'].map((bound) => {
    const elem = figure.element().querySelector(`[aria-label^="${bound}:"]`);
    return Number(elem?.textContent.replace('−', '-'));
  });
}

test('colour NURBS surface by Gaussian curvature, symmetric around 0', async () => {
  const { frames } = captureGpuFrames();
  const { user } = await renderApp('/nurbs/torus');
  const figure = getFigure('torus');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');
  await expect.element(figure.getByText('𝑧', { exact: true })).toBeVisible(); // colour bar

  await user.click(page.getByRole('combobox', { name: 'Height 𝑧' }));
  expect(
    page
      .getByRole('option')
      .elements()
      .map((el) => el.textContent),
  ).toEqual(['Height 𝑧', '|∇𝑧|', 'Gaussian curvature 𝐾', 'Mean curvature 𝐻']);
  await user.click(page.getByRole('option', { name: 'Gaussian curvature 𝐾' }));

  await expect
    .element(figure.getByText('Gaussian curvature 𝐾', { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole('combobox', { name: /RdBu/u }))
    .toBeVisible(); // diverging
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);

  // K = cos v / r (R + r cos v), from −4/3 (inside) to 0.8 (outside) for R = 2, r = 0.5
  await expect.poll(() => getColorBarBounds(figure)[1]).toBeGreaterThan(1.2);
  const [min, max] = getColorBarBounds(figure);
  expect(max).toBeLessThanOrEqual(1.34);
  expect(min).toBe(-max);
});

test('colour sphere by mean curvature: H = ±1', async () => {
  const { user } = await renderApp('/nurbs/sphere');
  const figure = getFigure('sphere');
  await user.click(page.getByRole('combobox', { name: 'Height 𝑧' }));
  await user.click(page.getByRole('option', { name: 'Mean curvature 𝐻' }));

  await expect
    .element(figure.getByText('Mean curvature 𝐻', { exact: true }))
    .toBeVisible();
  await expect
    .poll(() => getColorBarBounds(figure).map((val) => Math.abs(val)))
    .toEqual([1, 1]);
});

test('colour teapot by stored field and its gradient', async () => {
  const { frames } = captureGpuFrames();
  const { user } = await renderApp('/nurbs/teapot');
  const figure = getFigure('teapot');
  await expect.element(figure).toHaveAttribute('data-renderer', 'webgpu');

  await user.click(page.getByRole('combobox', { name: 'Height 𝑧' }));
  await user.click(page.getByRole('option', { name: 'temperature (K)' }));
  await expect
    .element(figure.getByText('temperature (K)', { exact: true }))
    .toBeVisible();
  await expect.poll(() => getColorBarBounds(figure)[0]).toBeGreaterThan(293);
  expect(getColorBarBounds(figure)[1]).toBeCloseTo(370, 3); // bottom
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(10_000);

  await user.click(page.getByRole('combobox', { name: 'temperature (K)' }));
  await user.click(
    page.getByRole('option', { name: '|∇temperature| (K per unit length)' }),
  );
  await expect
    .element(
      figure.getByText('|∇temperature| (K per unit length)', { exact: true }),
    )
    .toBeVisible();
  await expect.poll(() => getColorBarBounds(figure)[1]).toBeGreaterThan(1);
});

test('colour NURBS surface at the root of the file by stored field', async () => {
  // Lone patch with fields as the whole file, its group being the root `/`
  const patchPath = '/nurbs/teapot/lid_1';
  function reroot<T extends Entity>(entity: T): T {
    const path = entity.path.slice(patchPath.length) || '/';
    return isGroup(entity) && hasChildren(entity)
      ? { ...entity, path, children: entity.children.map(reroot) }
      : { ...entity, path };
  }
  const { getEntity } = MockApi.prototype; // eslint-disable-line vitest/unbound-method -- called with `this` below
  vi.spyOn(MockApi.prototype, 'getEntity').mockImplementation(
    async function mock(this: MockApi, path) {
      const entity = reroot(
        await getEntity.call(
          this,
          path === '/' ? patchPath : `${patchPath}${path}`,
        ),
      );
      if (path !== '/') {
        return entity;
      }
      const { attributes } = await getEntity.call(this, '/nurbs/teapot');
      return { ...entity, attributes: [...entity.attributes, ...attributes] }; // `H5WEB_geometry`
    },
  );

  const { user } = await renderApp('/');
  await user.click(page.getByRole('combobox', { name: 'Height 𝑧' }));
  await expect
    .element(page.getByRole('option', { name: 'temperature (K)' }))
    .toBeVisible();
});

test('show error naming patch without a field of the others', async () => {
  mockConsoleMethod('error'); // error boundary logs errors
  await renderApp('/nurbs/missing_field');

  await expect
    .element(
      page.getByText(
        'Patch rim_1: Expected field "temperature" in "fields" group',
      ),
    )
    .toBeVisible();
});

// Knots that `f32` can't tell apart as such (its spacing is 64 around 10⁹)
const FAR = 1e9;
const FAR_KNOTS = [FAR, FAR, FAR + 2, FAR + 2];

async function renderInBox(elem: ReturnType<typeof createElement>) {
  return render(createElement('div', { style: { height: '600px' } }, elem));
}

test('draw NURBS curve with knots far from 0', async () => {
  const { frames } = captureGpuFrames();
  await renderInBox(
    createElement(NurbsVis, {
      title: 'far',
      curve: {
        degree: 1,
        dims: 2,
        points: [0, 0, 1, 1],
        weights: [1, 1],
        knots: FAR_KNOTS,
      },
    }),
  );

  await expect
    .element(getFigure('far'))
    .toHaveAttribute('data-renderer', 'webgpu');
  await expect.poll(async () => frames.at(-1)).toBeGreaterThan(500);
});

test('colour NURBS surface with knots far from 0', async () => {
  const onDataDomainChange = vi.fn<(domain: Domain) => void>();
  const surface: NurbsSurface = {
    degrees: [1, 1],
    shape: [2, 2],
    points: [0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1], // z = x y
    weights: [1, 1, 1, 1],
    knots: [FAR_KNOTS, FAR_KNOTS],
    fields: [[0, 0, 0, 1]], // x y
  };
  const { rerender } = await renderInBox(
    createElement(NurbsSurfaceVis, {
      surfaces: [surface],
      colorBy: NurbsColorBy.Field,
      onDataDomainChange,
    }),
  );
  await expect.poll(() => onDataDomainChange.mock.lastCall).toEqual([[0, 1]]);

  // K = −1 / (1 + x² + y²)², from −1 to −1/9 (domain symmetric around 0)
  await rerender(
    createElement(
      'div',
      { style: { height: '600px' } },
      createElement(NurbsSurfaceVis, {
        surfaces: [surface],
        colorBy: NurbsColorBy.GaussianCurvature,
        onDataDomainChange,
      }),
    ),
  );
  await expect
    .poll(() => onDataDomainChange.mock.lastCall?.[0][1])
    .toBeGreaterThan(0.9);
  expect(onDataDomainChange.mock.lastCall?.[0][1]).toBeLessThanOrEqual(1);
});
