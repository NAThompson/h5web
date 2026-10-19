import { renderSvgSnapshot, sampleField } from '@h5web/lib';
import { assertNonNull } from '@h5web/shared/guards';
import { expect, test } from 'vitest';
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

const isWhite = (r: number, g: number, b: number) =>
  r > 250 && g > 250 && b > 250;

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
  await expect.poll(getColorBarLabel).toContain('ω');

  // Streamlines (and their arrowheads) export as vector paths
  const figure = document.querySelector('figure');
  assertNonNull(figure);
  await expect
    .poll(
      () =>
        renderSvgSnapshot(figure as HTMLElement).querySelectorAll(
          'path[fill="none"][stroke-width="1.25"]',
        ).length,
    )
    .toBeGreaterThan(0);
});

test('switch background and update colour-bar label', async () => {
  await renderApp('/vector/vortex');
  await expect.poll(getColorBarLabel).toContain('ω');

  await selectOption('Background', 'Magnitude');
  await expect.poll(getColorBarLabel).toBe('|v| (m/s)');

  await selectOption('Background', 'Divergence');
  await expect.poll(getColorBarLabel).toBe('∇·v');
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
      const svg = renderSvgSnapshot(figure as HTMLElement);
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

  function getTooltip(): string {
    return (
      [...document.querySelectorAll('figure div')].find((el) =>
        el.textContent.includes('|v| ='),
      )?.parentElement?.textContent ?? ''
    );
  }
  await expect.poll(getTooltip).toMatch(/x=/u);
  const text = getTooltip();
  const num = (s: string) => Number(s.replace('−', '-'));
  const [, x, y] = /x=([−\d.]+), y=([−\d.]+)/u.exec(text) ?? [];
  const [, u, v, mag] =
    /\(([−\d.]+), ([−\d.]+)\) \|v\| = ([−\d.]+)/u.exec(text) ?? [];
  // No scales: axes are indices; values are interpolated bilinearly
  const axis = Array.from({ length: 41 }, (_, i) => i);
  const tg = (fn: (x: number, y: number) => number) =>
    axis.flatMap((j) =>
      axis.map((i) => fn((i * Math.PI) / 20, (j * Math.PI) / 20)),
    );
  const field = {
    xs: axis,
    ys: axis,
    u: tg((px, py) => Math.sin(px) * Math.cos(py)),
    v: tg((px, py) => -Math.cos(px) * Math.sin(py)),
  };
  const [eu, ev] = sampleField(field, num(x), num(y));
  expect(num(u)).toBeCloseTo(eu, 3);
  expect(num(v)).toBeCloseTo(ev, 3);
  expect(num(mag)).toBeCloseTo(Math.hypot(eu, ev), 3);
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
  await expect.poll(getColorBarLabel).toBe('|v| (m/s)');
  await expect
    .poll(() => countPixels((r, g, b, a) => a > 0))
    .toBeGreaterThan(5000);

  await selectOption('Style', 'Streamlines');
  await expect
    .poll(() => countPixels((r, g, b, a) => a > 0))
    .toBeGreaterThan(2000);
});
