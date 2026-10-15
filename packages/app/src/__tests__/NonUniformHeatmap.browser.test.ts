import { ContourLines, HeatmapVis, INTERPOLATORS } from '@h5web/lib';
import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { createElement as h } from 'react';
import { LinearFilter } from 'three';
import { expect, test } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import OverlayLayer2D from '../vis-packs/view-hints/OverlayLayer2D';

const ROWS = 4;
const COLS = 8;

// Chebyshev nodes from 2 to 0 (descending, clustered at both ends) and log-spaced ordinates
const XS = Array.from(
  { length: COLS },
  (_, i) => 1 + Math.cos(((2 * i + 1) * Math.PI) / (2 * COLS)),
);
const YS = [1, 2, 4, 8]; // pixel edges at 0.5, 1.5, 3, 6, 10

// One value per pixel: index of the pixel
const CELLS = ndarray(
  Float64Array.from({ length: ROWS * COLS }, (_, i) => i),
  [ROWS, COLS],
);
const { Greys: interpolateGreys } = INTERPOLATORS;
const CELL_COLORS = Array.from({ length: ROWS * COLS }, (_, i) => {
  const color = interpolateGreys(i / (ROWS * COLS - 1)); // `rgb(r, g, b)`
  const [r, g, b] = color.match(/\d+/gu)?.map(Number) ?? [];
  return { r, g, b };
});

// Field that only varies along x: column index
const ALONG_X = ndarray(
  Float64Array.from({ length: ROWS * COLS }, (_, i) => i % COLS),
  [ROWS, COLS],
);

interface Options {
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  keepRatio?: boolean;
  linear?: boolean;
}

