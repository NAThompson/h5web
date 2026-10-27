import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { getSelectedVisTab, getVisTabs, renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

function getPointSets(): Element[] {
  return [...document.querySelectorAll('[data-testid="overlay-points"]')];
}

function getLegend(): string[] {
  return page
    .getByRole('list', { name: 'Overlays' })
    .getByRole('listitem')
    .elements()
    .map((item) => item.textContent);
}

test('show poles as crosses and zeros as circles in the z-plane', async () => {
  await renderApp('/pole_zero/poles');

  expect(getVisTabs()).toContain(Vis.ComplexPoints);
  expect(getSelectedVisTab()).toBe(Vis.ComplexPoints);
  await expect
    .element(page.getByRole('figure', { name: 'poles' }))
    .toBeVisible();
  await expect
    .element(page.getByRole('button', { name: 'Keep ratio' }))
    .toHaveAttribute('aria-pressed', 'true');

  await expect.poll(() => getPointSets()).toHaveLength(2);
  const [poles, zeros] = getPointSets();

  // Double pole drawn once, labelled with its multiplicity
  expect(poles.querySelectorAll(':scope > g > path')).toHaveLength(3);
  expect(
    [...poles.querySelectorAll('text')].map((text) => text.textContent),
  ).toEqual(['2']);

  // Hollow circles
  const rings = zeros.querySelectorAll(':scope > g > circle');
  expect(rings).toHaveLength(3);
  expect(rings[0]).toHaveAttribute('fill', 'none');

  // Unit circle, dashed
  const circle = document.querySelector(
    '[data-testid="overlay-line"] path:last-of-type',
  );
  expect(circle).toHaveAttribute('stroke-dasharray');

  expect(getLegend()).toEqual(['Poles', 'Zeros']);
});

test('draw the imaginary axis of the s-plane as a reference line', async () => {
  await renderApp('/pole_zero/s_poles');

  expect(getSelectedVisTab()).toBe(Vis.ComplexPoints);
  await expect
    .poll(() => document.querySelector('[data-kind="vline"]'))
    .not.toBeNull();
  expect(getLegend()).toEqual(['ℜ s = 0']);
  expect(
    page.getByRole('note', { name: 'View hint notes' }).query(),
  ).toBeNull();
});

test('show empty axes and overlays without poles', async () => {
  await renderApp('/pole_zero/no_poles');

  await expect
    .element(page.getByRole('figure', { name: 'no_poles' }))
    .toBeVisible();
  await expect
    .poll(() => document.querySelectorAll('[data-testid="overlay-line"]'))
    .toHaveLength(1);
  for (const points of getPointSets()) {
    expect(points.querySelectorAll('circle, path')).toHaveLength(0);
  }
});
