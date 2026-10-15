import { HeatmapVis, type VisScaleType } from '@h5web/lib';
import { assertNonNull } from '@h5web/shared/guards';
import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { createElement as h } from 'react';
import { expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

const COLS = 8;

/* Brightness of the pixel at a fraction of the canvas width, mid-height */
function brightnessAt(fx: number): number {
  const canvas = document.querySelector<HTMLCanvasElement>('figure canvas');
  assertNonNull(canvas);
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0); // drawing buffer is preserved
  const [r, g, b] = ctx.getImageData(
    Math.round(fx * canvas.width),
    Math.round(canvas.height / 2),
    1,
    1,
  ).data;
  return r + g + b;
}

// Values far below the symlog constant (or float32's `1 + x` precision), cf. `GLSL_LOG1P`
test.each<[number, VisScaleType]>([
  [2.6e-13, [ScaleType.SymLog, 1e-3]],
  [4e-34, [ScaleType.SymLog, 1e-3]],
  [4e-34, ScaleType.Linear],
])('render tiny values ±%s on a %s scale', async (max, scaleType) => {
  const values = Float64Array.from(
    { length: COLS },
    (_, i) => max * ((2 * i) / (COLS - 1) - 1),
  );
  await render(
    h(
      'div',
      { style: { display: 'flex', width: 800, height: 500 } },
      h(HeatmapVis, {
        dataArray: ndarray(values, [1, COLS]),
        domain: [-max, max],
        scaleType,
        colorMap: 'Greys',
        aspect: 'auto',
      }),
    ),
  );

  // Greys: black at the lower end of the domain, white at the upper end
  await expect.poll(() => brightnessAt(1 - 0.5 / COLS)).toBeGreaterThan(700);
  expect(brightnessAt(0.5 / COLS)).toBeLessThan(60);
  expect(brightnessAt(3.5 / COLS)).toBeLessThan(brightnessAt(4.5 / COLS));
});
