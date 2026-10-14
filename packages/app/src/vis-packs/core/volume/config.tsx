import {
  type CustomDomain,
  IsoColorMode,
  VolumeQuality,
  VolumeRenderMode,
} from '@h5web/lib';
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

export interface IsoLevel {
  id: number;
  value: number;
  visible: boolean;
  opacity: number;
  color: string;
}

const ISO_COLORS = ['#4cc9f0', '#f72585', '#90be6d', '#f9c74f', '#b388ff'];

export interface VolumeConfig {
  customDomain: CustomDomain;
  setCustomDomain: (customDomain: CustomDomain) => void;

  colorMap: ColorMap;
  setColorMap: (colorMap: ColorMap) => void;

  invertColorMap: boolean;
  setInvertColorMap: (invertColorMap: boolean) => void;

  scaleType: ColorScaleType;
  setScaleType: (scaleType: ColorScaleType) => void;

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

  isoColorMode: IsoColorMode;
  setIsoColorMode: (isoColorMode: IsoColorMode) => void;
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
      }),
      {
        name: 'h5web:volume',
        version: 1,
        // Iso levels depend on the dataset, so don't restore them after a reload
        partialize: ({ isoLevels, ...state }) => state,
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

export function useVolumeConfig(): VolumeConfig {
  return useStore(useContext(StoreContext));
}
