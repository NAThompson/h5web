import { assertNonNull } from '@h5web/shared/guards';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  advanceFakeTimers as advance,
  getAxis,
  getSelectedVisTab,
  renderApp,
  waitForAllLoaders,
} from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';
import { NxDataVis } from '../vis-packs/nexus/visualizations';

afterEach(() => {
  vi.useRealTimers();
});

function getLinkedMapper() {
  return page.getByRole('group', { name: 'Linked dimension generation' });
}

function getNotes() {
  return page.getByRole('note', { name: 'View hint notes' });
}

function getPointsAttr(name: string): string[] {
  // Disc of each point, drawn over its halo
  const points = document.querySelector('[data-testid="overlay-points"]');
  return [...(points?.querySelectorAll('g > circle:last-child') ?? [])].map(
    (circle) => circle.getAttribute(name) ?? '',
  );
}

function getPointsCx(): string[] {
  return getPointsAttr('cx');
}

test('open the vis declared by the hint, with its settings', async () => {
  await renderApp('/view_hints/landscape');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  await expect
    .element(page.getByRole('combobox', { name: 'SymLog' }))
    .toBeVisible();
  expect(page.getByText('Inferno', { exact: true })).toBeVisible();
});

test('open a line plot with log axis and all slices plotted', async () => {
  await renderApp('/view_hints/line');

  expect(getSelectedVisTab()).toBe(Vis.Line);
  await expect
    .element(page.getByRole('combobox', { name: 'Y SymLog' }))
    .toBeVisible();
  expect(
    page.getByRole('checkbox', { name: 'Plot all D0 slices' }),
  ).toBeChecked();
});

test('open heatmap in 3D', async () => {
  await renderApp('/view_hints/surface');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  await expect
    .element(page.getByRole('button', { name: 'Show as 3D surface' }))
    .toHaveAttribute('aria-pressed', 'true');
  expect(page.getByRole('slider', { name: 'Height scale' })).toHaveValue('0.8');
});

test('take hint over NeXus metadata', async () => {
  await renderApp('/view_hints/nx_line');

  expect(getSelectedVisTab()).toBe(NxDataVis.NxLine); // NX Heatmap otherwise
  await expect
    .element(page.getByRole('combobox', { name: 'Y SymLog' })) // not `SILX_style`'s log
    .toBeVisible();
});

test('merge hints of an NXdata group and its signal', async () => {
  await renderApp('/view_hints/nx_merged');

  expect(getSelectedVisTab()).toBe(NxDataVis.NxLine); // signal's `H5WEB_vis`
  await expect
    .element(page.getByRole('combobox', { name: 'Y SymLog' })) // group's `H5WEB_scale`
    .toBeVisible();
});

test('draw overlays of a hint on an NXdata group', async () => {
  await renderApp('/view_hints/nx_overlay');

  expect(getSelectedVisTab()).toBe(NxDataVis.NxHeatmap);
  await expect.poll(() => getPointsCx()).toHaveLength(1); // path relative to the group
});

test('let user change hinted settings', async () => {
  const { user } = await renderApp('/view_hints/landscape');

  await user.click(page.getByRole('combobox', { name: 'SymLog' }));
  await user.click(page.getByRole('option', { name: 'Linear' }));
  await expect
    .element(page.getByRole('combobox', { name: 'Linear' }))
    .toBeVisible();

  // Slicing the overlays re-renders the vis: the user's choice stays
  await user.click(getLinkedMapper().getByRole('slider'));
  await userEvent.keyboard('{ArrowUp}');
  expect(page.getByRole('combobox', { name: 'Linear' })).toBeVisible();
});

test('open dataset whose hint cannot be read or fetched', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/attr_error');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap); // heuristics
  await expect.element(getNotes()).toHaveTextContent('could not be read');

  await selectExplorerNode('attr_network_error');
  await expect
    .element(page.getByRole('figure', { name: 'attr_network_error' }))
    .toBeVisible();
  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  await expect.element(getNotes()).toHaveTextContent('could not be fetched');
});

test('suggest iso levels without storing them until edited', async () => {
  await page.viewport(2560, 1080); // whole volume toolbar
  const { user, selectExplorerNode } = await renderApp(
    '/view_hints/volume_iso',
  );

  expect(getSelectedVisTab()).toBe(Vis.Volume);
  const isoBtn = page.getByRole('button', { name: 'Isosurfaces', exact: true });
  await user.click(isoBtn);
  await expect
    .element(page.getByRole('textbox', { name: 'Level 2 value' }))
    .toBeVisible();
  await userEvent.keyboard('{Escape}');

  // Hinted levels don't leak to other datasets
  await selectExplorerNode('volume_plain');
  await expect.element(page.getByRole('figure')).toBeVisible();
  await user.click(isoBtn);
  await expect
    .element(page.getByRole('dialog', { name: 'Isosurfaces' }))
    .toBeVisible();
  expect(page.getByRole('listitem')).not.toBeInTheDocument();

  await page.viewport(1920, 1080);
});

