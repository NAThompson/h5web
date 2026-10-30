import { HeatmapVis, INTERPOLATORS } from '@h5web/lib';
import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { createElement as h } from 'react';
import { expect, onTestFinished, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { getDimMappingBtn, getSelectedVisTab, renderApp } from '../test-utils';
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

test('keep the ratio only of axes of the same unit, on linear scales', async () => {
  await page.viewport(2560, 1080); // "Keep ratio" not in the "More controls" menu
  onTestFinished(async () => page.viewport(1920, 1080));
  const { user } = await renderApp('/axis_hints/ratio');

  const keepRatioBtn = page.getByRole('button', { name: 'Keep ratio' });
  await expect.element(keepRatioBtn).toHaveAttribute('aria-pressed', 'true'); // r2 vs r1 (bohr)

  await user.click(getDimMappingBtn('x', 'angle')); // rad vs bohr
  await expect.element(keepRatioBtn).toHaveAttribute('aria-pressed', 'false');

  await user.click(getDimMappingBtn('x', 'r2'));
  await expect.element(keepRatioBtn).toHaveAttribute('aria-pressed', 'true');

  await user.click(getDimMappingBtn('x', 'rho')); // log
  await expect.element(keepRatioBtn).toHaveAttribute('aria-pressed', 'false');
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

test('label the indices of a string-valued scale on the axis', async () => {
  const { user } = await renderApp('/axis_hints/jacobian');

  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual([
      'mass',
      'length',
      'stiffness',
      'damping',
      'temperature',
      'pressure',
      'viscosity',
      'input', // axis label
    ]);

  // Tooltip: label of the hovered index, not the index
  const canvas = page.getByRole('figure').element().querySelector('canvas');
  assertNonNull(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  await userEvent.hover(canvas, { position: { x: width / 2, y: height / 2 } });
  await expect.element(page.getByText(/input=damping,/u)).toBeVisible();

  // Long labels truncated on the ordinate, to fit beside it
  await user.click(getDimMappingBtn('x', 'component'));
  await expect
    .poll(() => getTickLabels('ordinate'))
    .toEqual(expect.arrayContaining(['stiffness', 'temperatu…']));
});

test('do not keep the ratio of a string-valued scale', async () => {
  await page.viewport(2560, 1080); // "Keep ratio" not in the "More controls" menu
  onTestFinished(async () => page.viewport(1920, 1080));
  await renderApp('/axis_hints/jacobian');

  const keepRatioBtn = page.getByRole('button', { name: 'Keep ratio' });
  await expect.element(keepRatioBtn).toHaveAttribute('aria-pressed', 'false');
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

  // Too many to fetch
  await selectExplorerNode('too_many_labels');
  await expect
    .element(getNotes())
    .toHaveTextContent(
      'ignored "H5WEB_slice_labels": "many_labels" has more than 10000 strings',
    );
});

test('play the hinted dimension by default, past empty images', async () => {
  const { user } = await renderApp('/axis_hints/playback_dim');

  // Opened past the empty images along `step`, not along D0 (all empty at step 0)
  await expect
    .element(page.getByRole('slider', { name: 'step' }))
    .toHaveValue(2);
  expect(page.getByRole('slider', { name: 'D0' })).toHaveValue(0);

  const play = page.getByRole('button', { name: 'Play D1' });
  expect(play).toHaveAttribute('title', 'Default playback dimension');
  expect(page.getByRole('button', { name: 'Play D0' })).not.toHaveAttribute(
    'title',
  );

  // Hint ignored while the dimension is on an axis
  await user.click(getDimMappingBtn('y', 'step'));
  await expect
    .element(page.getByRole('slider', { name: 'step' }))
    .not.toBeInTheDocument();
  expect(page.getByRole('button', { name: 'Play D0' })).not.toHaveAttribute(
    'title',
  );
});

function countColorBarPowers(): number {
  return [...document.querySelectorAll('[class*="colorBar"] svg text')].filter(
    (tick) => /10⁻\S+$/u.test(tick.textContent), // e.g. `−10⁻⁷`
  ).length;
}

test('colour volumes on the scale of the hint', async () => {
  const { selectExplorerNode } = await renderApp('/axis_hints/volume_log');
  await page.viewport(2560, 1080); // whole volume toolbar

  expect(getSelectedVisTab()).toBe(Vis.Volume);
  await expect
    .element(page.getByRole('combobox', { name: 'Log' }))
    .toBeVisible();
  await expect.poll(countColorBarPowers).toBeGreaterThanOrEqual(3);

  // Symlog with `H5WEB_symlog_threshold`: powers of 10 down to the threshold
  await selectExplorerNode('volume_symlog');
  await expect
    .element(page.getByRole('combobox', { name: 'SymLog' }))
    .toBeVisible();
  await expect.poll(countColorBarPowers).toBeGreaterThanOrEqual(4);

  // Logarithms (`H5WEB_value_transform`): powers, not exponents
  await selectExplorerNode('volume_exp10');
  await expect.poll(countColorBarPowers).toBeGreaterThanOrEqual(3);
});

/* Pixels of the volume's colour at the top of the colour map (e.g. maxima in MIP mode) */
function countBrightPixels(): number {
  const canvas = document.querySelector<HTMLCanvasElement>('figure canvas');
  assertNonNull(canvas);
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0);
  const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 200 && data[i + 1] > 150) {
      count += 1;
    }
  }
  return count;
}

test('place the voxels of non-uniform volume axes at their coordinates', async () => {
  const { user, selectExplorerNode } = await renderApp(
    '/axis_hints/volume_uniform',
  );
  await page.viewport(2560, 1080); // whole volume toolbar
  await user.click(page.getByRole('radio', { name: 'MIP' }));
  await expect.poll(countBrightPixels).toBeGreaterThan(1000);
  const uniform = countBrightPixels();

  // x < 1: half the voxels, but a thin slab of the axis' extent (0.01 to 100)
  await selectExplorerNode('volume_nonuniform');
  await expect
    .poll(() => {
      const count = countBrightPixels();
      return count > 0 && count < uniform / 2; // a wall, seen at an angle
    })
    .toBe(true);
});
