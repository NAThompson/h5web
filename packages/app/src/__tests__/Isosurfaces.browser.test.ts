import { afterEach, beforeEach, expect, test } from 'vitest';
import { type Locator, page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

function isosurfacesBtn() {
  return page.getByRole('button', { name: 'Isosurfaces', exact: true });
}

/* `userEvent.fill` doesn't support range inputs: set the value as a drag would */
function setRangeValue(slider: Locator, value: string) {
  const input = slider.element() as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function addLevelBtn() {
  return page.getByRole('button', { name: 'Add level' });
}

// Leave room for the whole volume toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('add, edit and remove iso levels', async () => {
  // Volume is never the preferred vis, so select it explicitly
  const { user, selectVisTab } = await renderApp(
    '/dimension_scales/threeD_fermi',
  );
  await selectVisTab(Vis.Volume);

  await user.click(isosurfacesBtn());
  await expect
    .element(page.getByRole('dialog', { name: 'Isosurfaces' }))
    .toBeVisible();
  expect(page.getByRole('listitem')).not.toBeInTheDocument();

  // New levels start in the middle of the domain, i.e. near E = 0 for a symmetric band
  await user.click(addLevelBtn());
  const value1 = page.getByRole('textbox', { name: 'Level 1 value' });
  await expect.element(value1).toBeVisible();
  expect(
    Math.abs(Number.parseFloat(value1.element().getAttribute('value') ?? '')),
  ).toBeLessThan(0.1);

  await user.clear(value1);
  await user.type(value1, '-1{Enter}');
  await expect.element(value1).toHaveValue('−1');

  // Formatted values keep their Unicode minus sign when edited
  await user.type(value1, '{End}.5{Enter}');
  await expect.element(value1).toHaveValue('−1.5');
  await user.clear(value1);
  await user.type(value1, '-1{Enter}');
  await expect.element(value1).toHaveValue('−1');

  // Slider follows the value: -1 is at 5/12 of the [-6, 6] domain
  const slider1 = page.getByRole('slider', { name: 'Level 1 slider' });
  expect(Number(slider1.element().getAttribute('value'))).toBeCloseTo(
    (5 / 12) * 1000,
    -1,
  );

  // Moving the slider updates the value
  setRangeValue(slider1, '750');
  await expect
    .poll(() => (value1.element() as HTMLInputElement).value)
    .toMatch(/^3\.00\d$/u);

  // Extraction completes in the worker, then the progress status goes away
  await expect
    .poll(() => document.querySelector('[role="status"]'), { timeout: 10_000 })
    .toBeNull();

  await user.click(addLevelBtn());
  await expect
    .element(page.getByRole('textbox', { name: 'Level 2 value' }))
    .toBeVisible();

  // Visibility and opacity
  const show2 = page.getByRole('checkbox', { name: 'Show level 2' });
  expect(show2).toBeChecked();
  await user.click(show2);
  expect(show2).not.toBeChecked();
  setRangeValue(page.getByRole('slider', { name: 'Level 2 opacity' }), '0.5');
  expect(page.getByRole('slider', { name: 'Level 2 opacity' })).toHaveValue(
    '0.5',
  );

  await user.click(page.getByRole('button', { name: 'Remove level 1' }));
  expect(page.getByRole('listitem')).toHaveLength(1);
  // Remaining level is renumbered
  await expect
    .element(page.getByRole('textbox', { name: 'Level 1 value' }))
    .toBeVisible();
});

test('colour isosurfaces by gradient magnitude and hide volume', async () => {
  // Volume is never the preferred vis, so select it explicitly
  const { user, selectVisTab } = await renderApp(
    '/dimension_scales/threeD_fermi',
  );
  await selectVisTab(Vis.Volume);

  await user.click(isosurfacesBtn());
  await user.click(addLevelBtn());
  expect(page.getByLabelText('Level 1 colour')).toBeVisible();

  await user.click(page.getByRole('radio', { name: '|∇𝑓|' }));
  expect(page.getByLabelText('Level 1 colour')).not.toBeInTheDocument();

  // Colour bar of gradient magnitudes appears once the surface is extracted
  await expect
    .element(page.getByLabelText('Gradient magnitude'), { timeout: 10_000 })
    .toBeVisible();
  expect(page.getByLabelText('Gradient magnitude')).toHaveTextContent('|∇𝑓|');

  // Hide the volume rendering: only the gradient colour bar remains
  await user.keyboard('{Escape}');
  const volumeBtn = page.getByRole('button', { name: 'Show volume' });
  expect(page.getByLabelText(/^Max: /u).elements()).toHaveLength(2);
  expect(volumeBtn).toHaveAttribute('aria-pressed', 'true');
  expect(
    page.getByRole('radiogroup', { name: 'Rendering mode' }),
  ).toBeVisible();

  await user.click(volumeBtn);
  expect(volumeBtn).toHaveAttribute('aria-pressed', 'false');
  expect(
    page.getByRole('radiogroup', { name: 'Rendering mode' }),
  ).not.toBeInTheDocument();
  // Only the colour bar of gradient magnitudes remains
  expect(page.getByLabelText(/^Max: /u).elements()).toHaveLength(1);
});
