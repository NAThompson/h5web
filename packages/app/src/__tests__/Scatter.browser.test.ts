import { renderSvgSnapshot } from '@h5web/lib';
import { assertDefined, assertNonNull } from '@h5web/shared/guards';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { toCoordinateArray } from '../vis-packs/core/geometry/hooks';
import { Vis } from '../vis-packs/core/visualizations';

// Spy on preparation of fetched values (each call allocates arrays that get uploaded)
vi.mock(import('../vis-packs/core/geometry/hooks'), { spy: true });

/* Creating a WebGL context is slow with SwiftShader (cf. `HeatmapSurface.browser.test.ts`) */
const TEST_TIMEOUT = 20_000;

// Wide enough for 3D toolbars to fit without moving controls into "More controls" menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

/* Tooltip shown when hovering the centre of the canvas, if any */
async function hoverCentre(): Promise<string | undefined> {
  const canvas = document.querySelector('figure canvas');
  assertNonNull(canvas);
  const { width, height } = canvas.getBoundingClientRect();
  await userEvent.hover(canvas, {
    position: { x: width / 2, y: height / 2 },
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 200); // picking runs on the next animation frame
  });
  return document.querySelector('[class*="tooltip"]')?.textContent;
}

function hasText(text: string): boolean {
  return [...document.querySelectorAll('figure *')].some(
    (el) => el.childElementCount === 0 && el.textContent === text,
  );
}

