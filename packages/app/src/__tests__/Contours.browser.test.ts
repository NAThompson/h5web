import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';

function contoursBtn() {
  return page.getByRole('button', { name: 'Contours', exact: true });
}

function contourValues() {
  return page.getByLabelText('Contour values');
}

function countLabels(text: string): number {
  // Contour labels are HTML spans, unlike axis tick labels (SVG text)
  return [...document.querySelectorAll('figure span')].filter(
    (el) => el.textContent === text,
  ).length;
}

// Leave room for the whole heatmap toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('show automatic contour levels with labels', async () => {
  const { user } = await renderApp('/dimension_scales/twoD_contours');

  await user.click(contoursBtn());
  const dialog = page.getByRole('dialog', { name: 'Contours' });
  await expect.element(dialog).toBeVisible();
  expect(page.getByRole('radio', { name: 'Off' })).toBeChecked();
  expect(contourValues()).not.toBeInTheDocument();

  await user.click(page.getByRole('radio', { name: 'Auto' }));
  expect(
    page.getByRole('spinbutton', { name: 'Number of levels' }),
  ).toHaveValue(8);
  await expect
    .element(contourValues())
    .toHaveTextContent('−0.5, 0, 0.5, 1, 1.5, 2');

  // Fewer levels
  await user.fill(
    page.getByRole('spinbutton', { name: 'Number of levels' }),
    '3',
  );
  await expect.element(contourValues()).toHaveTextContent('0, 1, 2');

  expect(countLabels('1')).toBe(0);
  await user.click(page.getByRole('checkbox', { name: 'Show labels' }));
  await expect.poll(() => countLabels('1')).toBeGreaterThan(0);

  // Colour by level hides the colour picker
  expect(page.getByLabelText('Line colour')).toBeVisible();
  await user.click(page.getByRole('radio', { name: 'Colour map' }));
  expect(page.getByLabelText('Line colour')).not.toBeInTheDocument();

  await user.click(page.getByRole('radio', { name: 'Off' }));
  await expect.poll(() => countLabels('1')).toBe(0);
});

test('enter custom contour levels', async () => {
  const { user } = await renderApp('/dimension_scales/twoD_contours');

  await user.click(contoursBtn());
  await user.click(page.getByRole('radio', { name: 'Custom' }));

  // Start from automatic levels
  const input = page.getByRole('textbox', { name: 'Custom levels' });
  await expect.element(input).toHaveValue('−0.5, 0, 0.5, 1, 1.5, 2');

  await user.clear(input);
  await user.type(input, '1.2; 0.25 foo, 0.25{Enter}');
  await expect.element(contourValues()).toHaveTextContent('0.25, 1.2');
  expect(input).toHaveValue('0.25, 1.2');

  await user.click(page.getByRole('checkbox', { name: 'Show labels' }));
  await expect.poll(() => countLabels('1.2')).toBeGreaterThan(0);
  expect(countLabels('0.5')).toBe(0);
});
