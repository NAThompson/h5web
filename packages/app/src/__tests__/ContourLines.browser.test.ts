import { ContourLines, HeatmapVis } from '@h5web/lib';
import { assertDefined } from '@h5web/shared/guards';
import ndarray from 'ndarray';
import { createElement as h } from 'react';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

const ROWS = 20;
const COLS = 10;

// Field that only varies along x (f = column index) or y (f = row index)
const alongX = ndarray(
  Float64Array.from({ length: ROWS * COLS }, (_, i) => i % COLS),
  [ROWS, COLS],
);
const alongY = ndarray(
  Float64Array.from({ length: ROWS * COLS }, (_, i) => Math.floor(i / COLS)),
  [ROWS, COLS],
);

interface Options {
  data: typeof alongX;
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  keepRatio?: boolean;
}

async function renderContours(opts: Options) {
  const { data, flipXAxis, flipYAxis, keepRatio } = opts;
  return render(
    h(
      'div',
      { style: { display: 'flex', width: 800, height: 500 } },
      h(
        HeatmapVis,
        {
          dataArray: data,
          domain: [0, Math.max(ROWS, COLS)],
          aspect: keepRatio ? 'equal' : 'auto',
          flipXAxis,
          flipYAxis,
        },
        h(ContourLines, {
          dataArray: data,
          levels: [2.5],
          flipXAxis,
          flipYAxis,
          showLabels: true,
        }),
      ),
    ),
  );
}

function centre(el: Element): { x: number; y: number } {
  const { left, top, width, height } = el.getBoundingClientRect();
  return { x: left + width / 2, y: top + height / 2 };
}

function getLabels(): Element[] {
  return [...document.querySelectorAll('figure span')].filter(
    (el) => el.textContent === '2.5',
  );
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

/* The 2.5 contour lies halfway between the centres of pixels 2 and 3, i.e. on pixel edge 3 */
test.each([
  { flipXAxis: false, keepRatio: false },
  { flipXAxis: true, keepRatio: false },
  { flipXAxis: false, keepRatio: true },
  { flipXAxis: true, keepRatio: true },
])(
  'place vertical contours at their abscissa (%o)',
  async ({ flipXAxis, keepRatio }) => {
    await renderContours({ data: alongX, flipXAxis, keepRatio });
    await expect.poll(() => getLabels().length).toBeGreaterThan(0);

    const tickX = axisToScreen('abscissa', 3);
    for (const label of getLabels()) {
      expect(Math.abs(centre(label).x - tickX)).toBeLessThan(3);
    }
  },
);

test.each([{ flipYAxis: false }, { flipYAxis: true }])(
  'place horizontal contours at their ordinate (%o)',
  async ({ flipYAxis }) => {
    await renderContours({ data: alongY, flipYAxis, keepRatio: true });
    await expect.poll(() => getLabels().length).toBeGreaterThan(0);

    const tickY = axisToScreen('ordinate', 3);
    for (const label of getLabels()) {
      expect(Math.abs(centre(label).y - tickY)).toBeLessThan(3);
    }
  },
);