test('note overlays not drawn on line views', async () => {
  await renderApp('/view_hints/line_overlays');

  expect(getSelectedVisTab()).toBe(Vis.Line);
  await expect
    .element(getNotes())
    .toHaveTextContent('ignored invalid "H5WEB_scale"');
  expect(getNotes()).toHaveTextContent(
    'overlay "point": drawn on heatmaps only',
  );
});

test('note overlay features not drawn in 3D', async () => {
  const { user } = await renderApp('/view_hints/psi');
  await expect.poll(() => getPointsCx()).toHaveLength(1);
  expect(page.getByText(/not drawn in 3D/u)).not.toBeInTheDocument();

  await user.click(page.getByRole('button', { name: 'Show as 3D surface' }));
  await expect
    .element(getNotes())
    .toHaveTextContent('not drawn in 3D: text, dashes');
});

test('ignore attributes of the wrong type', async () => {
  await renderApp('/view_hints/bad_attrs');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap); // heuristics
  await expect
    .element(getNotes())
    .toHaveTextContent('ignored invalid "H5WEB_vis"');
  expect(getNotes()).toHaveTextContent('ignored invalid "H5WEB_keep_ratio"');
});

test('draw overlays and slice them with an extra linked slider', async () => {
  const { user } = await renderApp('/view_hints/landscape');

  const mapper = getLinkedMapper();
  await expect.element(mapper).toBeVisible();
  const slider = mapper.getByRole('slider');
  expect(slider).toHaveValue(0);

  // 3 points, 2 ellipses and the mean's trail (a single point at first)
  await expect.poll(() => getPointsCx()).toHaveLength(3);
  expect(page.getByTestId('overlay-line').elements()).toHaveLength(3);

  const before = getPointsCx();
  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(slider).toHaveValue(1);
  await expect.poll(() => getPointsCx()).not.toEqual(before);
});

test('play linked slider', async () => {
  await renderApp('/view_hints/landscape');
  await expect.element(getLinkedMapper()).toBeVisible();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

  const slider = getLinkedMapper().getByRole('slider');
  await getLinkedMapper().getByRole('button', { name: 'Play D0' }).click();
  await advance(350); // 10 slices/s by default
  expect(Number(slider.element().getAttribute('aria-valuenow'))).toBe(3);

  // Trail of the mean grows with the generation
  vi.useRealTimers();
  await expect
    .poll(
      () =>
        document
          .querySelectorAll('[data-testid="overlay-line"] path')
          .item(5) // trail of the mean (3rd line, drawn over its halo)
          .getAttribute('d')
          ?.split('L').length,
    )
    .toBeGreaterThan(1);
});

test('slice overlays with the base dataset when it has the linked dimension', async () => {
  const { user } = await renderApp('/view_hints/landscapes');

  expect(getLinkedMapper()).not.toBeInTheDocument(); // no extra slider
  await expect.poll(() => getPointsCx()).toHaveLength(3);

  const before = getPointsCx();
  await user.click(page.getByRole('slider', { name: 'generation' }));
  await userEvent.keyboard('{ArrowUp}');
  await expect.poll(() => getPointsCx()).not.toEqual(before);
});

test('skip overlays too large to fetch and draw large point sets with GL', async () => {
  await renderApp('/view_hints/landscape_large');

  await expect
    .element(getNotes())
    .toHaveTextContent('"huge_points" is too large to fetch for an overlay');

  // Only the single point is drawn in SVG; the 6000 points are drawn in the canvas
  await expect.poll(() => getPointsCx()).toHaveLength(1);
  expect(page.getByTestId('overlay-points').elements()).toHaveLength(1);
});

test('play base slider with overlays prefetched along', async () => {
  await renderApp('/view_hints/landscapes');
  await expect.poll(() => getPointsCx()).toHaveLength(3);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });

  const slider = page.getByRole('slider', { name: 'generation' });
  await page.getByRole('button', { name: 'Play D0' }).click();
  await advance(350); // 10 slices/s by default: overlays don't hold playback up
  expect(Number(slider.element().getAttribute('aria-valuenow'))).toBe(3);
});

