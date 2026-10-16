import { exportPdfSnapshot, renderSvgSnapshot } from '@h5web/lib';
import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';

function getFigure(name?: string): HTMLElement {
  const figure = page.getByRole('figure', name ? { name } : {}).element();
  assertNonNull(figure);
  return figure as HTMLElement;
}

/* SVG snapshot once WebGL objects are drawn, parsed back from its serialization */
async function exportSvgWhen(
  figure: HTMLElement,
  isReady: (svg: Document) => boolean,
): Promise<Document> {
  const result: { doc?: Document } = {};
  await expect
    .poll(() => {
      const svg = renderSvgSnapshot(figure);
      const doc = new DOMParser().parseFromString(
        new XMLSerializer().serializeToString(svg),
        'image/svg+xml',
      );
      result.doc = doc;
      return isReady(doc);
    })
    .toBe(true);
  assertDefined(result.doc);
  return result.doc;
}

function getTexts(doc: Document): string[] {
  return [...doc.querySelectorAll('text')].map((t) => t.textContent);
}

test('export line with error bars and legend as vector SVG', async () => {
  await renderApp('/nexus/spectrum_with_aux');
  const figure = getFigure();
  const { width, height } = figure.getBoundingClientRect();

  // Curves, error bars and caps of the signal and two auxiliaries
  const doc = await exportSvgWhen(
    figure,
    (svg) =>
      svg.querySelectorAll('path[stroke-width="0.5"], path[stroke-width="1"]')
        .length >= 4,
  );
  const root = doc.documentElement;
  expect(root.tagName).toBe('svg');
  expect(Number(root.getAttribute('width'))).toBeCloseTo(width, 0);
  expect(Number(root.getAttribute('height'))).toBeCloseTo(height, 0);

  // No raster image: everything is vector
  expect(doc.querySelector('image')).toBeNull();
  const curves = [...doc.querySelectorAll('path[fill="none"]')].filter((p) =>
    /^M[\d.]+ [\d.]+L/u.test(p.getAttribute('d') ?? ''),
  );
  expect(curves.length).toBeGreaterThanOrEqual(5); // 3 curves + 2 sets of error bars

  // Curve colours of the auxiliaries
  const strokes = curves.map((p) => p.getAttribute('stroke'));
  expect(strokes).toContain('rgb(255,69,0)'); // orangered
  expect(strokes).toContain('rgb(34,139,34)'); // forestgreen

  // Title, axis label, tick labels and legend (only shown in snapshots)
  const texts = getTexts(doc);
  expect(texts.filter((t) => t === 'twoD (arb. units)')).toHaveLength(3); // title, y label, legend
  expect(texts).toContain('X (nm)');
  expect(texts).toContain('−20');
  expect(texts).toContain('800');
  expect(texts).toContain('secondary');

  // Text has explicit positions, not baselines that not all renderers support
  expect(doc.querySelector('[dominant-baseline], [dy]')).toBeNull();
});

test('export heatmap as image with vector axes and colour bar', async () => {
  await renderApp('/nexus/NXdata');
  const figure = getFigure('NeXus 2D');
  const canvas = figure.querySelector('canvas');
  assertNonNull(canvas);

  const doc = await exportSvgWhen(
    figure,
    (svg) => !!svg.querySelector('image'),
  );

  // Heatmap as PNG image over the canvas area, with nearest-neighbour scaling
  const image = doc.querySelector('image');
  assertNonNull(image);
  expect(image.getAttribute('href')).toMatch(/^data:image\/png;base64,/u);
  expect(Number(image.getAttribute('width'))).toBeCloseTo(
    canvas.getBoundingClientRect().width,
    0,
  );
  expect(image.getAttribute('style')).toContain('pixelated');

  // Colour bar gradient
  const stops = doc.querySelectorAll('linearGradient stop');
  expect(stops.length).toBeGreaterThan(10);

  const texts = getTexts(doc);
  expect(texts).toContain('NeXus 2D');
  expect(texts).toContain('20'); // ordinate tick
  expect(texts).toContain('40'); // abscissa tick
  expect(texts).toContain('−9.5e+1'); // colour bar bound
  expect(doc.querySelectorAll('line').length).toBeGreaterThan(10); // ticks and grid
});

test('export PDF of the same size', async () => {
  await renderApp('/nexus/NXdata');
  const figure = getFigure('NeXus 2D');
  await exportSvgWhen(figure, (svg) => !!svg.querySelector('image'));

  const blob = await exportPdfSnapshot(figure);
  const text = await blob.text();
  expect(text.startsWith('%PDF-')).toBe(true);

  const { width, height } = figure.getBoundingClientRect();
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/u.exec(text);
  assertNonNull(box);
  expect(Number(box[1])).toBeCloseTo(width * 0.75, 0);
  expect(Number(box[2])).toBeCloseTo(height * 0.75, 0);
  expect(text).toContain('DejaVuSans'); // embedded font
});

test('download SVG and PDF from snapshot menu', async () => {
  const { user } = await renderApp('/nexus/NXdata');
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});

  await user.click(page.getByRole('button', { name: 'Toggle sidebar' }));
  await user.click(page.getByRole('button', { name: 'Snapshot' }));
  await user.click(page.getByRole('button', { name: 'Save as SVG' }));
  await user.click(page.getByRole('button', { name: 'Snapshot' }));
  await user.click(page.getByRole('button', { name: 'Save as PDF' }));

  await expect.poll(() => clickSpy.mock.calls.length).toBe(2);
  expect(
    clickSpy.mock.contexts.map((a) => (a as HTMLAnchorElement).download),
  ).toEqual(['NeXus_2D.svg', 'NeXus_2D.pdf']);
});
