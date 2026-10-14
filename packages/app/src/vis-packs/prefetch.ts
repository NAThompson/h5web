import {
  hashKey,
  type Query,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { type DataContextValue } from '../providers/DataProvider';
import { type ValueQueryParams } from '../providers/models';
import { isValueInCache } from '../utils';
import { getSizeToConfirm } from './LargeValueGuard';
import { getValueSize } from './utils';

/* Hashes of queries created for playback, so their errors are kept in cache until playback
 * stops (tracked separately from query options, which observers overwrite) */
const playbackQueries = new WeakMap<QueryClient, Set<string>>();

function getPlaybackQueries(queryClient: QueryClient): Set<string> {
  let hashes = playbackQueries.get(queryClient);
  if (!hashes) {
    hashes = new Set();
    playbackQueries.set(queryClient, hashes);
  }
  return hashes;
}

/* Flag a query as made for playback (e.g. values of a whole sequence, to get its range) */
export function trackPlaybackQuery(
  queryClient: QueryClient,
  queryKey: QueryKey,
): void {
  getPlaybackQueries(queryClient).add(hashKey(queryKey));
}

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
  wanted: Map<string, QueryKey>; // values currently requested ahead of playback
  fetched: Map<string, TrackedQuery>; // values fetched for playback, least recently used first
  current: Set<string>; // values of the current slice
}

export function createPrefetchState(): PrefetchState {
  return { wanted: new Map(), fetched: new Map(), current: new Set() };
}

export function isPlaybackQuery(
  queryClient: QueryClient,
  query: Query,
): boolean {
  return getPlaybackQueries(queryClient).has(query.queryHash);
}

/* Fetch the values of upcoming slices ahead of playback, cancel prefetches that are no longer
 * needed, and evict values fetched for playback once they take up too much memory. Each slice
 * is given as the list of values the vis fetches to display it. Slices that `LargeValueGuard`
 * would ask confirmation for (given `maxAutoFetchSize`) are not fetched; returns `false` if this
 * is the case of the next slice. Called repeatedly during playback, so must be cheap and
 * idempotent; called with no upcoming slices once playback stops. */
export function prefetchSlices(
  dataContext: DataContextValue,
  state: PrefetchState,
  upcoming: ValueQueryParams[][],
  current: ValueQueryParams[],
  maxAutoFetchSize: number,
  limits = DEFAULT_LIMITS,
): boolean {
  const { queries, queryClient } = dataContext;
  const queryCache = queryClient.getQueryCache();
  const wanted = new Map<string, QueryKey>();

  state.current.clear();
  for (const { dataset, selection } of current) {
    state.current.add(hashKey(queries.value(dataset, selection).queryKey));
  }

  let isNextAllowed = true;
  let totalSize = 0;
  for (const [index, requests] of upcoming.entries()) {
    const uncached = requests.filter(
      ({ dataset, selection }) =>
        !isValueInCache(dataContext, dataset, selection),
    );
    const sliceSize = uncached.reduce(
      (acc, { dataset, selection }) => acc + getValueSize(dataset, selection),
      0,
    );

    if (index > 0 && totalSize + sliceSize > limits.maxPrefetchSize) {
      break;
    }
    totalSize += sliceSize;

    if (getSizeToConfirm(dataContext, requests, maxAutoFetchSize) > 0) {
      isNextAllowed = index > 0;
      break; // let `LargeValueGuard` ask for confirmation first
    }

    for (const { dataset, selection } of requests) {
      const options = queries.value(dataset, selection);
      const hash = hashKey(options.queryKey);
      wanted.set(hash, options.queryKey);

      const query = queryCache.get(hash);
      if (query?.state.data !== undefined) {
        touch(state.fetched, hash); // keep most recently played slices in cache
        continue;
      }

      if (query?.state.status === 'error') {
        continue; // don't retry: the vis shows the error once playback reaches the slice
      }

      state.fetched.delete(hash);
      state.fetched.set(hash, {
        queryKey: options.queryKey,
        size: getValueSize(dataset, selection),
      });

      if (query?.state.fetchStatus !== 'fetching') {
        if (!query) {
          getPlaybackQueries(queryClient).add(hash);
        }
        void ignoreErrors(queryClient.query(options));
      }
    }
  }

  cancelUnwanted(dataContext, state, wanted);

  // Protect previously wanted values too: one of them may have just been selected for display
  // without being observed by the vis yet
  evictPlayedValues(
    dataContext,
    state,
    new Set([...state.wanted.keys(), ...wanted.keys(), ...state.current]),
    limits.maxCacheSize,
  );

  state.wanted.clear();
  for (const [hash, queryKey] of wanted) {
    state.wanted.set(hash, queryKey);
  }

  if (upcoming.length === 0) {
    removeFailedPlaybackQueries(dataContext); // so they can be retried outside of playback
  }

  return isNextAllowed;
}

/* Put values of slices in cache (e.g. split from values of a whole sequence), so they don't
 * need fetching; they are then evicted like values fetched for playback */
export function seedSlices(
  dataContext: DataContextValue,
  state: PrefetchState,
  entries: { request: ValueQueryParams; value: unknown }[],
  limits = DEFAULT_LIMITS,
): void {
  const { queries, queryClient } = dataContext;

  for (const { request, value } of entries) {
    const { queryKey } = queries.value(request.dataset, request.selection);
    if (queryClient.getQueryData(queryKey) !== undefined) {
      continue;
    }

    const hash = hashKey(queryKey);
    queryClient.setQueryData(queryKey, value);
    state.fetched.delete(hash);
    state.fetched.set(hash, {
      queryKey,
      size: getValueSize(request.dataset, request.selection),
    });
  }

  evictPlayedValues(
    dataContext,
    state,
    new Set([...state.wanted.keys(), ...state.current]),
    limits.maxCacheSize,
  );
}

/* On unmount: cancel pending prefetches and evict values fetched for playback (except those
 * of the current slice and those still in use) */
export function releasePrefetches(
  dataContext: DataContextValue,
  state: PrefetchState,
): void {
  cancelUnwanted(dataContext, state, new Map());
  state.wanted.clear();
  evictPlayedValues(dataContext, state, state.current, 0);
  removeFailedPlaybackQueries(dataContext);
}

async function ignoreErrors(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    // e.g. cancellation; errors are shown by the vis if playback reaches the slice
  }
}

function touch(fetched: Map<string, TrackedQuery>, hash: string): void {
  const entry = fetched.get(hash);
  if (entry) {
    fetched.delete(hash);
    fetched.set(hash, entry);
  }
}

/* Cancel prefetches no longer wanted, unless something else needs them (e.g. the vis, or the
 * slice that just got selected) */
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
      !state.current.has(hash) &&
      query?.state.fetchStatus === 'fetching' &&
      query.getObserversCount() === 0
    ) {
      void dataContext.queryClient.cancelQueries({ queryKey, exact: true });
    }
  }
}

function evictPlayedValues(
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

function removeFailedPlaybackQueries(dataContext: DataContextValue): void {
  const { queryClient } = dataContext;
  const queryCache = queryClient.getQueryCache();
  const hashes = getPlaybackQueries(queryClient);

  for (const hash of hashes) {
    const query = queryCache.get(hash);
    if (query?.state.status === 'error' && query.getObserversCount() === 0) {
      queryCache.remove(query);
    }
    if (query?.state.fetchStatus !== 'fetching') {
      hashes.delete(hash); // no longer needs tracking
    }
  }
}
