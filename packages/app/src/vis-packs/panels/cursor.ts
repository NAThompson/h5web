import { createContext, useContext, useSyncExternalStore } from 'react';

/* Data coordinates under the pointer in one of the panels, shown in all panels with the same axes */
export interface Cursor {
  x: number;
  y: number;
  linkKey: string; // of the panel under the pointer
  source: string; // key of that panel
  title: string; // of that panel
  value?: number; // of that panel at the cursor
}

export interface CursorStore {
  get: () => Cursor | undefined;
  set: (cursor: Cursor | undefined) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createCursorStore(): CursorStore {
  let cursor: Cursor | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => cursor,
    set: (next) => {
      if (next !== cursor) {
        cursor = next;
        for (const listener of listeners) {
          listener();
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const CursorContext = createContext<CursorStore | undefined>(undefined);

export function useCursor(store: CursorStore): Cursor | undefined {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function useCursorStore(): CursorStore | undefined {
  return useContext(CursorContext);
}
