import { HeatmapVis, INTERPOLATORS } from '@h5web/lib';
import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { createElement as h } from 'react';
import { expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { getSelectedVisTab, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';
import OverlayLayer2D from '../vis-packs/view-hints/OverlayLayer2D';

function getNotes() {
  return page.getByRole('note', { name: 'View hint notes' });
}

function getTickLabels(type: 'abscissa' | 'ordinate'): string[] {
  return [...document.querySelectorAll(`svg[data-type="${type}"] text`)]
    .map((text) => text.textContent)
    .filter((label) => label !== '');
}

// Unevenly spaced values on a log x axis, evenly spaced rows; one value per cell (its index)
const XS = [1, 2, 5, 10, 20, 50, 100];
const COLS = XS.length;
const ROWS = 3;
const { Greys: interpolateGreys } = INTERPOLATORS;
const CELL_COLORS = Array.from({ length: ROWS * COLS }, (_, i) => {
  const color = interpolateGreys(i / (ROWS * COLS - 1));
  const [r, g, b] = color.match(/\d+/gu)?.map(Number) ?? [];
  return { r, g, b };
});

async function renderLogHeatmap(xs: number[], point?: number) {
  const cells = ndarray(
    Float64Array.from({ length: ROWS * xs.length }, (_, i) => i),
    [ROWS, xs.length],
  );
  return render(
    h(
      'div',
      { style: { display: 'flex', width: 800, height: 500 } },
      h(
        HeatmapVis,
        {
          dataArray: cells,
          domain: [0, ROWS * COLS - 1],
          colorMap: 'Greys',
          aspect: 'auto',
          abscissaParams: { value: xs, scaleType: ScaleType.Log },
        },
        point !== undefined &&
          h(OverlayLayer2D, {
            shapes: {
              points: [
                { x: [point], y: [0], fill: 'red', size: 3, halo: false },
              ],
              lines: [],
              texts: [],
            },
            abscissas: xs,
            ordinates: undefined,
            shape: [ROWS, xs.length],
            colorParams: {
              domain: [0, 1],
              scaleType: ScaleType.Linear,
              colorMap: 'Greys',
              invertColorMap: false,
            },
          }),
      ),
    ),
  );
}

function centre(el: Element): { x: number; y: number } {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { x: left + width / 2, y: top + height / 2 };
}

/* Screen x of a value on the log x axis, interpolated from its decade ticks */
function logToScreen(value: number): number {
  const ticks = [...document.querySelectorAll('svg[data-type="abscissa"] text')]
    .map((el) => ({ value: Number(el.textContent), x: centre(el).x }))
    .filter((tick) => Number.isFinite(tick.value) && tick.value > 0);
  const [a, b] = [ticks[0], ticks.at(-1)];
  assertDefined(b);
  const t = Math.log10(value / a.value) / Math.log10(b.value / a.value);
  return a.x + t * (b.x - a.x);
}

/* Index of the cell whose colour is drawn at a screen position (closest colour) */
function cellAt(x: number, y: number): number {
  const canvas = document.querySelector<HTMLCanvasElement>('figure canvas');
  assertNonNull(canvas);
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0);
  const rect = canvas.getBoundingClientRect();
  const px = Math.round(((x - rect.left) * canvas.width) / rect.width);
  const py = Math.round(((y - rect.top) * canvas.height) / rect.height);
  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;
  const dists = CELL_COLORS.map(
    (c) => (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2,
  );
  return dists.indexOf(Math.min(...dists));
}

async function waitForFrame(): Promise<void> {
  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['1', '10', '100']));
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function getRowY(): number {
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  const { top, height } = canvas.getBoundingClientRect();
  return top + height / 2; // middle row
}

test('draw heatmap pixels at their values on a log axis', async () => {
  await renderLogHeatmap(XS);
  await waitForFrame();

  const y = getRowY();
  XS.forEach((x, col) => {
    expect(cellAt(logToScreen(x), y), `column ${col}`).toBe(COLS + col);
  });
  // Edges at geometric mid-points: √(1 × 2) ≈ 1.41
  expect(cellAt(logToScreen(1.3), y)).toBe(COLS);
  expect(cellAt(logToScreen(1.55), y)).toBe(COLS + 1);
});

test('draw log-spaced values as evenly spaced pixels on a log axis', async () => {
  await renderLogHeatmap([1, 10, 100, 1000], 10);
  await waitForFrame();

  // Values are pixel starts, as on linear axes: pixel 1 spans 10 to 100
  const y = getRowY();
  expect(cellAt(logToScreen(9), y)).toBe(4);
  expect(cellAt(logToScreen(11), y)).toBe(5);
  expect(cellAt(logToScreen(99), y)).toBe(5);

  // Overlay sample at 10: centre of its pixel on screen, √(10 × 100)
  const point = document.querySelector('[data-testid="overlay-points"] circle');
  assertNonNull(point);
  expect(centre(point).x).toBeCloseTo(logToScreen(Math.sqrt(1000)), 0);
});

test('put heatmap axes on the scales of their dimension scales', async () => {
  await renderApp('/axis_hints/log_heatmap');

  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['0.01', '0.1', '1', '10', '100']));
  // Symlog axis with `H5WEB_symlog_threshold` 10
  expect(getTickLabels('ordinate')).toEqual(
    expect.arrayContaining(['−100', '0', '100']),
  );
  expect(getNotes()).not.toBeInTheDocument();
});

