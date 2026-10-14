import { CurveType, type CustomDomain } from '@h5web/lib';
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

export enum LineWidth {
  Thin = 'thin',
  Medium = 'medium',
  Thick = 'thick',
  ExtraThick = 'extra-thick',
}

export const LINE_WIDTH_PX: Record<LineWidth, number> = {
  [LineWidth.Thin]: 1,
  [LineWidth.Medium]: 2,
  [LineWidth.Thick]: 3,
  [LineWidth.ExtraThick]: 5,
};

export interface BaseGeometryConfig {
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

  showGrid: boolean;
  setShowGrid: (showGrid: boolean) => void;
}

export interface CurveConfig extends BaseGeometryConfig {
  curveType: CurveType;
  setCurveType: (curveType: CurveType) => void;

  lineWidth: LineWidth;
  setLineWidth: (lineWidth: LineWidth) => void;
}

export function createBaseSlice(
  set: (partial: Partial<BaseGeometryConfig>) => void,
): BaseGeometryConfig {
  return {
    customDomain: [null, null],
    setCustomDomain: (customDomain) => set({ customDomain }),

    colorMap: 'Viridis',
    setColorMap: (colorMap) => set({ colorMap }),

    invertColorMap: false,
    setInvertColorMap: (invertColorMap) => set({ invertColorMap }),

    scaleType: ScaleType.Linear,
    setScaleType: (scaleType) => set({ scaleType }),

    keepRatio: true, // geometry is usually best seen undistorted
    setKeepRatio: (keepRatio) => set({ keepRatio }),

    showGrid: true,
    setShowGrid: (showGrid) => set({ showGrid }),
  };
}

function createCurveConfigStore() {
  return createStore<CurveConfig>()(
    persist(
      (set): CurveConfig => ({
        ...createBaseSlice(set),

        curveType: CurveType.LineOnly,
        setCurveType: (curveType) => set({ curveType }),

        lineWidth: LineWidth.Medium,
        setLineWidth: (lineWidth) => set({ lineWidth }),
      }),
      {
        name: 'h5web:curve3d',
        version: 1,
        partialize: ({ customDomain, ...state }) => state, // domain is specific to each dataset
      },
    ),
  );
}

const CurveStoreContext = createContext({} as StoreApi<CurveConfig>);

export function CurveConfigProvider(props: PropsWithChildren) {
  const { children } = props;
  const [store] = useState(createCurveConfigStore);
  return <CurveStoreContext value={store}>{children}</CurveStoreContext>;
}

export function useCurveConfig(): CurveConfig {
  return useStore(useContext(CurveStoreContext));
}
