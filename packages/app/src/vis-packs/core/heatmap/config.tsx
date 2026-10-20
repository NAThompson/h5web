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

import { useSuggestions } from '../hooks';
import {
  type ColorOrRootScaleType,
  DEFAULT_ROOT_N,
  migrateSqrtToRoot,
} from '../utils';
import { type ColorMap, ContourColorMode, ContourMode } from './models';

export interface HeatmapConfig {
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

  /* Height scale of complex 3D surfaces: log by default, so zeros and poles show as
   * funnels and spikes instead of flattening the rest of the landscape */
  surfaceScaleType: ColorScaleType;
  setSurfaceScaleType: (surfaceScaleType: ColorScaleType) => void;

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

  /* Levels drawn emphasized (e.g. 0: nodal lines), whatever the contour mode */
  contourEmphasis: number[];
  setContourEmphasis: (contourEmphasis: number[]) => void;

  /* Click a pixel of a stack to plot its values along a sliced dimension */
  probe: boolean;
  setProbe: (probe: boolean) => void;
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

        rootN: DEFAULT_ROOT_N,
        setRootN: (rootN) => set({ rootN }),

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

        surfaceScaleType: ScaleType.Log,
        setSurfaceScaleType: (surfaceScaleType) => set({ surfaceScaleType }),

        surfaceComplexVisType: ComplexVisType.PhaseAmplitude,
        setSurfaceComplexVisType: (surfaceComplexVisType) =>
          set({ surfaceComplexVisType }),

        surfaceCustomDomain: [null, null],
        setSurfaceCustomDomain: (surfaceCustomDomain) =>
          set({ surfaceCustomDomain }),

        phaseColorMap: 'Twilight',
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

        contourEmphasis: [],
        setContourEmphasis: (contourEmphasis) => set({ contourEmphasis }),

        probe: false,
        setProbe: (probe) => set({ probe }),
      }),
      {
        name: 'h5web:heatmap',
        version: 14,
        // v13: HSL (not perceptually uniform) was the default phase colour map; use Twilight
        // v14: Root replaces Sqrt in the toolbar
        migrate: (persisted) => {
          const state = persisted as Record<string, unknown>;
          if (state.phaseColorMap === 'HSL') {
            state.phaseColorMap = 'Twilight';
          }
          return migrateSqrtToRoot(state);
        },
        // 3D mode and probe are opt-in for the session: not restored after a reload
        // Custom and emphasized contour levels are dataset-specific: don't restore them either
        // Custom domain of complex surfaces is dataset-specific
        partialize: ({
          surface,
          contourLevels,
          contourEmphasis,
          probe,
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

export type HeatmapSuggestions = Partial<Omit<HeatmapConfig, `set${string}`>>;

export function useHeatmapConfig(
  suggestions: HeatmapSuggestions = {},
): HeatmapConfig {
  const config = useStore(useContext(StoreContext));

  /* Surfaces keep their ratio when axes share a unit, not when units differ; without units,
   * the stored setting applies (off by default, so surfaces of unrelated axes aren't slivers) */
  return useSuggestions(config, {
    ...suggestions,
    surfaceKeepRatio: suggestions.surfaceKeepRatio ?? suggestions.keepRatio,
  });
}