test('put a line plot on the log axis of its dimension scale', async () => {
  await renderApp('/axis_hints/log_line');

  expect(getSelectedVisTab()).toBe(Vis.Line);
  await expect
    .element(page.getByRole('combobox', { name: 'X Log' }))
    .toBeVisible();
  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['0.01', '1', '100']));
});

test('keep axes linear when their scale is invalid or cannot show their values', async () => {
  await renderApp('/axis_hints/log_fallback');

  await expect
    .element(getNotes())
    .toHaveTextContent(
      `"H5WEB_axis_scale" "log" can't show the values of "zero_based"`,
    );
  expect(getNotes()).toHaveTextContent(
    'bad_scale: ignored invalid "H5WEB_axis_scale"',
  );
  expect(getTickLabels('abscissa')).toEqual(
    expect.arrayContaining(['0', '2', '4']),
  );
});

test('label slices with the strings named by a dimension scale', async () => {
  const { user } = await renderApp('/axis_hints/packages');

  const slider = page.getByRole('slider', { name: 'package_index' });
  const label = page.getByTestId('D0 slice label');
  await expect.element(label).toHaveTextContent('ψ10'); // variable-length strings
  expect(label).toHaveAttribute('title', '0: ψ10\n1: ψ20\n2: ψ21\n3: ψ30');
  expect(slider).toHaveAttribute('aria-valuetext', 'ψ10');

  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(label).toHaveTextContent('ψ20');
});

test('label curves with the values of a string-valued scale', async () => {
  await renderApp('/axis_hints/blend');

  const legend = page.getByRole('figure').getByRole('list');
  await expect.element(legend).toBeVisible();
  expect(
    legend
      .getByRole('listitem')
      .elements()
      .map((li) => li.textContent),
  ).toEqual(['0 deg', '30 deg', '60 deg']); // fixed-length strings, without padding
  expect(page.getByTestId('D0 slice label')).toHaveTextContent('0 deg');
});

test('label slices of the dimension named by the dataset', async () => {
  const { selectExplorerNode } = await renderApp('/axis_hints/own_labels');

  await expect
    .element(page.getByTestId('D0 slice label'))
    .toHaveTextContent('ψ10');

  await selectExplorerNode('bad_labels');
  await expect
    .element(getNotes())
    .toHaveTextContent(
      'ignored "H5WEB_slice_labels": "rho" is not a 1D dataset of strings',
    );
  expect(page.getByTestId('D0 slice label')).not.toBeInTheDocument();
});
