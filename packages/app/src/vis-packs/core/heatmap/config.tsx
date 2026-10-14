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

  /* Keep ratio of 3D surfaces, separate from 2D: surfaces of axes in unrelated units are
   * unreadable slivers when their ratio is kept (e.g. Re(s) in [-2, 4] vs. Im(s) in [-5, 40]) */
  surfaceKeepRatio: boolean;
  setSurfaceKeepRatio: (surfaceKeepRatio: boolean) => void;

  /* What height and colour show on 3D surfaces of complex values, separate from 2D:
   * phase & amplitude = height |f|, colour arg f (default); amplitude = both |f|; phase = both arg f */
  surfaceComplexVisType: ComplexHeatmapVisType;
  setSurfaceComplexVisType: (
    surfaceComplexVisType: ComplexHeatmapVisType,
  ) => void;

  /* Domain of the height of 3D surfaces of complex values, which may not show the same
   * quantity as the 2D heatmap (e.g. amplitude in 3D, phase in 2D) */
  surfaceCustomDomain: CustomDomain;
  setSurfaceCustomDomain: (surfaceCustomDomain: CustomDomain) => void;

  /* Cyclic colour map for the phase of complex values, in 2D and 3D */
  phaseColorMap: ColorMap;
  setPhaseColorMap: (phaseColorMap: ColorMap) => void;

  invertPhaseColorMap: boolean;
  setInvertPhaseColorMap: (invertPhaseColorMap: boolean) => void;

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

        surfaceKeepRatio: false,
        setSurfaceKeepRatio: (surfaceKeepRatio) => set({ surfaceKeepRatio }),

        surfaceComplexVisType: ComplexVisType.PhaseAmplitude,
        setSurfaceComplexVisType: (surfaceComplexVisType) =>
          set({ surfaceComplexVisType }),

        surfaceCustomDomain: [null, null],
        setSurfaceCustomDomain: (surfaceCustomDomain) =>
          set({ surfaceCustomDomain }),

        phaseColorMap: 'HSL',
        setPhaseColorMap: (phaseColorMap) => set({ phaseColorMap }),

        invertPhaseColorMap: false,
        setInvertPhaseColorMap: (invertPhaseColorMap) =>
          set({ invertPhaseColorMap }),

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
        // Custom domain of complex surfaces is dataset-specific
        partialize: ({
          surface,
          contourLevels,
          surfaceCustomDomain,
          ...state
        }) => state,
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

  /* Surfaces keep their ratio when axes share a unit, not when units differ; without units,
   * the stored setting applies (off by default, so surfaces of unrelated axes aren't slivers) */
  const [surfaceKeepRatio, setSurfaceKeepRatio] = useSuggestion(
    suggestions.keepRatio,
    config.surfaceKeepRatio,
    config.setSurfaceKeepRatio,
  );

  return {
    ...config,
    scaleType,
    keepRatio,
    surfaceKeepRatio,
    setScaleType,
    setKeepRatio,
    setSurfaceKeepRatio,
  };
}