test('skip broken overlays without breaking the base vis', async () => {
  await renderApp('/view_hints/landscape_broken');

  await expect
    .element(page.getByRole('figure', { name: 'landscape_broken' }))
    .toBeVisible();
  await expect
    .element(getNotes())
    .toHaveTextContent('overlay "missing": not found');
  expect(getNotes()).toHaveTextContent(
    'overlay "ellipse_broken": "sigma" has unexpected shape [5]',
  );

  // The valid overlay is drawn, with an extra slider found from its scale
  await expect.element(getLinkedMapper()).toBeVisible();
  await expect.poll(() => getPointsCx()).toHaveLength(3);
});

test('draw static overlays in axis values, unclipped on the edges of the domain', async () => {
  await renderApp('/view_hints/psi');

  await expect.poll(() => getPointsCx()).toHaveLength(1); // single point stored as `(2,)`
  expect(getLinkedMapper()).not.toBeInTheDocument();

  const [edge0, edgePi] = [1, 3].map((i) =>
    Number(
      document
        .querySelectorAll('[data-testid="overlay-line"] path')
        .item(i)
        .getAttribute('d')
        ?.slice(1)
        .split(',')[0],
    ),
  );
  const pointX = Number(getPointsCx()[0]);
  expect(edge0).toBeLessThan(pointX); // α = 0 < π/2 < π
  expect(pointX).toBeCloseTo((edge0 + edgePi) / 2, 0);

  const svg = document
    .querySelector('[data-testid="overlays"]')
    ?.closest('svg');
  expect(svg && getComputedStyle(svg).overflow).toBe('visible');
});

test('apply title, auto colour map, legend, texts, inline labels', async () => {
  await renderApp('/view_hints/psi');

  await expect
    .element(page.getByRole('figure', { name: 'ψ(α, θ)' }))
    .toBeVisible();
  await expect.element(page.getByText('RdBu', { exact: true })).toBeVisible(); // data changes sign

  const legend = page.getByRole('list', { name: 'Overlays' });
  await expect.element(legend).toHaveTextContent('e–n'); // inline label not in legend
  expect(legend).not.toHaveTextContent('e–e');
  expect(legend).toHaveTextContent('coalescence'); // `H5WEB_legend_label`

  await expect // overlays drawn once the canvas is measured
    .poll(() =>
      [...document.querySelectorAll('[data-testid="overlays"] text')].map(
        (text) => text.textContent,
      ),
    )
    .toEqual(['e–e', 'θ = 0']);
});

test('share the style of an overlay between the datasets that list it', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/landscape');
  await expect.poll(() => getPointsAttr('r')).toEqual(['6', '6', '6']);

  await selectExplorerNode('landscapes');
  await expect
    .element(page.getByRole('figure', { name: 'landscapes' }))
    .toBeVisible();
  await expect.poll(() => getPointsAttr('r')).toEqual(['6', '6', '6']);
});

test('draw static overlays on every slice, never offering netCDF-4 phony dimensions', async () => {
  const { user } = await renderApp('/view_hints/phony_stack');

  await expect.poll(() => getPointsCx()).toHaveLength(5); // whole dataset, not sliced
  expect(getLinkedMapper()).not.toBeInTheDocument();
  expect(page.getByText(/netCDF dimension/u)).not.toBeInTheDocument();

  const before = getPointsCx();
  await user.click(page.getByRole('slider', { name: 'D0' }));
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(page.getByRole('slider', { name: 'D0' })).toHaveValue(1);
  expect(getPointsCx()).toEqual(before);
  expect(getNotes()).not.toBeInTheDocument();
});

test('give constant data a finite colour domain', async () => {
  await renderApp('/view_hints/constant');

  // One decade around the value (symlog), not `−∞`/`+∞`
  await expect.element(page.getByLabelText('Min: 0.3162')).toBeVisible();
  expect(page.getByLabelText('Max: 3.162')).toBeVisible();
  const ticks = [
    ...document.querySelectorAll('[class*="colorBar"] svg text'),
  ].map((tick) => tick.textContent);
  expect(ticks.length).toBeGreaterThan(0);
  expect(ticks.join(' ')).not.toMatch(/∞|NaN/u);
});

function getTickLabels(type: 'abscissa' | 'ordinate'): string[] {
  return [...document.querySelectorAll(`svg[data-type="${type}"] text`)]
    .map((text) => text.textContent)
    .filter((label) => label !== '');
}

test('put ticks at multiples of π on axes whose dimension scale says so', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/psi_pi');

  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['0', 'π/2', 'π']));
  expect(getTickLabels('ordinate')).toContain('0.5'); // `theta` has no `H5WEB_ticks`
  const abscissa = await getAxis('abscissa');
  expect(abscissa.getByText('alpha_pi', { exact: true })).toBeVisible(); // no "(rad)"

  await selectExplorerNode('line_pi');
  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['0', 'π/2', 'π']));
});

