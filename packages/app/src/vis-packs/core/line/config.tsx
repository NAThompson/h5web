import { CurveType, type CustomDomain, Interpolation } from '@h5web/lib';
import {
  type AxisScaleType,
  type ComplexLineVisType,
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
import { type QQDistribution } from './qq';

export interface LineConfig {
  customDomain: CustomDomain;
  setCustomDomain: (customDomain: CustomDomain) => void;

  curveType: CurveType;
  setCurveType: (type: CurveType) => void;

  showGrid: boolean;
  setShowGrid: (showGrid: boolean) => void;

  xScaleType: AxisScaleType;
  yScaleType: AxisScaleType;
  setXScaleType: (type: AxisScaleType) => void;
  setYScaleType: (type: AxisScaleType) => void;

  complexVisType: ComplexLineVisType;
  setComplexVisType: (visType: ComplexLineVisType) => void;

  showErrors: boolean;
  setShowErrors: (showErrors: boolean) => void;

  interpolation: Interpolation;
  setInterpolation: (interpolation: Interpolation) => void;

  showSpectrum: boolean; // power spectrum of the slice instead of the slice
  setShowSpectrum: (showSpectrum: boolean) => void;
  spectrumScaleType: AxisScaleType;
  setSpectrumScaleType: (type: AxisScaleType) => void;

  showQQ: boolean; // Q-Q plot of the slice instead of the slice
  setShowQQ: (showQQ: boolean) => void;
  qqDistribution: QQDistribution;
  setQQDistribution: (distribution: QQDistribution) => void;
}

// Per dataset, not in the store (see `useLineConfig`)
type StoredLineConfig = Omit<
  LineConfig,
  'showSpectrum' | 'setShowSpectrum' | 'showQQ' | 'setShowQQ'
>;

function createLineConfigStore() {
  return createStore<StoredLineConfig>()(
    persist(
      (set): StoredLineConfig => ({
        customDomain: [null, null],
        setCustomDomain: (customDomain) => set({ customDomain }),

        curveType: CurveType.LineOnly,
        setCurveType: (curveType) => set({ curveType }),

        showGrid: true,
        setShowGrid: (showGrid) => set({ showGrid }),

        xScaleType: ScaleType.Linear,
        yScaleType: ScaleType.Linear,
        setXScaleType: (xScaleType) => set({ xScaleType }),
        setYScaleType: (yScaleType) => set({ yScaleType }),

        complexVisType: ComplexVisType.Amplitude,
        setComplexVisType: (complexVisType) => set(() => ({ complexVisType })),

        showErrors: true,
        setShowErrors: (showErrors) => set({ showErrors }),

        interpolation: Interpolation.Linear,
        setInterpolation: (interpolation) => set({ interpolation }),

        spectrumScaleType: ScaleType.Log,
        setSpectrumScaleType: (spectrumScaleType) => set({ spectrumScaleType }),

        qqDistribution: 'normal',
        setQQDistribution: (qqDistribution) => set({ qqDistribution }),
      }),
      {
        name: 'h5web:line',
        version: 8,
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<StoredLineConfig>);

export function LineConfigProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createLineConfigStore);

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useLineConfig(
  suggestions: Partial<
    Pick<
      LineConfig,
      | 'xScaleType'
      | 'yScaleType'
      | 'complexVisType'
      | 'interpolation'
      | 'curveType'
      | 'showSpectrum'
      | 'spectrumScaleType'
      | 'showQQ'
      | 'qqDistribution'
    >
  > = {},
): LineConfig {
  const config = useStore(useContext(StoreContext));

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

  const [complexVisType, setComplexVisType] = useSuggestion(
    suggestions.complexVisType,
    config.complexVisType,
    config.setComplexVisType,
  );

  const [interpolation, setInterpolation] = useSuggestion(
    suggestions.interpolation,
    config.interpolation,
    config.setInterpolation,
  );

  const [curveType, setCurveType] = useSuggestion(
    suggestions.curveType,
    config.curveType,
    config.setCurveType,
  );

  // Spectrum and Q-Q change what is plotted: off for each dataset (the vis remounts) unless hinted
  const [spectrumState, setSpectrumState] = useState(false);
  const [showSpectrum, setShowSpectrum] = useSuggestion(
    suggestions.showSpectrum,
    spectrumState,
    setSpectrumState,
  );

  const [spectrumScaleType, setSpectrumScaleType] = useSuggestion(
    suggestions.spectrumScaleType,
    config.spectrumScaleType,
    config.setSpectrumScaleType,
  );

  const [qqState, setQQState] = useState(false);
  const [showQQ, setShowQQ] = useSuggestion(
    suggestions.showQQ,
    qqState,
    setQQState,
  );

  const [qqDistribution, setQQDistribution] = useSuggestion(
    suggestions.qqDistribution,
    config.qqDistribution,
    config.setQQDistribution,
  );

  return {
    ...config,
    showQQ,
    qqDistribution,
    setShowQQ,
    setQQDistribution,
    showSpectrum,
    spectrumScaleType,
    setShowSpectrum,
    setSpectrumScaleType,
    xScaleType,
    yScaleType,
    complexVisType,
    interpolation,
    curveType,
    setXScaleType,
    setYScaleType,
    setComplexVisType,
    setInterpolation,
    setCurveType,
  };
}
