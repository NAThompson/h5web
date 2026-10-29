import {
  type CustomDomain,
  IsoColorMode,
  VolumeQuality,
  VolumeRenderMode,
} from '@h5web/lib';
import { ScaleType } from '@h5web/shared/vis-models';
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
import {
  type ColorOrRootScaleType,
  DEFAULT_ROOT_N,
  migrateSqrtToRoot,
} from '../utils';

export interface IsoLevel {
  id: number;
  value: number;
  visible: boolean;
  opacity: number;
  color: string;
}

/* Region where `min ≤ value ≤ max` (bounds optional), e.g. where a spec passes */
export interface PassRegion {
  enabled: boolean;
  min: number | null;
  max: number | null;
  color: string;
  invert: boolean; // show where it fails instead
}

export const DEFAULT_PASS_REGION: PassRegion = {
  enabled: false,
  min: null,
  max: null,
  color: '#57cc99',
  invert: false,
};

const ISO_COLORS = ['#4cc9f0', '#f72585', '#90be6d', '#f9c74f', '#b388ff'];

export interface VolumeConfig {
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

  mode: VolumeRenderMode;
  setMode: (mode: VolumeRenderMode) => void;

  opacity: number;
  setOpacity: (opacity: number) => void;

  threshold: number;
  setThreshold: (threshold: number) => void;

  quality: VolumeQuality;
  setQuality: (quality: VolumeQuality) => void;

  showVolume: boolean;
  setShowVolume: (showVolume: boolean) => void;

  isoLevels: IsoLevel[];
  addIsoLevel: (value: number) => void;
  updateIsoLevel: (id: number, update: Partial<Omit<IsoLevel, 'id'>>) => void;
  removeIsoLevel: (id: number) => void;
  setIsoLevels: (isoLevels: IsoLevel[]) => void;

  isoColorMode: IsoColorMode;
  setIsoColorMode: (isoColorMode: IsoColorMode) => void;

  passRegion: PassRegion;
  setPassRegion: (passRegion: PassRegion) => void;
}

function createVolumeConfigStore() {
  return createStore<VolumeConfig>()(
    persist(
      (set): VolumeConfig => ({
        customDomain: [null, null],
        setCustomDomain: (customDomain) => set({ customDomain }),

        colorMap: 'Inferno',
        setColorMap: (colorMap) => set({ colorMap }),

        invertColorMap: false,
        setInvertColorMap: (invertColorMap) => set({ invertColorMap }),

        scaleType: ScaleType.Linear,
        setScaleType: (scaleType) => set({ scaleType }),

        rootN: DEFAULT_ROOT_N,
        setRootN: (rootN) => set({ rootN }),

        mode: VolumeRenderMode.DVR,
        setMode: (mode) => set({ mode }),

        opacity: 0.25,
        setOpacity: (opacity) => set({ opacity }),

        threshold: 0.1,
        setThreshold: (threshold) => set({ threshold }),

        quality: VolumeQuality.Medium,
        setQuality: (quality) => set({ quality }),

        showVolume: true,
        setShowVolume: (showVolume) => set({ showVolume }),

        isoLevels: [],
        setIsoLevels: (isoLevels) => set({ isoLevels }),
        addIsoLevel: (value) =>
          set(({ isoLevels }) => {
            const id = Math.max(0, ...isoLevels.map((level) => level.id)) + 1;
            const color = ISO_COLORS[(id - 1) % ISO_COLORS.length];
            return {
              isoLevels: [
                ...isoLevels,
                { id, value, visible: true, opacity: 1, color },
              ],
            };
          }),
        updateIsoLevel: (id, update) =>
          set(({ isoLevels }) => ({
            isoLevels: isoLevels.map((level) =>
              level.id === id ? { ...level, ...update } : level,
            ),
          })),
        removeIsoLevel: (id) =>
          set(({ isoLevels }) => ({
            isoLevels: isoLevels.filter((level) => level.id !== id),
          })),

        isoColorMode: IsoColorMode.Solid,
        setIsoColorMode: (isoColorMode) => set({ isoColorMode }),

        passRegion: DEFAULT_PASS_REGION,
        setPassRegion: (passRegion) => set({ passRegion }),
      }),
      {
        name: 'h5web:volume',
        version: 2,
        migrate: migrateSqrtToRoot, // v2: Root replaces Sqrt in the toolbar
        // Iso levels depend on the dataset, so don't restore them after a reload, nor a hidden
        // volume (which, without levels, would leave an empty canvas), nor pass region bounds
        partialize: ({ isoLevels, showVolume, passRegion, ...state }) => ({
          ...state,
          passRegion: { ...passRegion, enabled: false, min: null, max: null },
        }),
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<VolumeConfig>);

export function VolumeConfigProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createVolumeConfigStore);

  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useVolumeConfig(
  suggestions: Partial<VolumeConfig> = {},
): VolumeConfig {
  const config = useStore(useContext(StoreContext));
  const { passRegion: hinted } = suggestions;

  // e.g. NeXus `SILX_style` signal scale type, or a file's `H5WEB_*` view hint (pass region bounds,
  // with the stored color and inversion)
  return useSuggestions(config, {
    ...suggestions,
    passRegion: hinted && {
      ...config.passRegion,
      enabled: hinted.enabled,
      min: hinted.min,
      max: hinted.max,
    },
  });
}

/* Iso levels suggested for the dataset (e.g. by a file's `H5WEB_*` view hint): shown in place of
 * the stored ones, without touching the store, until the user edits them - they are then
 * committed to the store and edited there */
export function useSuggestedIsoLevels(
  config: VolumeConfig,
  values: number[] | undefined,
): VolumeConfig {
  const [isTouched, setTouched] = useState(false);
  if (!values || isTouched) {
    return config;
  }

  const isoLevels = values.map((value, i) => ({
    id: i + 1,
    value,
    visible: true,
    opacity: 1,
    color: ISO_COLORS[i % ISO_COLORS.length],
  }));

  function commit(): void {
    config.setIsoLevels(isoLevels);
    setTouched(true);
  }

  return {
    ...config,
    isoLevels,
    addIsoLevel: (value) => {
      commit();
      config.addIsoLevel(value);
    },
    updateIsoLevel: (id, update) => {
      commit();
      config.updateIsoLevel(id, update);
    },
    removeIsoLevel: (id) => {
      commit();
      config.removeIsoLevel(id);
    },
    setIsoLevels: (levels) => {
      setTouched(true);
      config.setIsoLevels(levels);
    },
  };
}
