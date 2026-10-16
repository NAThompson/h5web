import { assertNonNull } from '@h5web/shared/guards';
import { expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { getSelectedVisTab, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

function getPanel(title: string) {
  return page.getByRole('region', { name: title, exact: true });
}

function getPanelTitles(): string[] {
  return [...document.querySelectorAll('section[aria-label]')].map(
    (section) => section.getAttribute('aria-label') ?? '',
  );
}

function countColorBars(): number {
  return document.querySelectorAll('[class*="_colorBar_"]').length;
}

function countEmptyPanels(): number {
  return document.querySelectorAll('section[data-empty]').length;
}

function getCursorValues(): string[] {
  return [
    ...document.querySelectorAll('[data-testid="panel-cursor-value"]'),
  ].map((elem) => elem.textContent);
}

/* Hover the middle of a panel's plot, once drawn */
async function hoverPanel(title: string) {
  await expect
    .poll(() =>
      getPanel(title).element().querySelector('[class*="canvasArea"]'),
    )
    .not.toBeNull();
  const area = getPanel(title).element().querySelector('[class*="canvasArea"]');
  assertNonNull(area);
  await userEvent.hover(page.elementLocator(area));
}

test('show the panels of a group side by side, in one canvas', async () => {
  await renderApp('/view_hints/panels');

  expect(getSelectedVisTab()).toBe('Panels');
  await expect
    .poll(getPanelTitles)
    .toEqual(['ψ', 'ψ/2', '|ψ − ψ/2|', 'profile']);
  await expect
    .poll(() => document.querySelectorAll('section figure').length)
    .toBe(4); // heatmaps and a line
  expect(document.querySelectorAll('canvas')).toHaveLength(1); // a single WebGL context

  const notes = page.getByRole('note', { name: 'View hint notes' });
  await expect
    .element(notes)
    .toHaveTextContent('panel "missing" was not found');
});

test('share the colour domain of panels with the same scale', async () => {
  const { user } = await renderApp('/view_hints/panels');

  // `H5WEB_symmetric`: one colour bar for the linear panels, one for the log one
  const toggle = page.getByRole('button', { name: 'Shared domain' });
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(countColorBars).toBe(2);

  await user.click(toggle);
  await expect.poll(countColorBars).toBe(3); // a colour bar in each heatmap panel
});

test('slice panels sharing a dimension scale together', async () => {
  const { user } = await renderApp('/view_hints/panels');

  // One slider for `generation`, shared by `field` and `field_half`
  const slider = page.getByRole('slider', { name: 'generation' });
  await expect.element(slider).toBeVisible();
  expect(page.getByRole('slider')).toHaveLength(1);

  await hoverPanel('ψ');
  await expect.poll(getCursorValues).toHaveLength(3); // linked cursor in heatmaps on (θ, α)
  const [field, half] = getCursorValues();
  expect(Number(field.replace('−', '-'))).toBeCloseTo(
    2 * Number(half.replace('−', '-')),
  );

  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}'); // generation 1: values twice as large
  await hoverPanel('ψ'); // same point
  await expect
    .poll(() => Number(getCursorValues()[0].replace('−', '-')))
    .toBeCloseTo(2 * Number(field.replace('−', '-')));
});

test('show the value of every panel at the cursor', async () => {
  const { user } = await renderApp('/view_hints/panels');

  await hoverPanel('|ψ − ψ/2|');
  await expect.poll(getCursorValues).toHaveLength(3);
  expect(
    document.querySelectorAll('[data-testid="panel-cursor"]'),
  ).toHaveLength(3);

  await user.click(page.getByRole('button', { name: 'Link cursor' }));
  await hoverPanel('ψ');
  await expect.poll(getCursorValues).toHaveLength(0);
});

test('zoom panels with the same axes together', async () => {
  await renderApp('/view_hints/panels');

  await hoverPanel('ψ');
  await userEvent.wheel(getPanel('ψ').element(), { delta: { y: -300 } });

  // Reset buttons of zoomed panels (heatmaps on the same axes)
  await expect
    .poll(
      () =>
        [
          ...document.querySelectorAll<HTMLButtonElement>('section button'),
        ].filter((btn) => btn.textContent === 'Reset zoom' && !btn.hidden)
          .length,
    )
    .toBe(3);
});

// Ctrl+click opens the context menu on macOS, instead of starting a selection to zoom
test.runIf(navigator.platform.startsWith('Mac'))(
  'prevent the context menu in panels',
  async () => {
    await renderApp('/view_hints/panels');

    await hoverPanel('ψ');
    const target = getPanel('ψ')
      .element()
      .querySelector('[class*="eventTarget"]');
    assertNonNull(target);
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
  },
);

test('open a panel in the single view from its title', async () => {
  const { user } = await renderApp('/view_hints/panels');

  await user.click(page.getByRole('button', { name: '|ψ − ψ/2|' }));
  await expect
    .element(page.getByRole('figure', { name: '|ψ − ψ/2|' }))
    .toBeVisible();
  expect(getSelectedVisTab()).toBe(Vis.Heatmap);
});

test('show small multiples over two dimensions', async () => {
  await renderApp('/view_hints/multiples');

  expect(getSelectedVisTab()).toBe(Vis.Multiples);
  await expect.poll(() => getPanelTitles().length).toBe(12); // 4 k x 3 p
  expect(getPanelTitles().slice(0, 4)).toEqual([
    'k = 0, p = 0',
    'k = 0, p = 1',
    'k = 0, p = 2',
    'k = 1, p = 0',
  ]);

  // NaN where p > k: blank panels
  await expect.poll(countEmptyPanels).toBe(3);
  await expect.poll(countColorBars).toBe(1); // shared domain
  expect(document.querySelectorAll('canvas')).toHaveLength(1);
  expect(page.getByRole('slider')).toHaveLength(0); // both other dimensions on axes

  // Axis labels once, beside the grid
  await expect
    .poll(() =>
      [
        ...document.querySelectorAll(
          '[class*="_yLabel_"], [class*="_xLabel_"]',
        ),
      ].map((elem) => elem.textContent),
    )
    .toEqual(['theta', 'alpha']);

  // Linked cursor: crosshairs, and the hovered panel's value in a readout (no tooltip)
  await hoverPanel('k = 2, p = 1');
  const readout = page.getByRole('status', { name: 'Cursor' });
  await expect.element(readout).toHaveTextContent(/k = 2, p = 1/u);
  await expect
    .poll(
      () => document.querySelectorAll('[data-testid="panel-cursor"]').length,
    )
    .toBe(9);
});

test('slice small multiples along the other dimensions', async () => {
  const { user } = await renderApp('/view_hints/multiples_k');

  await expect
    .poll(getPanelTitles)
    .toEqual(['k = 0', 'k = 1', 'k = 2', 'k = 3']);
  // `H5WEB_multiples_columns`: two per row
  expect(getPanel('k = 2').element()).toHaveStyle({ gridRow: '2' });

  const slider = page.getByRole('slider', { name: 'p' });
  await expect.element(slider).toBeVisible();
  await user.click(slider);
  await userEvent.keyboard('{ArrowUp}{ArrowUp}'); // p = 2: NaN for k < 2
  await expect.poll(countEmptyPanels).toBe(2);
});

test('open a slice of small multiples in the single view', async () => {
  const { user } = await renderApp('/view_hints/multiples');

  await user.click(page.getByRole('button', { name: 'k = 2, p = 1' }));
  await expect.poll(getSelectedVisTab).toBe(Vis.Heatmap);
  await expect
    .element(page.getByRole('slider', { name: 'k' }))
    .toHaveAttribute('aria-valuenow', '2');
  expect(page.getByRole('slider', { name: 'p' })).toHaveAttribute(
    'aria-valuenow',
    '1',
  );
});
