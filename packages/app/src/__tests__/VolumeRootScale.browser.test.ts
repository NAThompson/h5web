import { expect, test } from 'vitest';
import { page } from 'vitest/browser';

import { renderApp } from '../test-utils';
import { Vis } from '../vis-packs/core/visualizations';

// At the default viewport, the end of these toolbars moves to the overflow menu
test.each([
  ['/dimension_scales/threeD_fermi', Vis.Volume],
  ['/view_hints/ortho', Vis.Orthoslices],
] as const)(
  'offer the nth root in the toolbar of %s (%s)',
  async (path, vis) => {
    const { user, selectVisTab } = await renderApp(path);
    await selectVisTab(vis);

    await user.click(page.getByRole('combobox', { name: 'Linear' }));
    await user.click(page.getByRole('option', { name: 'Root' }));

    await expect
      .element(page.getByRole('slider', { name: 'Root degree' }))
      .toBeVisible();
    await expect.element(page.getByText('n = 3.00')).toBeVisible();
  },
);

test('offer the nth root in the overflow menu of a narrow toolbar', async () => {
  await page.viewport(900, 1080); // e.g. a VS Code panel
  const { user, selectVisTab } = await renderApp(
    '/dimension_scales/threeD_fermi',
  );
  await selectVisTab(Vis.Volume);
  await expect
    .element(page.getByRole('combobox', { name: 'Linear' }))
    .not.toBeInTheDocument(); // in the overflow menu

  await user.click(page.getByRole('button', { name: 'More controls' }));
  await user.click(page.getByRole('combobox', { name: 'Linear' }));
  await user.click(page.getByRole('option', { name: 'Root' }));

  const slider = page.getByRole('slider', { name: 'Root degree' });
  await expect.element(slider).toBeVisible();
  (slider.element() as HTMLInputElement).focus();
  await user.keyboard('{ArrowRight}');
  await expect.element(page.getByText('n = 3.05')).toBeVisible();

  await page.viewport(1920, 1080);
});
