import { type CustomDomain } from '@h5web/lib';
import {
  type ColorScaleType,
  type ComplexHeatmapVisType,
  ComplexVisType,
  ScaleType,
} from '@h5web/shared/vis-models';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { useSuggestion } from '../hooks';
import { type ColorMap, ContourColorMode, ContourMode } from './models';

export interface HeatmapConfig {
  customDomain: CustomDomain;
  setCustomDomain: (customDomain: CustomDomain) => void;

  colorMap: ColorMap;
  setColorMap: (colorMap: ColorMap) => void;

  invertColorMap: boolean;
  setInvertColorMap: (invertColorMap: boolean) => void;

  scaleType: ColorScaleType;
  setScaleType: (scaleType: ColorScaleType) => void;

  complexVisType: ComplexHeatmapVisType;
  setComplexVisType: (complexVisType: ComplexHeatmapVisType) => void;

  showGrid: boolean;
  setShowGrid: (showGrid: boolean) => void;

  keepRatio: boolean;
  setKeepRatio: (keepRatio: boolean) => void;

  flipXAxis: boolean;
  setFlipXAxis: (flipXAxis: boolean) => void;

  flipYAxis: boolean;
  setFlipYAxis: (flipYAxis: boolean) => void;

  surface: boolean;
  setSurface: (surface: boolean) => void;

  heightScale: number;
  setHeightScale: (heightScale: number) => void;

  shading: boolean;
  setShading: (shading: boolean) => void;

  /* Cyclic colour map for the phase of complex values on 3D surfaces */
  phaseColorMap: ColorMap;
  setPhaseColorMap: (phaseColorMap: ColorMap) => void;

  contourMode: ContourMode;
  setContourMode: (contourMode: ContourMode) => void;

  contourCount: number;
  setContourCount: (contourCount: number) => void;

  /* Custom levels only apply to the dataset they were entered for */
  contourLevels: { path: string; levels: number[] } | undefined;
  setContourLevels: (path: string, levels: number[]) => void;

  contourColorMode: ContourColorMode;
  setContourColorMode: (contourColorMode: ContourColorMode) => void;

  contourColor: string;
  setContourColor: (contourColor: string) => void;

  contourLabels: boolean;
  setContourLabels: (contourLabels: boolean) => void;
}

function createHeatmapConfigStore() {
  return createStore<HeatmapConfig>()(
    persist(
      (set): HeatmapConfig => ({
        customDomain: [null, null],
        setCustomDomain: (customDomain) => set({ customDomain }),

        colorMap: 'Viridis',
        setColorMap: (colorMap) => set({ colorMap }),

        invertColorMap: false,
        setInvertColorMap: (invertColorMap) => set({ invertColorMap }),

        scaleType: ScaleType.Linear,
        setScaleType: (scaleType) => set(() => ({ scaleType })),

        complexVisType: ComplexVisType.Amplitude,
        setComplexVisType: (complexVisType) => set(() => ({ complexVisType })),

        showGrid: true,
        setShowGrid: (showGrid) => set({ showGrid }),

        keepRatio: true,
        setKeepRatio: (keepRatio) => set({ keepRatio }),

        flipYAxis: false,
        setFlipYAxis: (flipYAxis) => set({ flipYAxis }),

        flipXAxis: false,
        setFlipXAxis: (flipXAxis) => set({ flipXAxis }),

        surface: false,
        setSurface: (surface) => set({ surface }),

        heightScale: 0.5,
        setHeightScale: (heightScale) => set({ heightScale }),

        shading: true,
        setShading: (shading) => set({ shading }),

        phaseColorMap: 'HSL',
        setPhaseColorMap: (phaseColorMap) => set({ phaseColorMap }),

        contourMode: ContourMode.Off,
        setContourMode: (contourMode) => set({ contourMode }),

        contourCount: 8,
        setContourCount: (contourCount) => set({ contourCount }),

        contourLevels: undefined,
        setContourLevels: (path, levels) =>
          set({ contourLevels: { path, levels } }),

        contourColorMode: ContourColorMode.Single,
        setContourColorMode: (contourColorMode) => set({ contourColorMode }),

        contourColor: '#ffffff',
        setContourColor: (contourColor) => set({ contourColor }),

        contourLabels: false,
        setContourLabels: (contourLabels) => set({ contourLabels }),
      }),
      {
        name: 'h5web:heatmap',
        version: 12,
        // 3D mode is opt-in for the session: don't open datasets in 3D after a reload
        // Custom contour levels are dataset-specific: don't restore them after a reload either
        partialize: ({ surface, contourLevels, ...state }) => state,
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<HeatmapConfig>);

export function HeatmapConfigProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createHeatmapConfigStore);

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useHeatmapConfig(
  suggestions: Partial<Pick<HeatmapConfig, 'scaleType' | 'keepRatio'>> = {},
): HeatmapConfig {
  const config = useStore(useContext(StoreContext));

  const [scaleType, setScaleType] = useSuggestion(
    suggestions.scaleType,
    config.scaleType,
    config.setScaleType,
  );

  const [keepRatio, setKeepRatio] = useSuggestion(
    suggestions.keepRatio,
    config.keepRatio,
    config.setKeepRatio,
  );

  return { ...config, scaleType, keepRatio, setScaleType, setKeepRatio };
}
