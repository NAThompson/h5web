import { type CustomDomain } from '@h5web/lib';
import { type AxisScaleType, ScaleType } from '@h5web/shared/vis-models';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { type ColorMap } from '../heatmap/models';
import { useSuggestion } from '../hooks';
import {
  type ColorOrRootScaleType,
  DEFAULT_ROOT_N,
  migrateSqrtToRoot,
} from '../utils';

export interface ScatterConfig {
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

  showGrid: boolean;
  setShowGrid: (showGrid: boolean) => void;

  xScaleType: AxisScaleType;
  yScaleType: AxisScaleType;
  setXScaleType: (type: AxisScaleType) => void;
  setYScaleType: (type: AxisScaleType) => void;

  // Points (`H5WEB_vis = "scatter"` / `"scatter3d"`)
  sizeScale: number; // multiplies point sizes
  setSizeScale: (sizeScale: number) => void;

  opacity: number;
  setOpacity: (opacity: number) => void;

  keepRatio: boolean; // 3D
  setKeepRatio: (keepRatio: boolean) => void;

  showAxes: boolean; // 3D
  setShowAxes: (showAxes: boolean) => void;
}

function createScatterConfigStore() {
  return createStore<ScatterConfig>()(
    persist(
      (set): ScatterConfig => ({
        customDomain: [null, null],
        setCustomDomain: (customDomain) => set({ customDomain }),

        colorMap: 'Viridis',
        setColorMap: (colorMap) => set({ colorMap }),

        invertColorMap: false,
        setInvertColorMap: (invertColorMap) => set({ invertColorMap }),

        scaleType: ScaleType.Linear,
        setScaleType: (scaleType) => set(() => ({ scaleType })),

        rootN: DEFAULT_ROOT_N,
        setRootN: (rootN) => set({ rootN }),

        showGrid: true,
        setShowGrid: (showGrid) => set({ showGrid }),

        xScaleType: ScaleType.Linear,
        yScaleType: ScaleType.Linear,
        setXScaleType: (type) => set({ xScaleType: type }),
        setYScaleType: (type) => set({ yScaleType: type }),

        sizeScale: 1,
        setSizeScale: (sizeScale) => set({ sizeScale }),

        opacity: 1,
        setOpacity: (opacity) => set({ opacity }),

        keepRatio: true,
        setKeepRatio: (keepRatio) => set({ keepRatio }),

        showAxes: true,
        setShowAxes: (showAxes) => set({ showAxes }),
      }),
      {
        name: 'h5web:scatter',
        version: 3,
        migrate: migrateSqrtToRoot, // v3: Root replaces Sqrt in the toolbar
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<ScatterConfig>);

export function ScatterConfigProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createScatterConfigStore);

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useScatterConfig(
  suggestions: Partial<
    Pick<ScatterConfig, 'scaleType' | 'rootN' | 'xScaleType' | 'yScaleType'>
  > = {},
): ScatterConfig {
  const config = useStore(useContext(StoreContext));

  const [scaleType, setScaleType] = useSuggestion(
    suggestions.scaleType,
    config.scaleType,
    config.setScaleType,
  );

  const [rootN, setRootN] = useSuggestion(
    suggestions.rootN,
    config.rootN,
    config.setRootN,
  );

  const [xScaleType, setXScaleType] = useSuggestion(
    suggestions.xScaleType,
    config.xScaleType,
    config.setXScaleType,
  );

  const [yScaleType, setYScaleType] = useSuggestion(
    suggestions.yScaleType,
    config.yScaleType,
    config.setYScaleType,
  );

  return {
    ...config,
    scaleType,
    rootN,
    xScaleType,
    yScaleType,
    setScaleType,
    setRootN,
    setXScaleType,
    setYScaleType,
  };
}
