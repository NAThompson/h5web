import { SurfaceRepresentation } from '@h5web/lib';
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { type BaseGeometryConfig, createBaseSlice } from './config';

export interface ParamSurfaceConfig extends BaseGeometryConfig {
  representation: SurfaceRepresentation;
  setRepresentation: (representation: SurfaceRepresentation) => void;

  shading: boolean;
  setShading: (shading: boolean) => void;
}

function createParamSurfaceConfigStore() {
  return createStore<ParamSurfaceConfig>()(
    persist(
      (set): ParamSurfaceConfig => ({
        ...createBaseSlice(set),

        representation: SurfaceRepresentation.Surface,
        setRepresentation: (representation) => set({ representation }),

        shading: true,
        setShading: (shading) => set({ shading }),
      }),
      {
        name: 'h5web:paramSurface',
        version: 1,
        partialize: ({ customDomain, ...state }) => state,
      },
    ),
  );
}

const ParamSurfaceStoreContext = createContext(
  {} as StoreApi<ParamSurfaceConfig>,
);

export function ParamSurfaceConfigProvider(props: PropsWithChildren) {
  const { children } = props;
  const [store] = useState(createParamSurfaceConfigStore);
  return (
    <ParamSurfaceStoreContext value={store}>
      {children}
    </ParamSurfaceStoreContext>
  );
}

export function useParamSurfaceConfig(): ParamSurfaceConfig {
  return useStore(useContext(ParamSurfaceStoreContext));
}
