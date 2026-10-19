import { type CustomDomain } from '@h5web/lib';
import { type ColorScaleType, ScaleType } from '@h5web/shared/vis-models';
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

export interface OrthoslicesConfig {
  customDomain: CustomDomain;
  setCustomDomain: (customDomain: CustomDomain) => void;

  colorMap: ColorMap;
  setColorMap: (colorMap: ColorMap) => void;

  invertColorMap: boolean;
  setInvertColorMap: (invertColorMap: boolean) => void;

  scaleType: ColorScaleType;
  setScaleType: (scaleType: ColorScaleType) => void;

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

        keepRatio: true,
        setKeepRatio: (keepRatio) => set({ keepRatio }),
      }),
      {
        name: 'h5web:orthoslices',
        version: 1,
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