function countColorBarPowers(): number {
  return [...document.querySelectorAll('[class*="colorBar"] svg text')].filter(
    (tick) => /^10⁻\S+$/u.test(tick.textContent),
  ).length;
}

test('set the linear band of symlog scales around 0', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/symlog_heatmap');

  // Powers of 10 down to the threshold, not linear ticks crowded at the top
  await expect.poll(countColorBarPowers).toBeGreaterThanOrEqual(3);

  await selectExplorerNode('symlog_line');
  await expect
    .poll(() => getTickLabels('ordinate'))
    .toEqual(expect.arrayContaining(['10⁻¹⁰', '10⁻⁸', '10⁻⁶']));
});

function getColorBarTicks(): string[] {
  return [...document.querySelectorAll('[class*="colorBar"] svg text')].map(
    (tick) => tick.textContent,
  );
}

test('label logarithms as powers', async () => {
  const { user, selectExplorerNode } = await renderApp(
    '/view_hints/value_transform_line',
  );

  await expect
    .poll(() => getTickLabels('ordinate'))
    .toEqual(expect.arrayContaining(['10⁻¹²', '10⁻⁶', '10⁰']));

  // Colour bar of log2 values; −∞ ignored as NaN, out of the domain
  await selectExplorerNode('value_transform_heatmap');
  await expect
    .poll(getColorBarTicks)
    .toEqual(expect.arrayContaining(['2⁻⁸', '2⁻⁴', '2⁰']));
  expect(page.getByLabelText('Min: 0.003906')).toBeVisible();

  // Real values on other scales too, like the bounds
  await user.click(page.getByRole('combobox', { name: /Linear/u }));
  await user.click(page.getByRole('option', { name: 'SymLog', exact: true }));
  await expect
    .poll(getColorBarTicks)
    .toEqual(expect.arrayContaining(['2⁻⁸', '2⁰']));
  expect(getColorBarTicks()).not.toContain('−8');
});

/* Tooltip of a line plot at sample `index` of `count` (abscissas are indices) */
async function getLineTooltip(index: number, count: number): Promise<string> {
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const span = count - 1;
  await userEvent.hover(canvas, {
    position: {
      x: (width * (index + 0.01 * span)) / (1.02 * span),
      y: height / 2,
    },
  });
  const tooltip = await vi.waitFor(() => {
    const el = document.querySelector('[class*="tooltip"]');
    assertNonNull(el);
    return el;
  });
  return tooltip.textContent;
}

function getLegend(): string[] {
  return [...document.querySelectorAll('figure li')].map(
    (li) => li.textContent,
  );
}

test('draw the running envelope of a line over it, or instead of it', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/envelope_add');

  await expect.poll(getLegend).toEqual(['envelope_add', 'running min']);
  // Index 5 is NaN: the envelope is carried over it
  await expect(getLineTooltip(5, 16)).resolves.toMatch(
    /NaN.*running min = 0\.11555/u,
  );

  // Suffix running max of each curve, instead of the data
  await selectExplorerNode('envelope_replace');
  await expect.poll(getLegend).toEqual(['D0[0]', 'D0[1]']);
  await expect(getLineTooltip(10, 12)).resolves.not.toMatch(/NaN/u); // carried back from k = 11
});

test('draw series of a hint on the same axes, sliced along with the dataset', async () => {
  await renderApp('/view_hints/series_data');

  await expect.poll(getLegend).toEqual(['measured', 'fit e⁻ˣ/⁶', 'bound']);
  const marks = [...document.querySelectorAll<HTMLElement>('figure li > span')];
  expect(marks[0].style.color).toBe('rgb(235, 104, 52)'); // `H5WEB_color` of the dataset
  expect(marks.map((el) => el.dataset.dash)).toEqual([
    undefined,
    undefined,
    'true',
  ]); // `H5WEB_dash` of the bound
  await expect(getLineTooltip(0, 10)).resolves.toMatch(
    /fit.* = 1(?!\d).*bound = 4/u,
  ); // k = 1
  await expect
    .element(getNotes())
    .toHaveTextContent(
      'series "sigma": shape [5] doesn\'t match "series_data"series "missing_series": not found',
    );

  // Collapsed so as not to cover the plot
  const missing = getNotes().getByText(/missing_series/u);
  expect(missing).not.toBeVisible();
  await userEvent.click(getNotes().getByText('ⓘ 2 notes'));
  await expect.element(missing).toBeVisible();

  // Next slice of `k`: the fit follows, the bound stays
  await userEvent.click(page.getByRole('slider', { name: 'k' }));
  await userEvent.keyboard('{ArrowUp}');
  await expect
    .poll(async () => getLineTooltip(0, 10))
    .toMatch(/fit.* = 2(?!\d).*bound = 4/u);
});

