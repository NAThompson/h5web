import { createStore, type StoreApi } from 'zustand';

import { type OnProgress } from './models';

interface ProgressState {
  ongoing: Map<string, number | undefined>; // fetches that reported progress (none yet: indeterminate)
  setProgress: (queryHash: string, value: number | undefined) => void;
  clearProgress: (queryHash: string) => void;
}

export type ProgressStore = StoreApi<ProgressState>;

export function createProgressStore(): ProgressStore {
  return createStore<ProgressState>((set): ProgressState => ({
    ongoing: new Map(),
    setProgress: (queryHash, value) => {
      set(({ ongoing }) => {
        const next = new Map(ongoing);
        next.set(queryHash, value);
        return { ongoing: next };
      });
    },
    clearProgress: (queryHash) =>
      set((state) => {
        const { ongoing } = state;
        if (!ongoing.has(queryHash)) {
          return state; // unchanged: subscribers not notified
        }
        const next = new Map(ongoing);
        next.delete(queryHash);
        return { ongoing: next };
      }),
  }));
}

export async function trackProgress<TResult>(
  progressStore: ProgressStore,
  queryHash: string,
  fn: (onProgress: OnProgress) => Promise<TResult>,
): Promise<TResult> {
  /* No entry until progress is reported: suspense queries start fetching while a component
   * renders, when updating subscribers (e.g. `ValueLoader`) isn't allowed */
  try {
    return await fn((value) => {
      progressStore.getState().setProgress(queryHash, value);
    });
  } finally {
    progressStore.getState().clearProgress(queryHash);
  }
}