async function renderHeatmap(opts: Options = {}) {
  const { flipXAxis, flipYAxis, keepRatio, linear } = opts;
  return render(
    h(
      'div',
      { style: { display: 'flex', width: 800, height: 500 } },
      h(
        HeatmapVis,
        {
          dataArray: CELLS,
          domain: [0, ROWS * COLS - 1],
          colorMap: 'Greys',
          aspect: keepRatio ? 'equal' : 'auto',
          abscissaParams: { value: XS },
          ordinateParams: { value: YS },
          flipXAxis,
          flipYAxis,
          magFilter: linear ? LinearFilter : undefined,
          renderTooltip: (data) =>
            h('span', { 'data-testid': 'tip' }, JSON.stringify(data)),
        },
        h(ContourLines, {
          dataArray: ALONG_X,
          levels: [2.5],
          abscissas: XS,
          ordinates: YS,
          flipXAxis,
          flipYAxis,
          showLabels: true,
        }),
        h(OverlayLayer2D, {
          shapes: {
            points: [
              {
                x: [XS[0], XS[COLS - 1]],
                y: [YS[0], YS[ROWS - 1]],
                fill: 'red',
                size: 3,
                halo: false,
              },
            ],
            lines: [],
            texts: [],
          },
          abscissas: XS,
          ordinates: YS,
          shape: [ROWS, COLS],
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

/* Screen coordinate of a data value along an axis, interpolated from two of its ticks */
function axisToScreen(axis: 'abscissa' | 'ordinate', value: number): number {
  const ticks = [...document.querySelectorAll(`svg[data-type="${axis}"] text`)]
    .map((el) => ({ value: Number(el.textContent), pos: centre(el) }))
    .filter((tick) => Number.isFinite(tick.value));
  const [a, b] = [ticks[0], ticks.at(-1)];
  assertDefined(b);
  const [pa, pb] =
    axis === 'abscissa' ? [a.pos.x, b.pos.x] : [a.pos.y, b.pos.y];
  return pa + ((value - a.value) / (b.value - a.value)) * (pb - pa);
}

function getCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  return canvas as HTMLCanvasElement;
}

/* Index of the cell whose colour is drawn at a screen position (closest colour) */
function cellAt(x: number, y: number): number {
  const canvas = getCanvas();
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0); // drawing buffer is preserved

  const rect = canvas.getBoundingClientRect();
  const px = Math.round(((x - rect.left) * canvas.width) / rect.width);
  const py = Math.round(((y - rect.top) * canvas.height) / rect.height);
  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data;

  const dists = CELL_COLORS.map(
    (c) => (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2,
  );
  return dists.indexOf(Math.min(...dists));
}

async function waitForRender(): Promise<void> {
  await expect
    .poll(() => document.querySelectorAll('figure span').length)
    .toBeGreaterThan(0); // contour labels
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

/* Each pixel is drawn at its axis values */
function expectCellsAtValues(): void {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const x = axisToScreen('abscissa', XS[col]);
      const y = axisToScreen('ordinate', YS[row]);
      expect(cellAt(x, y), `(${col}, ${row})`).toBe(row * COLS + col);
    }
  }
}

test.each([{}, { flipXAxis: true }, { flipYAxis: true, keepRatio: true }])(
  'draw each pixel between the mid-points of its axis values (%o)',
  async (opts) => {
    await renderHeatmap(opts);
    await waitForRender();
    expectCellsAtValues();

    const edgeX = axisToScreen('abscissa', (XS[0] + XS[1]) / 2);
    const edgeY = axisToScreen('ordinate', 1.5);
    const dx = opts.flipXAxis ? -3 : 3; // first column on the left (descending abscissas)
    const dy = opts.flipYAxis ? -3 : 3; // first row at the bottom
    expect(cellAt(edgeX - dx, edgeY + dy)).toBe(0);
    expect(cellAt(edgeX + dx, edgeY + dy)).toBe(1);
    expect(cellAt(edgeX - dx, edgeY - dy)).toBe(COLS);
  },
);

test('sample texel centres at axis values with linear filtering', async () => {
  await renderHeatmap({ linear: true });
  await waitForRender();
  expectCellsAtValues();
});

test('look up the pixel under the pointer from the pixel edges', async () => {
  await renderHeatmap();
  await waitForRender();

  const canvas = getCanvas();
  const rect = canvas.getBoundingClientRect();
  const x = axisToScreen('abscissa', XS[1]);
  const y = axisToScreen('ordinate', YS[2]);
  await userEvent.hover(canvas, {
    position: { x: x - rect.left, y: y - rect.top },
  });

  const tip = document.querySelector('[data-testid="tip"]');
  assertNonNull(tip);
  const data = JSON.parse(tip.textContent) as Record<string, number>;
  expect(data.xi).toBe(1);
  expect(data.yi).toBe(2);
  expect(data.abscissa).toBe(XS[1]); // pixel value, not its edge
  expect(data.ordinate).toBe(YS[2]);
});

test.each([{ flipXAxis: false }, { flipXAxis: true }])(
  'place contours and overlays at their axis values (%o)',
  async (opts) => {
    await renderHeatmap(opts);
    await waitForRender();

    // 2.5 contour lies halfway between the values of columns 2 and 3
    const labels = [...document.querySelectorAll('figure span')].filter(
      (el) => el.textContent === '2.5',
    );
    expect(labels.length).toBeGreaterThan(0);
    const contourX = axisToScreen('abscissa', (XS[2] + XS[3]) / 2);
    for (const label of labels) {
      expect(Math.abs(centre(label).x - contourX)).toBeLessThan(3);
    }

    // Overlay points on the corner samples, drawn in the corner pixels
    const circles = document.querySelectorAll(
      '[data-testid="overlay-points"] circle',
    );
    expect(circles).toHaveLength(2);
    const [first, last] = [...circles].map(centre);
    expect(first.x).toBeCloseTo(axisToScreen('abscissa', XS[0]), -0.5);
    expect(first.y).toBeCloseTo(axisToScreen('ordinate', YS[0]), -0.5);
    expect(last.x).toBeCloseTo(axisToScreen('abscissa', XS[COLS - 1]), -0.5);
    expect(cellAt(first.x, first.y)).toBe(0);
    expect(cellAt(last.x, last.y)).toBe(ROWS * COLS - 1);
  },
);