function getReferences(): string[] {
  const svg = document.querySelector('[data-testid="references"]');
  return [...(svg?.children ?? [])].map((el) => {
    const { kind } = (el as SVGElement).dataset;
    return `${kind} ${el.getAttribute(kind === 'band' ? 'fill' : 'stroke')}`;
  });
}

test('draw reference lines and bands of line views, with legend entries', async () => {
  await renderApp('/view_hints/line_references');

  await expect
    .poll(getReferences)
    .toEqual(['band #666', 'band green', 'hline crimson', 'vline #666']);
  expect(getLegend()).toEqual([
    'line_references',
    'target',
    'tolerance 10-3', // superscript
    'switch',
  ]);
  expect(getNotes()).toHaveTextContent(
    'overlay "band_no_axis": needs "H5WEB_axis" (x or y)',
  );
});

function getUnplottableMarks(): { fill: string; isBottom: boolean }[] {
  const svg = document.querySelector('[data-testid="unplottable-marks"]');
  const height = svg?.getBoundingClientRect().height ?? 0;
  return [...(svg?.querySelectorAll('polygon') ?? [])].map((mark) => ({
    fill: mark.getAttribute('fill') ?? '',
    isBottom: mark.getAttribute('points')?.endsWith(`,${height}`) ?? false,
  }));
}

test('mark values that cannot be drawn in log scale on the bottom edge', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/line_zeros');

  // Two zeros and a negative value, in `H5WEB_nan_color`; not `NaN`
  const nanColor = 'rgba(217, 217, 217, 1)';
  await expect
    .poll(getUnplottableMarks)
    .toEqual(
      Array.from({ length: 3 }, () => ({ fill: nanColor, isBottom: true })),
    );

  // Logarithm of 0 (−∞), in the colour of the curve
  await selectExplorerNode('value_transform_line');
  await expect.poll(getUnplottableMarks).toHaveLength(1);
  expect(getUnplottableMarks()[0].fill).not.toBe(nanColor);
});

test('put the legend where its box covers the least of the curves', async () => {
  await renderApp('/view_hints/legend_spectrum');

  // Not in the bottom-left quadrant with the fewest points, across the curve along the bottom
  const legend = page.getByRole('list');
  await expect.element(legend).toHaveAttribute('data-corner', 'top-right');
});

function countContourLabels(text: string): number {
  // Contour labels are HTML spans, unlike axis tick labels (SVG text)
  return [...document.querySelectorAll('figure span')].filter(
    (el) => el.textContent === text,
  ).length;
}

test('draw emphasized zero contour alone, and edit emphasized levels', async () => {
  const { user } = await renderApp('/view_hints/nodal');
  await page.viewport(2560, 1080); // whole heatmap toolbar

  await expect.poll(() => countContourLabels('0')).toBeGreaterThan(0);

  await user.click(page.getByRole('button', { name: 'Contours', exact: true }));
  expect(page.getByRole('radio', { name: 'Off' })).toBeChecked(); // no regular contours
  const input = page.getByRole('textbox', { name: 'Emphasized levels' });
  expect(input).toHaveValue('0');

  await user.fill(input, '0.5');
  await user.keyboard('{Enter}');
  await expect.poll(() => countContourLabels('0.5')).toBeGreaterThan(0);
  expect(countContourLabels('0')).toBe(0);

  await page.viewport(1920, 1080);
});

test('contour another dataset on the same grid', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/nodal_amplitude');

  // Amplitude is positive everywhere: zero contours are those of `nodal`
  await expect.poll(() => countContourLabels('0')).toBeGreaterThan(0);
  expect(getNotes()).not.toBeInTheDocument();

  await selectExplorerNode('contour_of_mismatch');
  await expect
    .element(getNotes())
    .toHaveTextContent(/"psi" is not on the same grid/u);
  expect(countContourLabels('0')).toBe(0);
});

