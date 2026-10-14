import { type DimensionMapping, getSliceSelection } from '@h5web/lib';
import { isDefined } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { useUnmountEffect } from '@react-hookz/web';
import { hashKey, type QueryKey } from '@tanstack/react-query';
import { useRef } from 'react';

import {
  type DataContextValue,
  useDataContext,
} from '../providers/DataProvider';
import { getValueSize } from './utils';

// Max size of slices fetched ahead of the current one (the next slice is always fetched)
export const MAX_PREFETCH_SIZE = 64e6; // bytes

// Max size of slices kept in cache after being fetched for playback
export const MAX_PLAYBACK_CACHE_SIZE = 256e6; // bytes

interface TrackedQuery {
  queryKey: QueryKey;
  size: number;
}

interface PrefetchState {
  wanted: Map<string, QueryKey>; // slices currently requested ahead of playback
  fetched: Map<string, TrackedQuery>; // slices fetched for playback, least recently used first
}

/* Returns a function to pass to `DimensionMapper`'s `prefetchSlices` prop (called repeatedly
 * during playback, so it must be cheap and idempotent). Fetches upcoming
 * slices of the given datasets ahead of playback, cancels prefetches that are no longer
 * needed, and evicts slices fetched for playback once they take up too much memory. */
export function useSlicePrefetcher(
  ...datasets: (Dataset<ScalarShape | ArrayShape> | undefined)[]
): (nextMappings: DimensionMapping[]) => void {
  const dataContext = useDataContext();
  const stateRef = useRef<PrefetchState>({
    wanted: new Map(),
    fetched: new Map(),
  });

  useUnmountEffect(() => {
    cancelUnwanted(dataContext, stateRef.current, new Map());
    stateRef.current.wanted = new Map();
  });

  const definedDatasets = datasets.filter(isDefined);

  return (nextMappings) => {
    const { queries, queryClient } = dataContext;
    const state = stateRef.current;
    const wanted = new Map<string, QueryKey>();

    let totalSize = 0;
    for (const [index, mapping] of nextMappings.entries()) {
      const selection = getSliceSelection(mapping);
      const sliceSize = definedDatasets.reduce(
        (acc, dataset) => acc + getValueSize(dataset, selection),
        0,
      );

      if (index > 0 && totalSize + sliceSize > MAX_PREFETCH_SIZE) {
        break;
      }
      totalSize += sliceSize;

      for (const dataset of definedDatasets) {
        const options = queries.value(dataset, selection);
        const hash = hashKey(options.queryKey);
        wanted.set(hash, options.queryKey);

        const query = queryClient.getQueryCache().get(hash);
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
    state.wanted = wanted;
    evictPlayedSlices(dataContext, state);
  };
}

async function ignoreErrors(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // e.g. cancellation; if the slice ends up being displayed, the vis refetches it and shows any error
  }
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
    if (cachedSize <= MAX_PLAYBACK_CACHE_SIZE) {
      return;
    }

    const query = queryCache.get(hash);
    if (
      !state.wanted.has(hash) &&
      query?.state.status === 'success' &&
      query.getObserversCount() === 0
    ) {
      queryClient.removeQueries({ queryKey, exact: true });
      state.fetched.delete(hash);
      cachedSize -= size;
    }
  }
}
