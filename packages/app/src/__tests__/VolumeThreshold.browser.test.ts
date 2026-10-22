import { afterEach, beforeEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

/* Min bound of the volume's color bar (the first one), as a number */
function getColorBarMin(): number {
  const bound = document.querySelector('[aria-label^="Min: "]');
  return Number(bound?.textContent.replace('−', '-'));
}

/* `userEvent.fill` doesn't support range inputs: set the value as a drag would */
function setThreshold(value: string) {
  const input = page.getByRole('slider', { name: 'Threshold' }).element();
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// Leave room for the whole volume toolbar, so no control moves to the overflow menu
beforeEach(async () => {
  await page.viewport(2560, 1080);
});

afterEach(async () => {
  await page.viewport(1920, 1080);
});

test('start the colors of the volume at the threshold', async () => {
  // Data range [−5.993, 6]
  const { user, selectVisTab } = await renderApp(
    '/dimension_scales/threeD_fermi',
  );
  await selectVisTab(Vis.Volume);

  setThreshold('0');
  await expect.poll(getColorBarMin).toBeCloseTo(-5.993, 2);

  // Halfway in linear scale: from about 0
  setThreshold('0.5');
  await expect.poll(getColorBarMin).toBeCloseTo(0.0035, 3);

  // Halfway in square root: a quarter of the range
  await user.click(page.getByRole('combobox', { name: 'Linear' }));
  await user.click(page.getByRole('option', { name: 'Root' }));
  const slider = page.getByRole('slider', { name: 'Root degree' });
  (slider.element() as HTMLInputElement).focus();
  await user.keyboard('{ArrowLeft}'.repeat(20)); // n = 3 → 2
  await expect.element(slider).toHaveValue('2');
  await expect.poll(getColorBarMin).toBeCloseTo(-2.995, 2);

  // The iso value is a surface, not a minimum: all colors again
  await user.click(page.getByRole('radio', { name: 'Iso' }));
  await expect.poll(getColorBarMin).toBeCloseTo(-5.993, 2);
});
