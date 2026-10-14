import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import { dataset } from '@h5web/shared/mock-utils';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { type DataContextValue } from '../providers/DataProvider';
import { type ValueQueryParams } from '../providers/models';
import {
  createPrefetchState,
  type PrefetchLimits,
  prefetchSlices,
  releasePrefetches,
} from './prefetch';
import { MAX_AUTO_FETCH_SIZE } from './utils';

// 10 slices of 100 float64 values = 800 bytes each
const stack = dataset('stack', arrayShape([10, 100]), floatType(64));

// 800 MB per slice, more than `MAX_AUTO_FETCH_SIZE`
const bigStack = dataset('big', arrayShape([10, 1e8]), floatType(64));

const LIMITS: PrefetchLimits = { maxPrefetchSize: 1e6, maxCacheSize: 1e6 };

function slice(index: number, ds = stack): ValueQueryParams[] {
  return [{ dataset: ds, selection: `${index},:` }];
}

function setup(queryFn?: () => Promise<unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 'static', retry: false } },
  });

  const pending = new Map<string, () => void>();
  const signals = new Map<string, AbortSignal>();

  const dataContext = {
    filepath: 'file.h5',
    queryClient,
    queries: {
      value: (ds: typeof stack, selection?: string) =>
        queryOptions({
          queryKey: ['file.h5', 'value', ds.path, selection] as const,
          queryFn:
            queryFn ??
            (async ({ signal }) => {
              signals.set(selection ?? '', signal);
              await new Promise<void>((resolve) => {
                pending.set(selection ?? '', resolve);
              });
              return new Float64Array(100);
            }),
        }),
    },
  } as unknown as DataContextValue;

  const state = createPrefetchState();

  /* Prefetch slices `upcoming`, with `current` being displayed */
  function prefetch(
    upcoming: number[],
    current = 0,
    opts: {
      limits?: PrefetchLimits;
      ds?: typeof stack;
      maxAutoFetchSize?: number;
    } = {},
  ): boolean {
    const { limits = LIMITS, ds = stack, maxAutoFetchSize } = opts;
    return prefetchSlices(
      dataContext,
      state,
      upcoming.map((i) => slice(i, ds)),
      slice(current, ds),
      maxAutoFetchSize ?? MAX_AUTO_FETCH_SIZE,
      limits,
    );
  }

  async function resolveAll() {
    pending.forEach((resolve) => {
      resolve();
    });
    pending.clear();
    await vi.waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });
  }

  function isCached(selection: string) {
    return (
      queryClient.getQueryData(['file.h5', 'value', '/stack', selection]) !==
      undefined
    );
  }

  return {
    dataContext,
    queryClient,
    state,
    signals,
    pending,
    prefetch,
    resolveAll,
    isCached,
  };
}

