import { type DimensionMapping, getSliceSelection } from '@h5web/lib';
import { isDefined } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { useUnmountEffect } from '@react-hookz/web';
import { hashKey, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';

import {
  type DataContextValue,
  useDataContext,
} from '../providers/DataProvider';
import { getValueSize, MAX_AUTO_FETCH_SIZE } from './utils';

export interface PrefetchLimits {
  maxPrefetchSize: number; // max size of slices fetched ahead of the current one (the next slice is always fetched)
  maxCacheSize: number; // max size of slices kept in cache after being fetched for playback
}

const DEFAULT_LIMITS: PrefetchLimits = {
  maxPrefetchSize: 64e6, // bytes
  maxCacheSize: 256e6, // bytes
};

interface TrackedQuery {
  queryKey: QueryKey;
  size: number;
}

export interface PrefetchState {
  wanted: Map<string, QueryKey>; // slices currently requested ahead of playback
  fetched: Map<string, TrackedQuery>; // slices fetched for playback, least recently used first
}

export function createPrefetchState(): PrefetchState {
  return { wanted: new Map(), fetched: new Map() };
}

/* Returns a function to pass to `DimensionMapper`'s `prefetchSlices` prop (cf. `prefetchSlices`) */
export function useSlicePrefetcher(
  ...datasets: (Dataset<ScalarShape | ArrayShape> | undefined)[]
): (nextMappings: DimensionMapping[]) => void {
  const dataContext = useDataContext();
  const [state] = useState(createPrefetchState);

  useUnmountEffect(() => {
    prefetchSlices(dataContext, state, [], []); // cancel pending prefetches
  });

  const definedDatasets = datasets.filter(isDefined);

  return (nextMappings) => {
    prefetchSlices(dataContext, state, definedDatasets, nextMappings);
  };
}

/* Fetch upcoming slices of the given datasets ahead of playback, cancel prefetches that are no
 * longer needed, and evict slices fetched for playback once they take up too much memory.
 * Called repeatedly during playback, so it must be cheap and idempotent. */
export function prefetchSlices(
  dataContext: DataContextValue,
  state: PrefetchState,
  datasets: Dataset<ScalarShape | ArrayShape>[],
  nextMappings: DimensionMapping[],
  limits = DEFAULT_LIMITS,
): void {
  const { queries, queryClient } = dataContext;
  const queryCache = queryClient.getQueryCache();
  const wanted = new Map<string, QueryKey>();

  let totalSize = 0;
  for (const [index, mapping] of nextMappings.entries()) {
    const selection = getSliceSelection(mapping);
    const sliceSize = datasets.reduce(
      (acc, dataset) => acc + getValueSize(dataset, selection),
      0,
    );

    if (index > 0 && totalSize + sliceSize > limits.maxPrefetchSize) {
      break;
    }
    totalSize += sliceSize;

    if (!isSizeAllowed(dataContext, datasets, selection, sliceSize)) {
      break; // let `LargeValueGuard` ask for confirmation first (all slices have the same size)
    }

    for (const dataset of datasets) {
      const options = queries.value(dataset, selection);
      const hash = hashKey(options.queryKey);
      wanted.set(hash, options.queryKey);

      const query = queryCache.get(hash);
      if (query?.state.data !== undefined) {
        touch(state.fetched, hash); // keep most recently played slices in cache
        continue;
      }

      if (query?.state.status === 'error') {
        continue; // don't retry on every call; the vis shows the error once playback reaches the slice
      }

      state.fetched.delete(hash);
      state.fetched.set(hash, {
        queryKey: options.queryKey,
        size: getValueSize(dataset, selection),
      });
      void ignoreErrors(queryClient.query(options));
    }
  }

  cancelUnwanted(dataContext, state, wanted);

  // Protect previously wanted slices too: one of them may have just been selected for display
  // without being observed by the vis yet
  evictPlayedSlices(
    dataContext,
    state,
    new Set([...state.wanted.keys(), ...wanted.keys()]),
    limits.maxCacheSize,
  );
  state.wanted.clear();
  for (const [hash, queryKey] of wanted) {
    state.wanted.set(hash, queryKey);
  }
}

async function ignoreErrors(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // e.g. cancellation; if the slice ends up being displayed, the vis refetches it and shows any error
  }
}

/* Slices too large to be fetched automatically can only be prefetched once slices at least as
 * large have been loaded for every dataset, i.e. after the user has confirmed fetching them */
function isSizeAllowed(
  dataContext: DataContextValue,
  datasets: Dataset<ScalarShape | ArrayShape>[],
  selection: string | undefined,
  totalSize: number,
): boolean {
  if (totalSize <= MAX_AUTO_FETCH_SIZE) {
    return true;
  }

  const { filepath, queryClient } = dataContext;
  const queryCache = queryClient.getQueryCache();

  return datasets.every((dataset) => {
    const size = getValueSize(dataset, selection);
    return queryCache
      .findAll({ queryKey: [filepath, 'value', dataset.path] })
      .some(
        ({ queryKey, state }) =>
          state.data !== undefined &&
          getValueSize(dataset, queryKey[3] as string | undefined) >= size,
      );
  });
}

function touch(fetched: Map<string, TrackedQuery>, hash: string): void {
  const entry = fetched.get(hash);
  if (entry) {
    fetched.delete(hash);
    fetched.set(hash, entry);
  }
}

/* Cancel prefetches no longer wanted, unless something else needs them (e.g. the vis) */
function cancelUnwanted(
  dataContext: DataContextValue,
  state: PrefetchState,
  wanted: Map<string, QueryKey>,
): void {
  const queryCache = dataContext.queryClient.getQueryCache();

  for (const [hash, queryKey] of state.wanted) {
    const query = queryCache.get(hash);
    if (
      !wanted.has(hash) &&
      query?.state.fetchStatus === 'fetching' &&
      query.getObserversCount() === 0
    ) {
      void dataContext.queryClient.cancelQueries({ queryKey, exact: true });
    }
  }
}

function evictPlayedSlices(
  dataContext: DataContextValue,
  state: PrefetchState,
  protectedHashes: Set<string>,
  maxCacheSize: number,
): void {
  const { queryClient } = dataContext;
  const queryCache = queryClient.getQueryCache();

  let cachedSize = 0;
  for (const [hash, { size }] of state.fetched) {
    const query = queryCache.get(hash);
    if (query?.state.status === 'success') {
      cachedSize += size;
    } else if (!query || query.state.fetchStatus === 'idle') {
      state.fetched.delete(hash); // garbage-collected, cancelled or errored
    }
  }

  for (const [hash, { queryKey, size }] of state.fetched) {
    if (cachedSize <= maxCacheSize) {
      return;
    }

    const query = queryCache.get(hash);
    if (
      !protectedHashes.has(hash) &&
      query?.state.status === 'success' &&
      query.getObserversCount() === 0
    ) {
      queryClient.removeQueries({ queryKey, exact: true });
      state.fetched.delete(hash);
      cachedSize -= size;
    }
  }
}
