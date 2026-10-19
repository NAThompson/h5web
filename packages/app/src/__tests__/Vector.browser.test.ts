import { renderSvgSnapshot, sampleField } from '@h5web/lib';
import { assertNonNull } from '@h5web/shared/guards';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  getSelectedVisTab,
  getVisTabs,
  mockConsoleMethod,
  renderApp,
} from '../test-utils';

function getCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  return canvas as HTMLCanvasElement;
}

/* Pixels of the canvas (drawing buffer is preserved) matching a predicate */
function countPixels(
  match: (r: number, g: number, b: number, a: number) => boolean,
): number {
  const canvas = getCanvas();
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    count += match(data[i], data[i + 1], data[i + 2], data[i + 3]) ? 1 : 0;
  }
  return count;
}

async function selectOption(label: string, option: string): Promise<void> {
  await userEvent.click(
    page.getByRole('combobox', { name: new RegExp(`^${label}`, 'u') }),
  );
  await userEvent.click(
    page.getByRole('option', { name: option, exact: true }),
  );
}

// Leave room for the whole toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

function isWhite(r: number, g: number, b: number): boolean {
  return r > 250 && g > 250 && b > 250;
}

function getTooltip(): string {
  return (
    [...document.querySelectorAll('figure div')].find((el) =>
      el.textContent.includes('|𝐯| ='),
    )?.parentElement?.textContent ?? ''
  );
}

function parseNumber(s: string): number {
  return Number(s.replace('−', '-'));
}

/* Distinct fills of closed paths (arrows) in the SVG export */
function countArrowColors(figure: HTMLElement): number {
  const svg = renderSvgSnapshot(figure);
  return new Set(
    [...svg.querySelectorAll('path[fill]')]
      .filter((p) => (p.getAttribute('d')?.match(/Z/gu) ?? []).length > 0)
      .map((p) => p.getAttribute('fill')),
  ).size;
}

function getColorBarLabel(): string | null | undefined {
  return document.querySelector('figure [class*="colorBar"] [class*="label"]')
    ?.textContent;
}

test('visualize dataset with `H5WEB_vis = "vector"`', async () => {
  await renderApp('/vector/vortex');

  expect(getVisTabs()[0]).toBe('Vector');
  expect(getSelectedVisTab()).toBe('Vector');
  await expect
    .element(page.getByRole('figure', { name: 'velocity' }))
    .toBeVisible();

  // Hinted style and background: streamlines over the vorticity
  await expect
    .element(page.getByRole('combobox', { name: /^Style/u }))
    .toHaveTextContent('Streamlines');
  await expect.poll(getColorBarLabel).toContain('𝜔');

  // Streamlines (and their arrowheads) export as vector paths
  const figure = document.querySelector('figure');
  assertNonNull(figure);
  await expect
    .poll(
      () =>
        renderSvgSnapshot(figure).querySelectorAll(
          'path[fill="none"][stroke-width="1.25"]',
        ).length,
    )
    .toBeGreaterThan(0);
});

test('switch background and update colour-bar label', async () => {
  await renderApp('/vector/vortex');
  await expect.poll(getColorBarLabel).toContain('𝜔');

  await selectOption('Background', 'Magnitude');
  await expect.poll(getColorBarLabel).toBe('|𝐯| (m/s)');

  await selectOption('Background', 'Divergence');
  await expect.poll(getColorBarLabel).toBe('∇ · 𝐯');
});

test('draw arrows on the GPU and export them as SVG paths', async () => {
  await renderApp('/vector/dipole');
  await expect
    .element(page.getByRole('combobox', { name: /^Style/u }))
    .toHaveTextContent('Arrows');

  // White arrows over the colour map (Viridis has no white)
  await expect.poll(() => countPixels(isWhite)).toBeGreaterThan(200);

  const figure = document.querySelector('figure');
  assertNonNull(figure);
  await expect
    .poll(() => {
      const svg = renderSvgSnapshot(figure);
      return [...svg.querySelectorAll('path[fill="white"]')].map(
        (p) => (p.getAttribute('d')?.match(/Z/gu) ?? []).length,
      )[0];
    })
    .toBeGreaterThan(50); // one closed polygon per arrow
});