/* Click pixel (row, col) of a heatmap whose image fills the canvas (no kept ratio) */
async function clickPixel(row: number, col: number, shape: [number, number]) {
  await waitForAllLoaders(); // heatmap of the current slice shown
  await expect // canvas resized to its area (e.g. after a new slice or the probe panel)
    .poll(() => {
      const area = document.querySelector('figure [class*="canvasArea"]');
      const gl = document.querySelector('figure canvas');
      return area && gl && area.clientHeight - gl.clientHeight;
    })
    .toBe(0);
  const canvas = document.querySelector('figure [class*="canvasArea"]'); // canvas may lag behind resizes
  assertNonNull(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  const [rows, cols] = shape;
  await userEvent.click(page.elementLocator(canvas), {
    position: {
      x: ((col + 0.5) / cols) * width,
      y: (1 - (row + 0.5) / rows) * height, // rows go up
    },
  });
}

function getProbe() {
  return page.getByRole('region', { name: 'Probe' });
}

test('probe a pixel of a stack along the hinted dimension', async () => {
  await page.viewport(2560, 1080); // whole heatmap toolbar
  const { user } = await renderApp('/view_hints/probe_stack');
  await expect
    .element(page.getByRole('button', { name: 'Probe', exact: true }))
    .toHaveAttribute('aria-pressed', 'true'); // hinted

  // Value at (κ, row, col) is 10 (k + 1) + row + col / 10
  await clickPixel(1, 2, [3, 5]);
  await expect.element(getProbe()).toBeVisible();
  expect(getProbe()).toHaveTextContent('Probe at D1 = 1, D2 = 2');
  expect(page.getByLabelText('Probed value')).toHaveTextContent(
    'κ (1/m) = 0.5: 11.2',
  );
  await expect // x axis, once the probe's canvas is measured
    .element(getProbe().getByText('κ (1/m)', { exact: true }))
    .toBeVisible();
  expect(getProbe().getByText('eV', { exact: true })).toBeVisible(); // y axis, from `units`
  const probeTicks = getProbe()
    .element()
    .querySelectorAll('svg[data-type="abscissa"] text');
  expect([...probeTicks].map((tick) => tick.textContent)).toContain('π'); // `H5WEB_ticks` of κ
  expect(document.querySelector('[data-testid="probe-marker"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="probe-slice"]')).not.toBeNull();

  // Current slice moves along the probed line
  await user.click(page.getByRole('slider', { name: 'kappa' }));
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  await expect
    .element(page.getByLabelText('Probed value'))
    .toHaveTextContent('κ (1/m) = 2: 31.2');

  // Another pixel
  await clickPixel(2, 4, [3, 5]);
  await expect
    .element(page.getByLabelText('Probed value'))
    .toHaveTextContent('κ (1/m) = 2: 32.4');

  await user.click(page.getByRole('button', { name: 'Close probe' }));
  expect(getProbe()).not.toBeInTheDocument();

  await page.viewport(1920, 1080);
});

test('probe in the scale of the heatmap, labelled by `long_name`', async () => {
  await page.viewport(2560, 1080);
  await renderApp('/view_hints/probe_log');

  await clickPixel(1, 2, [3, 5]); // values 11.2, 21.2, 31.2, 41.2
  await expect.element(getProbe()).toBeVisible();
  const ordinate = getProbe()
    .element()
    .querySelector('svg[data-type="ordinate"]');
  expect(ordinate?.querySelector('.visx-axis-label')).toHaveTextContent('EK');

  // Log scale: ticks 20, 30, 40 get closer (1.41 times)
  function getTickY(label: string): number {
    const tick = [
      ...(ordinate?.querySelectorAll('.visx-axis-tick') ?? []),
    ].find((elem) => elem.textContent === label);
    return tick?.querySelector('line')?.getBoundingClientRect().y ?? Number.NaN;
  }
  await expect
    .poll(
      () =>
        (getTickY('20') - getTickY('30')) / (getTickY('30') - getTickY('40')),
    )
    .toBeGreaterThan(1.2);

  await page.viewport(1920, 1080);
});

test('probe a stack with the toolbar toggle, without hint', async () => {
  await page.viewport(2560, 1080); // whole heatmap toolbar
  const { user } = await renderApp('/view_hints/landscapes');

  const probeBtn = page.getByRole('button', { name: 'Probe', exact: true });
  await expect.element(probeBtn).toHaveAttribute('aria-pressed', 'false');
  const slider = page.getByRole('slider', { name: 'generation' });
  const labelId = slider.element().getAttribute('aria-labelledby') ?? '';
  expect(document.getElementById(labelId)).toHaveAttribute(
    'title',
    'generation',
  ); // if cut short
  const canvas = document.querySelector<HTMLCanvasElement>('figure canvas');
  assertNonNull(canvas);
  await userEvent.click(page.elementLocator(canvas)); // probe off: nothing
  expect(getProbe()).not.toBeInTheDocument();

  await user.click(probeBtn);
  await userEvent.click(page.elementLocator(canvas));
  await expect.element(getProbe()).toBeVisible();
  expect(getProbe()).toHaveTextContent('generation'); // first sliced dimension
  await expect // integer generations: no fractional ticks
    .poll(() =>
      [
        ...getProbe()
          .element()
          .querySelectorAll('svg[data-type="abscissa"] .visx-axis-tick'),
      ].map((tick) => tick.textContent),
    )
    .toEqual(['0', '1', '2', '3', '4']);

  await page.viewport(1920, 1080);
});

test('show a legend of a few multi-plotted curves', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/line_curves');

  const legend = page.getByRole('figure').getByRole('list');
  await expect.element(legend).toBeVisible();
  expect(
    legend
      .getByRole('listitem')
      .elements()
      .map((li) => li.textContent),
  ).toEqual(['angle: 0.524', 'angle: 1.05', 'angle: 1.57']);

  // All-NaN curves left out
  await selectExplorerNode('line_nan_curves');
  await expect
    .poll(() => legend.getByRole('listitem').elements().length)
    .toBe(2);
  expect(legend.getByRole('listitem').nth(1)).toHaveTextContent('angle: 1.57');

  // Too many curves (20): legend left to snapshots
  await selectExplorerNode('line');
  await expect.element(page.getByTestId('y,x')).toBeVisible();
  await expect
    .element(page.getByRole('figure').getByRole('list'))
    .not.toBeInTheDocument(); // hidden
});

