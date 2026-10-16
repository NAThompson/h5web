import {
  exportPdfSnapshot,
  findVisElement,
  renderSvgSnapshot,
} from '@h5web/lib';
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

function getPanelElement(title: string): HTMLElement {
  const panel = page
    .getByRole('region', { name: title, exact: true })
    .element();
  return panel as HTMLElement;
}

test('export panels with their titles, shared colour bars and vector lines', async () => {
  await renderApp('/view_hints/panels');
  await expect
    .poll(() => document.querySelectorAll('section figure').length)
    .toBe(4);

  // The whole grid, with its colour bars, not the shared canvas
  const root = findVisElement(getPanelElement('ψ'));
  assertDefined(root);
  expect(root).toHaveAttribute('data-snapshot-root');

  // Each heatmap panel as an image in its plot area, the line panel as a path
  const doc = await exportSvgWhen(
    root,
    (svg) =>
      svg.querySelectorAll('image').length === 3 &&
      svg.querySelectorAll('linearGradient').length === 2 && // shared colour bars
      [...svg.querySelectorAll('path[fill="none"]')].some((p) =>
        /^M[\d.]+ [\d.]+L/u.test(p.getAttribute('d') ?? ''),
      ),
  );
  const rootRect = root.getBoundingClientRect();
  const plot = getPanelElement('ψ').querySelector('canvas, [class*="r3fRoot"]');
  assertNonNull(plot);
  const plotRect = plot.getBoundingClientRect();
  const image = doc.querySelector('image');
  assertNonNull(image);
  expect(image.parentElement?.getAttribute('transform')).toBe(
    `translate(${Math.round((plotRect.x - rootRect.x) * 100) / 100} ${
      Math.round((plotRect.y - rootRect.y) * 100) / 100
    })`,
  );

  const texts = getTexts(doc);
  expect(texts).toEqual(expect.arrayContaining(['ψ', 'profile']));
}, 30_000); // panels drawn and snapshotted (slow in the full suite)

test('export all panels of a scrolled grid', async () => {
  const { user } = await renderApp('/view_hints/multiples');
  const createSpy = vi.spyOn(URL, 'createObjectURL');
  const clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});

  const root = document.querySelector<HTMLElement>('[data-snapshot-root]');
  assertNonNull(root);
  root.style.cssText = 'flex: none; width: 480px; height: 240px;'; // panels out of view
  const { cssText } = root.style;
  const scroller = root.querySelector('[data-panel-scroller]');
  assertNonNull(scroller);
  await expect
    .poll(() => scroller.scrollHeight > scroller.clientHeight + 100)
    .toBe(true);

  await user.click(page.getByRole('button', { name: 'Toggle sidebar' }));

  // Whole grid (with its padding) and colour bar after it, not over its last column
  const gridRight =
    Math.max(
      ...[...root.querySelectorAll('section')].map(
        (section) => section.getBoundingClientRect().right,
      ),
    ) - root.getBoundingClientRect().left;
  const colorBars = root.querySelector('[class*="_colorBars_"]');
  assertNonNull(colorBars);
  const minWidth =
    gridRight +
    scroller.scrollLeft +
    8 + // padding of the grid
    colorBars.getBoundingClientRect().width;
  expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth); // scrolls

  await user.click(page.getByRole('button', { name: 'Snapshot' }));
  await user.click(page.getByRole('button', { name: 'Save as SVG' }));
  await expect
    .poll(() => createSpy.mock.calls.length, { timeout: 20_000 })
    .toBe(1);

  const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
  expect(anchor.download).toBe('multiples.svg'); // named after the dataset
  const blob = createSpy.mock.calls[0][0] as Blob;
  const doc = new DOMParser().parseFromString(
    await blob.text(),
    'image/svg+xml',
  );
  expect(Number(doc.documentElement.getAttribute('height'))).toBeGreaterThan(
    root.getBoundingClientRect().height + 100,
  );
  expect(
    Number(doc.documentElement.getAttribute('width')),
  ).toBeGreaterThanOrEqual(minWidth - 0.5);
  expect(doc.querySelectorAll('image')).toHaveLength(9); // 12 panels, 3 blank (NaN)
  expect(getTexts(doc)).toEqual(
    expect.arrayContaining(['k = 0', 'k = 3', 'p = 0', 'p = 2']),
  );
  expect(root.style.cssText).toBe(cssText); // restored
}, 30_000); // panels drawn and snapshotted (slow in the full suite)
