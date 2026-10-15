import { useState } from 'react';
import { expect, test } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { useSuggestion, useSuggestions } from '../vis-packs/core/hooks';

interface Config {
  colorMap: string;
  setColorMap: (colorMap: string) => void;
}

function useConfig(suggestion: string | undefined): Config {
  const [colorMap, setColorMap] = useState('Viridis');
  return useSuggestions({ colorMap, setColorMap }, { colorMap: suggestion });
}

test('apply suggestion until the user changes the setting', async () => {
  const { result, act, rerender } = await renderHook(
    (props?: { suggestion?: string }) => useConfig(props?.suggestion),
    { initialProps: { suggestion: 'Inferno' } },
  );
  expect(result.current.colorMap).toBe('Inferno');

  await act(() => result.current.setColorMap('Blues'));
  expect(result.current.colorMap).toBe('Blues');

  await rerender({ suggestion: 'RdBu' });
  expect(result.current.colorMap).toBe('Blues');
});

test('keep a change made before a data-dependent suggestion arrives', async () => {
  const { result, act, rerender } = await renderHook(
    (props?: { suggestion?: string }) => useConfig(props?.suggestion),
    { initialProps: { suggestion: undefined as string | undefined } },
  );
  expect(result.current.colorMap).toBe('Viridis');

  await act(() => result.current.setColorMap('Blues')); // before data is loaded
  await rerender({ suggestion: 'RdBu' }); // e.g. `"colorMap": "auto"` once data is known
  expect(result.current.colorMap).toBe('Blues');
});

test('keep a change made before a single suggestion arrives', async () => {
  const { result, act, rerender } = await renderHook(
    (props?: { suggestion?: string }) => {
      const [value, setValue] = useState('linear');
      return useSuggestion(props?.suggestion, value, setValue);
    },
    { initialProps: { suggestion: undefined as string | undefined } },
  );

  await act(() => result.current[1]('symlog')); // before dimension scales are loaded
  await rerender({ suggestion: 'log' }); // e.g. `H5WEB_axis_scale` of the x axis' scale
  expect(result.current[0]).toBe('symlog');
});
