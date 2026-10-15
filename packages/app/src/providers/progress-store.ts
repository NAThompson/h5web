import { createStore, type StoreApi } from 'zustand';

import { type OnProgress } from './models';

interface ProgressState {
  ongoing: Map<string, number | undefined>;
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
      set(({ ongoing }) => {
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
  /* Suspense queries start fetching while a component renders: wait for it to finish, so that
   * progress subscribers (e.g. `ValueLoader`) are not updated while another component renders */
  await Promise.resolve();
  progressStore.getState().setProgress(queryHash, undefined);

  try {
    return await fn((value) => {
      progressStore.getState().setProgress(queryHash, value);
    });
  } finally {
    progressStore.getState().clearProgress(queryHash);
  }
}