test(
  'show columns of (n, 4) dataset as point cloud',
  async () => {
    await renderApp('/scatter/columns');

    expect(getVisTabs()).toEqual([
      Vis.Matrix,
      Vis.Line,
      Vis.Heatmap,
      Vis.Scatter,
      Vis.Scatter3D,
    ]);
    expect(getSelectedVisTab()).toBe(Vis.Scatter3D);
    await expect
      .element(page.getByRole('figure', { name: 'Spiral galaxy' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Reset view' }))
      .toBeVisible();
    await expect.poll(() => hasText('energy')).toBe(true); // colour bar label
  },
  TEST_TIMEOUT,
);

test('keep default vis of datasets without scatter hint', async () => {
  await renderApp('/scatter/xy');
  expect(getVisTabs()).toEqual([Vis.Matrix, Vis.Line, Vis.Heatmap]);
  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
});

test(
  'show (n, 2) dataset as scatter plot of a single colour',
  async () => {
    await renderApp('/scatter/two_d');

    expect(getVisTabs()).toEqual([
      Vis.Matrix,
      Vis.Line,
      Vis.Heatmap,
      Vis.Scatter,
    ]);
    expect(getSelectedVisTab()).toBe(Vis.Scatter);
    await expect
      .element(page.getByRole('figure', { name: 'two_d' }))
      .toBeVisible();
    expect(
      page.getByRole('button', { name: 'Edit domain' }),
    ).not.toBeInTheDocument(); // no colour values
  },
  TEST_TIMEOUT,
);

test(
  'keep point buffers and show hinted opacity on toolbar clicks',
  async () => {
    await renderApp('/scatter/two_d');
    await expect
      .element(page.getByRole('figure', { name: 'two_d' }))
      .toBeVisible();
    const calls = vi.mocked(toCoordinateArray).mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Grid' }).click(); // re-render
    await page.getByRole('button', { name: 'Points' }).click();
    expect(toCoordinateArray).toHaveBeenCalledTimes(calls);

    // `H5WEB_point_opacity = 0.3`: not a preset, but shown as current option
    await expect
      .element(page.getByRole('radio', { name: '30 %' }))
      .toBeChecked();
  },
  TEST_TIMEOUT,
);

test(
  'show values at CF point coordinates in 3D by default',
  async () => {
    const { user } = await renderApp('/scatter/cf_points');

    expect(getVisTabs()).toEqual([
      Vis.Matrix,
      Vis.Line,
      Vis.Scatter,
      Vis.Scatter3D,
    ]);
    expect(getSelectedVisTab()).toBe(Vis.Scatter3D);
    await expect.poll(() => hasText('Temperature (degC)')).toBe(true);

    // Coordinates in X, Y, Z order from their CF attributes, not as listed
    await user.click(page.getByRole('tab', { name: Vis.Scatter, exact: true }));
    await expect.poll(() => hasText('lon (degrees_east)')).toBe(true);
    expect(hasText('lat (degrees_north)')).toBe(true);
  },
  TEST_TIMEOUT,
);

test(
  'show group of datasets coloured and sized by them',
  async () => {
    await renderApp('/scatter/group');

    expect(getVisTabs()).toEqual([Vis.Scatter]);
    await expect
      .element(page.getByRole('figure', { name: 'Gaussian mixture' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('group', { name: 'Size legend' }))
      .toBeVisible();
    expect(hasText('cluster')).toBe(true); // colour bar label
  },
  TEST_TIMEOUT,
);

test(
  'show index and values of point under cursor, in 3D and 2D',
  async () => {
    const { user } = await renderApp('/scatter/tiny');
    expect(getSelectedVisTab()).toBe(Vis.Scatter3D);

    await expect
      .poll(hoverCentre)
      .toMatch(/#1.*x = 0.*y = 0.*z = 0.*energy = 2/u);

    await user.click(page.getByRole('tab', { name: Vis.Scatter, exact: true }));
    await expect.poll(hoverCentre).toMatch(/#1.*x = 0.*y = 0.*energy = 2/u);
  },
  TEST_TIMEOUT,
);

test(
  'hide points with NaN colour',
  async () => {
    const { user } = await renderApp('/scatter/tiny_nan');
    await expect
      .element(page.getByRole('button', { name: 'Reset view' }))
      .toBeVisible();
    await vi.waitFor(() => {
      expect(document.querySelector('figure canvas')).not.toBeNull();
    });
    await expect(hoverCentre()).resolves.toBeUndefined();

    await user.click(page.getByRole('tab', { name: Vis.Scatter, exact: true }));
    await expect
      .element(page.getByRole('figure', { name: 'tiny_nan' }))
      .toBeVisible();
    await expect(hoverCentre()).resolves.toBeUndefined();
  },
  TEST_TIMEOUT,
);

/* SVG snapshot of the figure, once `isReady` */
async function exportSvgWhen(
  name: string,
  isReady: (svg: SVGElement) => boolean,
): Promise<SVGElement> {
  const figure = page.getByRole('figure', { name }).element() as HTMLElement;
  const result: { svg?: SVGElement } = {};
  await expect
    .poll(() => {
      result.svg = renderSvgSnapshot(figure);
      return isReady(result.svg);
    })
    .toBe(true);
  assertDefined(result.svg);
  return result.svg;
}

test(
  'export points of 2D scatter plot as vector glyphs, sized per point',
  async () => {
    await renderApp('/scatter/group');
    const svg = await exportSvgWhen(
      'Gaussian mixture',
      (doc) => doc.querySelectorAll('path[fill^="rgb"]').length > 0,
    );

    // One path per colour, one circle per visible point, of different sizes
    const paths = [...svg.querySelectorAll('path[fill^="rgb"]')];
    const arcs = paths.flatMap(
      (path) => path.getAttribute('d')?.match(/a[\d.]+ /gu) ?? [],
    );
    expect(arcs).toHaveLength(2 * 400); // two arcs per circle
    expect(new Set(arcs).size).toBeGreaterThan(10);
  },
  TEST_TIMEOUT,
);

test(
  'export translucent points one path each, so that overlaps get denser',
  async () => {
    await renderApp('/scatter/two_d'); // `H5WEB_point_opacity = 0.3`
    const svg = await exportSvgWhen(
      'two_d',
      (doc) => doc.querySelectorAll('path[fill^="rgb"]').length > 0,
    );

    const paths = [...svg.querySelectorAll('path[fill^="rgb"]')];
    expect(paths.length).toBeGreaterThan(300);
    for (const path of paths) {
      expect(path.getAttribute('d')?.match(/a[\d.]+ /gu)).toHaveLength(2); // one circle
      expect(path.getAttribute('fill-opacity')).toBe('0.3');
    }
  },
  TEST_TIMEOUT,
);

test(
  'export point cloud as raster',
  async () => {
    await renderApp('/scatter/columns');
    const svg = await exportSvgWhen(
      'Spiral galaxy',
      (doc) => doc.querySelector('image') !== null,
    );
    expect(svg.querySelector('image')?.getAttribute('href')).toMatch(
      /^data:image\/png/u,
    );
  },
  TEST_TIMEOUT,
);