test('label figures, colour bars and axes from CF `long_name` and `units`', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/cf_heatmap');

  // Title from the dataset's `long_name` (`_{K}` as subscript), colour bar from its `units`,
  // axis from the scale's
  await expect.element(page.getByRole('figure', { name: 'EK' })).toBeVisible();
  expect(document.querySelector('figure p')?.innerHTML).toBe(
    '<span data-text="EK">E<sub>K</sub></span>', // plain text for `aria-label`
  );
  expect(page.getByText('hartree', { exact: true })).toBeVisible();
  const abscissa = await getAxis('abscissa');
  expect(abscissa.getByText('αₕ (hyperangle) (rad)')).toBeVisible();

  // Line: `H5WEB_title` as title, `long_name` and `units` on the value axis
  await selectExplorerNode('cf_line');
  await expect
    .element(page.getByRole('figure', { name: 'growth' }))
    .toBeVisible();
  const ordinate = await getAxis('ordinate');
  expect(ordinate.getByText('normGreen (bohr)')).toBeVisible();
  const sup = ordinate
    .element()
    .querySelector('.visx-axis-label [baseline-shift]');
  expect(sup).toHaveTextContent('Green');
  expect(sup).toHaveAttribute('baseline-shift', 'super');

  // CF attributes alone: colour bar labelled, title left to the dataset name
  await selectExplorerNode('cf_plain');
  await expect
    .element(page.getByRole('figure', { name: 'cf_plain' }))
    .toBeVisible();
  expect(page.getByText('Ek (hartree)', { exact: true })).toBeVisible();
});

test('note overlays not drawn when an axis is not named by their columns', async () => {
  await renderApp('/view_hints/stack_overlays');

  await expect
    .element(getNotes())
    .toHaveTextContent(
      'overlay "stack_point": not drawn, "H5WEB_columns" don\'t name the y axis (D1)',
    );
});

test('slice the leading dimensions of a volume', async () => {
  const { user } = await renderApp('/view_hints/volume_stack');

  expect(getSelectedVisTab()).toBe(Vis.Volume);
  await expect
    .element(page.getByRole('figure', { name: 'stack of volumes' }))
    .toBeVisible();
  const slider = page.getByRole('slider', { name: 'D0' });
  await expect.element(slider).toHaveValue(0);
  expect(page.getByRole('slider', { name: 'D1' })).not.toBeInTheDocument();

  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}');
  await expect.element(slider).toHaveValue(1);
  await expect
    .element(page.getByRole('figure', { name: 'stack of volumes' }))
    .toBeVisible();
});

test('note a hinted visualization that is not available', async () => {
  await renderApp('/view_hints/volume_flat');

  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
  await expect
    .element(getNotes())
    .toHaveTextContent(
      '"H5WEB_vis" "volume" is not available for this dataset',
    );
});

/* Colour of the vis canvas at a position given as fractions of its width and height (from top left) */
function getCanvasPixel(fx: number, fy: number): number[] {
  const canvas = document.querySelector<HTMLCanvasElement>('figure canvas');
  assertNonNull(canvas);
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  assertNonNull(ctx);
  ctx.drawImage(canvas, 0, 0);
  const x = Math.floor(fx * canvas.width);
  const y = Math.floor(fy * canvas.height);
  return [...ctx.getImageData(x, y, 1, 1).data];
}

