import { type CustomDomain } from '@h5web/lib';
import { ScaleType } from '@h5web/shared/vis-models';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { type ColorMap } from '../heatmap/models';
import { useSuggestions } from '../hooks';
import {
  type ColorOrRootScaleType,
  DEFAULT_ROOT_N,
  migrateSqrtToRoot,
} from '../utils';

export interface OrthoslicesConfig {
  customDomain: CustomDomain;
  setCustomDomain: (customDomain: CustomDomain) => void;

  colorMap: ColorMap;
  setColorMap: (colorMap: ColorMap) => void;

  invertColorMap: boolean;
  setInvertColorMap: (invertColorMap: boolean) => void;

  scaleType: ColorOrRootScaleType;
  setScaleType: (scaleType: ColorOrRootScaleType) => void;

  rootN: number; // degree of the nth-root scale (gamma of exponent 1/n)
  setRootN: (rootN: number) => void;

  keepRatio: boolean;
  setKeepRatio: (keepRatio: boolean) => void;
}

function createOrthoslicesConfigStore() {
  return createStore<OrthoslicesConfig>()(
    persist(
      (set): OrthoslicesConfig => ({
        customDomain: [null, null],
        setCustomDomain: (customDomain) => set({ customDomain }),

        colorMap: 'Viridis',
        setColorMap: (colorMap) => set({ colorMap }),

        invertColorMap: false,
        setInvertColorMap: (invertColorMap) => set({ invertColorMap }),

        scaleType: ScaleType.Linear,
        setScaleType: (scaleType) => set({ scaleType }),

        rootN: DEFAULT_ROOT_N,
        setRootN: (rootN) => set({ rootN }),

        keepRatio: true,
        setKeepRatio: (keepRatio) => set({ keepRatio }),
      }),
      {
        name: 'h5web:orthoslices',
        version: 2,
        migrate: migrateSqrtToRoot, // v2: Root replaces Sqrt in the toolbar
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<OrthoslicesConfig>);

export function OrthoslicesConfigProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createOrthoslicesConfigStore);

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useOrthoslicesConfig(
  suggestions: Partial<OrthoslicesConfig> = {},
): OrthoslicesConfig {
  const config = useStore(useContext(StoreContext));

  // e.g. a file's `H5WEB_*` view hint
  return useSuggestions(config, suggestions);
}
