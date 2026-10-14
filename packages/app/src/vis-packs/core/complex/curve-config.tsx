import { CurveType } from '@h5web/lib';
import { ComplexVisType } from '@h5web/shared/vis-models';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import {
  type BaseGeometryConfig,
  createBaseSlice,
  LineWidth,
} from '../geometry/config';
import { type ColorMap } from '../heatmap/models';

export type ComplexCurveColorType =
  ComplexVisType.Amplitude | ComplexVisType.Phase;

export interface ComplexCurveConfig extends BaseGeometryConfig {
  curveType: CurveType;
  setCurveType: (curveType: CurveType) => void;

  lineWidth: LineWidth;
  setLineWidth: (lineWidth: LineWidth) => void;

  /* Colour curve by amplitude or by phase of the complex values */
  colorBy: ComplexCurveColorType;
  setColorBy: (colorBy: ComplexCurveColorType) => void;

  /* Cyclic colour map used when colouring by phase */
  phaseColorMap: ColorMap;
  setPhaseColorMap: (phaseColorMap: ColorMap) => void;
}

function createComplexCurveConfigStore() {
  return createStore<ComplexCurveConfig>()(
    persist(
      (set): ComplexCurveConfig => ({
        ...createBaseSlice(set),

        // Abscissa and real/imaginary parts usually have unrelated extents (e.g. t in [0, 60] vs. ±3)
        keepRatio: false,

        curveType: CurveType.LineOnly,
        setCurveType: (curveType) => set({ curveType }),

        lineWidth: LineWidth.Medium,
        setLineWidth: (lineWidth) => set({ lineWidth }),

        colorBy: ComplexVisType.Phase,
        setColorBy: (colorBy) => set({ colorBy }),

        phaseColorMap: 'HSL',
        setPhaseColorMap: (phaseColorMap) => set({ phaseColorMap }),
      }),
      {
        name: 'h5web:complexCurve',
        version: 1,
        partialize: ({ customDomain, ...state }) => state, // domain is specific to each dataset
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<ComplexCurveConfig>);

export function ComplexCurveConfigProvider(props: PropsWithChildren) {
  const { children } = props;
  const [store] = useState(createComplexCurveConfigStore);
  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useComplexCurveConfig(): ComplexCurveConfig {
  return useStore(useContext(StoreContext));
}
