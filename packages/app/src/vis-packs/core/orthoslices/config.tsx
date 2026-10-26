import { type CustomDomain, type PaletteName } from '@h5web/lib';
import { ScaleType } from '@h5web/shared/vis-models';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { DEFAULT_CATEGORICAL_PALETTE } from '../categorical';
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

  /* Integer labels (e.g. material IDs): a color per value from a palette, and a discrete legend */
  categorical: boolean;
  setCategorical: (categorical: boolean) => void;

  categoricalPalette: PaletteName;
  setCategoricalPalette: (categoricalPalette: PaletteName) => void;
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

        categorical: false,
        setCategorical: (categorical) => set({ categorical }),

        categoricalPalette: DEFAULT_CATEGORICAL_PALETTE,
        setCategoricalPalette: (categoricalPalette) =>
          set({ categoricalPalette }),
      }),
      {
        name: 'h5web:orthoslices',
        version: 3,
        // v2: Root replaces Sqrt in the toolbar; v3: palette of categorical colors
        migrate: (persisted) => {
          const state = migrateSqrtToRoot(persisted) as Record<string, unknown>;
          if (state.categoricalPalette === undefined) {
            state.categoricalPalette = DEFAULT_CATEGORICAL_PALETTE;
          }
          return state as never;
        },
        // Categorical colors are for label data: on for the session only, or by a hint
        partialize: ({ categorical, ...state }) => state,
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
