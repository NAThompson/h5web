import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { useSuggestion } from '../hooks';

export interface ComplexPointsConfig {
  keepRatio: boolean; // equal aspect of the real and imaginary axes
  setKeepRatio: (keepRatio: boolean) => void;

  showGrid: boolean;
  setShowGrid: (showGrid: boolean) => void;

  sizeScale: number; // multiplies marker sizes
  setSizeScale: (sizeScale: number) => void;
}

function createComplexPointsConfigStore() {
  return createStore<ComplexPointsConfig>()(
    persist(
      (set): ComplexPointsConfig => ({
        keepRatio: false,
        setKeepRatio: (keepRatio) => set({ keepRatio }),

        showGrid: true,
        setShowGrid: (showGrid) => set({ showGrid }),

        sizeScale: 1,
        setSizeScale: (sizeScale) => set({ sizeScale }),
      }),
      { name: 'h5web:complexPoints', version: 1 },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<ComplexPointsConfig>);

export function ComplexPointsConfigProvider(props: PropsWithChildren) {
  const { children } = props;
  const [store] = useState(createComplexPointsConfigStore);
  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useComplexPointsConfig(
  suggestions: Partial<Pick<ComplexPointsConfig, 'keepRatio'>> = {},
): ComplexPointsConfig {
  const config = useStore(useContext(StoreContext));
  const [keepRatio, setKeepRatio] = useSuggestion(
    suggestions.keepRatio,
    config.keepRatio,
    config.setKeepRatio,
  );
  return { ...config, keepRatio, setKeepRatio };
}
