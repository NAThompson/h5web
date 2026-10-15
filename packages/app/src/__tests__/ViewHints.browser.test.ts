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

test('show notes in visualizations without overlays', async () => {
  await renderApp('/view_hints/line_overlays');

  expect(getSelectedVisTab()).toBe(Vis.Line);
  await expect
    .element(getNotes())
    .toHaveTextContent('ignored invalid "H5WEB_scale"');
  expect(getNotes()).toHaveTextContent('overlays are drawn on heatmaps only');
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
  await user.click(page.getByRole('slider', { name: 'D0' }));
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

  const slider = page.getByRole('slider', { name: 'D0' });
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

  const texts = [...document.querySelectorAll('[data-testid="overlays"] text')];
  expect(texts.map((text) => text.textContent)).toEqual(['e–e', 'θ = 0']);
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
  await expect.element(page.getByLabelText('Min: 3.162e-1')).toBeVisible();
  expect(page.getByLabelText('Max: 3.162e+0')).toBeVisible();
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

  await selectExplorerNode('line_pi');
  await expect
    .poll(() => getTickLabels('abscissa'))
    .toEqual(expect.arrayContaining(['0', 'π/2', 'π']));
});

function countColorBarPowers(): number {
  return [...document.querySelectorAll('[class*="colorBar"] svg text')].filter(
    (tick) => /^1e-\d+$/u.test(tick.textContent),
  ).length;
}

test('set the linear band of symlog scales around 0', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/symlog_heatmap');

  // Powers of 10 down to the threshold, not linear ticks crowded at the top
  await expect.poll(countColorBarPowers).toBeGreaterThanOrEqual(3);

  await selectExplorerNode('symlog_line');
  await expect
    .poll(() => getTickLabels('ordinate'))
    .toEqual(expect.arrayContaining(['1e-10', '1e-8', '1e-6']));
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
  expect(getProbe().getByText('κ (1/m)', { exact: true })).toBeVisible(); // x axis
  expect(getProbe().getByText('eV', { exact: true })).toBeVisible(); // y axis, from `units`
  const probeTicks = getProbe()
    .element()
    .querySelectorAll('svg[data-type="abscissa"] text');
  expect([...probeTicks].map((tick) => tick.textContent)).toContain('π'); // `H5WEB_ticks` of κ
  expect(document.querySelector('[data-testid="probe-marker"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="probe-slice"]')).not.toBeNull();

  // Current slice moves along the probed line
  await user.click(page.getByRole('slider', { name: 'D0' }));
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

test('probe a stack with the toolbar toggle, without hint', async () => {
  await page.viewport(2560, 1080); // whole heatmap toolbar
  const { user } = await renderApp('/view_hints/landscapes');

  const probeBtn = page.getByRole('button', { name: 'Probe', exact: true });
  await expect.element(probeBtn).toHaveAttribute('aria-pressed', 'false');
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  await userEvent.click(page.elementLocator(canvas)); // probe off: nothing
  expect(getProbe()).not.toBeInTheDocument();

  await user.click(probeBtn);
  await userEvent.click(page.elementLocator(canvas));
  await expect.element(getProbe()).toBeVisible();
  expect(getProbe()).toHaveTextContent('generation'); // first sliced dimension

  await page.viewport(1920, 1080);
});

test('label figures, colour bars and axes from CF `long_name` and `units`', async () => {
  const { selectExplorerNode } = await renderApp('/view_hints/cf_heatmap');

  // Title from the dataset's `long_name`, colour bar from its `units`, axis from the scale's
  await expect.element(page.getByRole('figure', { name: 'Eₖ' })).toBeVisible();
  expect(page.getByText('hartree', { exact: true })).toBeVisible();
  const abscissa = await getAxis('abscissa');
  expect(abscissa.getByText('αₕ (hyperangle) (rad)')).toBeVisible();

  // Line: `H5WEB_title` as title, `long_name` and `units` on the value axis
  await selectExplorerNode('cf_line');
  await expect
    .element(page.getByRole('figure', { name: 'growth' }))
    .toBeVisible();
  const ordinate = await getAxis('ordinate');
  expect(ordinate.getByText('norm (bohr)')).toBeVisible();

  // CF attributes alone: colour bar labelled, title left to the dataset name
  await selectExplorerNode('cf_plain');
  await expect
    .element(page.getByRole('figure', { name: 'cf_plain' }))
    .toBeVisible();
  expect(page.getByText('Eₖ (hartree)', { exact: true })).toBeVisible();
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