describe('prefetchSlices', () => {
  it('should fetch upcoming slices', async () => {
    const { pending, prefetch, resolveAll, isCached } = setup();

    expect(prefetch([1, 2, 3])).toBe(true);
    expect([...pending.keys()]).toStrictEqual(['1,:', '2,:', '3,:']);

    // Calling again with the same slices doesn't refetch
    prefetch([1, 2, 3]);
    expect(pending.size).toBe(3);

    await resolveAll();
    expect(isCached('1,:') && isCached('2,:') && isCached('3,:')).toBe(true);
  });

  it('should limit size of slices fetched ahead, but always fetch next slice', () => {
    const { pending, prefetch } = setup();

    prefetch([1, 2, 3], 0, { limits: { ...LIMITS, maxPrefetchSize: 1000 } }); // one slice
    expect([...pending.keys()]).toStrictEqual(['1,:']);

    prefetch([4], 0, { limits: { ...LIMITS, maxPrefetchSize: 0 } });
    expect(pending.has('4,:')).toBe(true);
  });

  it('should cancel prefetches that are no longer wanted', async () => {
    const { signals, prefetch, resolveAll } = setup();

    prefetch([1, 2, 3]);
    prefetch([2, 3, 4], 1);
    expect(signals.get('1,:')?.aborted).toBe(false); // current slice
    expect(signals.get('2,:')?.aborted).toBe(false);

    // Playback stopped by user picking slice 4: keep fetching it
    prefetch([], 4);
    expect(signals.get('3,:')?.aborted).toBe(true);
    expect(signals.get('2,:')?.aborted).toBe(true);
    expect(signals.get('4,:')?.aborted).toBe(false);

    await resolveAll();
  });

  it('should evict played slices beyond cache budget', async () => {
    const { prefetch, resolveAll, isCached } = setup();
    const limits = { maxPrefetchSize: 1e6, maxCacheSize: 2000 }; // ~2 slices

    for (const index of [1, 2, 3, 4, 5]) {
      prefetch([index], index - 1, { limits });
      await resolveAll(); // eslint-disable-line no-await-in-loop -- sequential playback
    }
    prefetch([6], 5, { limits });

    // Oldest slices are evicted; current and recently wanted ones are kept
    expect(isCached('1,:')).toBe(false);
    expect(isCached('2,:')).toBe(false);
    expect(isCached('5,:')).toBe(true);

    await resolveAll();
  });

  it('should never evict current slice', async () => {
    const { prefetch, resolveAll, isCached } = setup();
    const limits = { maxPrefetchSize: 1e6, maxCacheSize: 0 };

    prefetch([1, 2, 3], 0, { limits });
    await resolveAll();

    prefetch([], 1, { limits }); // e.g. paused on slice 1 before vis observes it
    prefetch([], 1, { limits });
    expect(isCached('1,:')).toBe(true);
    expect(isCached('2,:')).toBe(false);
  });

  it('should not evict slices that were in cache before playback', async () => {
    const { queryClient, prefetch, resolveAll, isCached } = setup();
    queryClient.setQueryData(
      ['file.h5', 'value', '/stack', '9,:'],
      new Float64Array(100),
    );

    const limits = { maxPrefetchSize: 1e6, maxCacheSize: 0 };
    for (const index of [1, 2, 3]) {
      prefetch([index], index - 1, { limits });
      await resolveAll(); // eslint-disable-line no-await-in-loop -- sequential playback
    }
    prefetch([9], 3, { limits });
    prefetch([4], 9, { limits });

    expect(isCached('9,:')).toBe(true);
    expect(isCached('1,:')).toBe(false);
  });

  it('should not retry failed slices until playback stops', async () => {
    const queryFn = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error('failed'));
    const { queryClient, prefetch } = setup(queryFn);
    const key = ['file.h5', 'value', '/stack', '1,:'];

    prefetch([1]);
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(key)?.status).toBe('error');
    });

    prefetch([1]);
    expect(queryFn).toHaveBeenCalledOnce();

    // Errors are cleared when playback stops, so slices can be retried
    prefetch([], 0);
    expect(queryClient.getQueryState(key)).toBeUndefined();
  });

  it('should release prefetched slices on unmount, except current one', async () => {
    const { dataContext, state, signals, prefetch, resolveAll, isCached } =
      setup();

    prefetch([1, 2]);
    await resolveAll();
    prefetch([3], 2);

    releasePrefetches(dataContext, state);
    expect(signals.get('3,:')?.aborted).toBe(true);
    expect(isCached('1,:')).toBe(false);
    expect(isCached('2,:')).toBe(true);
  });

  it('should not prefetch slices that need confirmation', () => {
    const { pending, prefetch } = setup();

    expect(prefetch([1], 0, { ds: bigStack })).toBe(false);
    expect(pending.size).toBe(0);

    // Once confirmed in the vis, slices of the same size can be prefetched
    expect(prefetch([1], 0, { ds: bigStack, maxAutoFetchSize: 800e6 })).toBe(
      true,
    );
    expect(pending.has('1,:')).toBe(true);
  });
});