test('show the field under the pointer in the tooltip', async () => {
  await renderApp('/vector/components');
  expect(getVisTabs()).toEqual(['Vector']);

  // Taylor–Green vortex sampled on 41 × 41 points over [0, 2π]², interpolated between them
  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  await userEvent.hover(canvas, {
    position: { x: rect.width * 0.3, y: rect.height * 0.6 },
  });

  await expect.poll(getTooltip).toMatch(/𝑥=/u);
  const text = getTooltip();
  const [, x, y] = /𝑥=([\d.−]+), 𝑦=([\d.−]+)/u.exec(text) ?? [];
  const [, u, v, mag] =
    /\(([\d.−]+), ([\d.−]+)\) \|𝐯\| = ([\d.−]+)/u.exec(text) ?? [];
  // No scales: axes are indices; values are interpolated bilinearly
  const axis = Array.from({ length: 41 }, (_, i) => i);
  function tg(fn: (x: number, y: number) => number): number[] {
    return axis.flatMap((j) =>
      axis.map((i) => fn((i * Math.PI) / 20, (j * Math.PI) / 20)),
    );
  }
  const field = {
    xs: axis,
    ys: axis,
    u: tg((px, py) => Math.sin(px) * Math.cos(py)),
    v: tg((px, py) => -Math.cos(px) * Math.sin(py)),
  };
  const [eu, ev] = sampleField(field, parseNumber(x), parseNumber(y));
  expect(parseNumber(u)).toBeCloseTo(eu, 3);
  expect(parseNumber(v)).toBeCloseTo(ev, 3);
  expect(parseNumber(mag)).toBeCloseTo(Math.hypot(eu, ev), 3);
  expect(text).toMatch(/pressure = /u);
});

test('use the dataset named by `H5WEB_vector_background` in groups', async () => {
  await renderApp('/vector/components');
  await expect.poll(getColorBarLabel).toBe('pressure');
});

test('report missing components and unusable datasets', async () => {
  const errorSpy = mockConsoleMethod('error'); // error boundary
  const { selectExplorerNode } = await renderApp('/vector/missing_component');
  await expect
    .element(page.getByText('Component "nowhere" not found'))
    .toBeVisible();

  errorSpy.mockRestore();

  await selectExplorerNode('not_a_field');
  await expect
    .element(page.getByRole('note', { name: 'View hint notes' }))
    .toHaveTextContent(
      '"H5WEB_vis" "vector" is not available for this dataset',
    );
});

test('slice time-dependent fields', async () => {
  await renderApp('/vector/time');
  expect(getSelectedVisTab()).toBe('Vector');
  await expect
    .element(page.getByRole('slider', { name: /t/u }).first())
    .toBeVisible();
});

test('show 3D fields as arrows in a box', async () => {
  await renderApp('/vector/abc_flow');
  expect(getSelectedVisTab()).toBe('Vector');
  await expect.poll(getColorBarLabel).toBe('|𝐯| (m/s)');
  await expect
    .poll(() => countPixels((_r, _g, _b, a) => a > 0))
    .toBeGreaterThan(5000);

  await selectOption('Style', 'Streamlines');
  await expect
    .poll(() => countPixels((_r, _g, _b, a) => a > 0))
    .toBeGreaterThan(2000);
});

test('offer no Volume tab for vector datasets', async () => {
  const { selectExplorerNode } = await renderApp('/vector/vortex');
  expect(getVisTabs()).toEqual(['Vector', 'Matrix', 'Line', 'Heatmap']);

  await selectExplorerNode('abc_flow'); // (nz, ny, nx, 3)
  await expect.poll(getSelectedVisTab).toBe('Vector');
  expect(getVisTabs()).not.toContain('Volume');
});

test('apply view hints of vector groups on first open', async () => {
  await renderApp('/vector/components');
  await expect.element(page.getByText('Blues', { exact: true })).toBeVisible();
});

test('show the magnitude if the background dataset is unusable', async () => {
  await renderApp('/vector/bad_background');
  await expect
    .element(page.getByRole('combobox', { name: /^Background/u }))
    .toHaveTextContent('Magnitude');
  await expect.poll(getColorBarLabel).toBe('|𝐯| (m/s)');
  await expect
    .element(page.getByRole('note', { name: 'View hint notes' }))
    .toHaveTextContent('"nowhere" is not a numeric dataset');
});

test('offer no log or sqrt scale for signed backgrounds', async () => {
  await renderApp('/vector/dipole'); // `H5WEB_scale = "log"`
  await expect
    .element(page.getByRole('combobox', { name: 'Log' }))
    .toBeVisible();

  await selectOption('Background', 'Curl');
  await userEvent.click(page.getByRole('combobox', { name: 'Linear' }));
  expect(
    page.getByRole('option', { name: 'Log', exact: true }).elements(),
  ).toHaveLength(0);
  expect(page.getByRole('option', { name: 'Sqrt' }).elements()).toHaveLength(0);
  await userEvent.keyboard('{Escape}');

  await selectOption('Background', 'Magnitude');
  await expect
    .element(page.getByRole('combobox', { name: 'Log' }))
    .toBeVisible();
});

test('colour arrows by magnitude on the scale of the colour bar', async () => {
  await renderApp('/vector/dipole'); // `H5WEB_scale = "log"`
  await selectOption('Background', 'None');
  const figure = document.querySelector('figure');
  assertNonNull(figure);

  // 1/r² field: most arrows at the low end of a linear scale, spread on a log scale
  await expect.poll(() => countArrowColors(figure)).toBeGreaterThan(30);
  const logColors = countArrowColors(figure);
  await userEvent.click(page.getByRole('combobox', { name: 'Log' }));
  await userEvent.click(page.getByRole('option', { name: 'Linear' }));
  await expect.poll(() => countArrowColors(figure)).toBeLessThan(logColors / 2);
});
