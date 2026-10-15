import { DimensionMapper, type DimensionMapping } from '@h5web/lib';
import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

test('follow slices set from outside, but not echoes of its own', async () => {
  const onChange = vi.fn<(mapping: DimensionMapping) => void>();
  function mapper(index: number) {
    return createElement(DimensionMapper, {
      dims: [10, 3],
      dimMapping: [index, 'x'],
      onChange,
    });
  }

  const { rerender } = await render(mapper(0));
  const slider = page.getByRole('slider', { name: 'D0' });

  // User picks 5, echoed back once debounced
  await userEvent.click(slider);
  await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}');
  await expect.poll(() => onChange.mock.lastCall).toEqual([[5, 'x']]);
  await rerender(mapper(5));
  await expect.element(slider).toHaveValue(5);

  // Set from outside to 3, then to 5 again
  await rerender(mapper(3));
  await expect.element(slider).toHaveValue(3);
  await rerender(mapper(5));
  await expect.element(slider).toHaveValue(5);
});