test('colour NaN values with `H5WEB_nan_color`', async () => {
  await renderApp('/view_hints/nan_color');

  // Column 0 is `NaN` (transparent by default)
  await expect
    .poll(() => getCanvasPixel(1 / 12, 1 / 2))
    .toEqual([255, 0, 255, 255]);
  expect(getCanvasPixel(7 / 12, 1 / 2)).not.toEqual([255, 0, 255, 255]);
});

test('colour values beyond the domain with `H5WEB_below_color` / `H5WEB_above_color`', async () => {
  await renderApp('/view_hints/beyond_colors');

  // Columns 1 to 5: -0.1 (below [0, 1]), 0.3, 0.7, 1.1 and 1.5 (above)
  await expect
    .poll(() => getCanvasPixel(3 / 12, 1 / 2))
    .toEqual([0, 0, 255, 255]);
  expect(getCanvasPixel(9 / 12, 1 / 2)).toEqual([255, 0, 0, 255]);
  expect(getCanvasPixel(11 / 12, 1 / 2)).toEqual([255, 0, 0, 255]);
  expect(getCanvasPixel(5 / 12, 1 / 2)).not.toEqual([0, 0, 255, 255]);

  // Triangles at the ends of the colour bar
  expect(page.getByTitle('Below the domain')).toBeVisible();
  expect(page.getByTitle('Above the domain')).toBeVisible();
});

test('open a stack on its first image that is not empty with `H5WEB_playback_skip_empty`', async () => {
  await renderApp('/view_hints/skip_blank_start'); // k < 2 empty
  await expect.element(page.getByRole('slider', { name: 'D0' })).toHaveValue(2);
});

test('skip empty images during playback and steps with `H5WEB_playback_skip_empty`', async () => {
  // (k, p) stack, empty where p > k / 2
  await renderApp('/view_hints/skip_blank');
  const kSlider = page.getByRole('slider', { name: 'D0' });
  const pSlider = page.getByRole('slider', { name: 'D1' });

  await userEvent.click(pSlider);
  await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // p = 2: k < 4 empty
  await expect.element(pSlider).toHaveValue(2);
  await new Promise((resolve) => {
    setTimeout(resolve, 300); // slicing is debounced
  });
  await waitForAllLoaders();

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  await page.getByRole('button', { name: 'Play D0' }).click();
  const seen: number[] = [];
  for (let i = 0; i < 30; i += 1) {
    await advance(100); // eslint-disable-line no-await-in-loop -- 10 slices/s by default
    seen.push(Number(kSlider.element().getAttribute('aria-valuenow')));
  }
  await page.getByRole('button', { name: 'Play D0' }).click();
  vi.useRealTimers();

  // k = 1 to 3 never shown; k = 0 only before it is known to be empty
  expect(new Set(seen)).toEqual(new Set([4, 5]));
  expect(document.querySelectorAll('[data-empty]').length).toBeGreaterThan(0);

  // Steps skip known-empty images too: 5 → 4 → (3, 2, 1, 0 empty) stays at 4
  await userEvent.click(kSlider);
  await userEvent.keyboard('{End}');
  await expect.element(kSlider).toHaveValue(5);
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(kSlider).toHaveValue(4);
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(kSlider).toHaveValue(4);

  // `Home` and `PageDown` land on the first image that isn't empty
  await userEvent.keyboard('{End}{Home}');
  await expect.element(kSlider).toHaveValue(4);
  await userEvent.keyboard('{End}{PageDown}');
  await expect.element(kSlider).toHaveValue(4);
});

test('start with the hinted playback settings, until the user changes them', async () => {
  const { selectExplorerNode } = await renderApp(
    '/view_hints/playback_settings',
  );

  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'D0 playback settings' });
  await expect.element(dialog.getByLabelText('Speed')).toHaveValue(4);
  expect(dialog.getByLabelText('Bounce')).toBeChecked();
  expect(dialog.getByLabelText('Range: Each slice')).toBeChecked();

  await dialog.getByLabelText('Once').click();
  await expect.element(dialog.getByLabelText('Once')).toBeChecked();
  expect(dialog.getByLabelText('Speed')).toHaveValue(4);

  // Only the edited setting is remembered for other datasets, not the hinted ones
  await selectExplorerNode('skip_blank');
  await page.getByRole('button', { name: 'D0 playback settings' }).click();
  await expect.element(dialog.getByLabelText('Once')).toBeChecked();
  expect(dialog.getByLabelText('Speed')).toHaveValue(10);
  expect(dialog.getByLabelText('Range: Whole sequence')).toBeChecked();
});
