import { type DimensionMapping } from '@h5web/lib';
import { arrayShape, floatType } from '@h5web/shared/hdf5-utils';
import { dataset } from '@h5web/shared/mock-utils';
import { QueryClient, queryOptions } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { type DataContextValue } from '../providers/DataProvider';
import {
  createPrefetchState,
  prefetchSlices,
  trackRequestedSlices,
} from './prefetch';

// 10 slices of 100 float64 values = 800 bytes each
const stack = dataset('stack', arrayShape([10, 100]), floatType(64));

function setup() {
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
          queryFn: async ({ signal }) => {
            signals.set(selection ?? '', signal);
            await new Promise<void>((resolve) => {
              pending.set(selection ?? '', resolve);
            });
            return new Float64Array(100);
          },
        }),
    },
  } as unknown as DataContextValue;

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

  return { dataContext, queryClient, signals, pending, resolveAll, isCached };
}

function mappings(...indices: number[]): DimensionMapping[] {
  return indices.map((i) => [i, 'x']);
}

const limits = { maxPrefetchSize: 1e6, maxCacheSize: 1e6 };

describe('prefetchSlices', () => {
  it('should fetch upcoming slices', async () => {
    const { dataContext, pending, resolveAll, isCached } = setup();
    const state = createPrefetchState();

    prefetchSlices(dataContext, state, [stack], mappings(1, 2, 3), limits);
    expect([...pending.keys()]).toStrictEqual(['1,:', '2,:', '3,:']);

    // Calling again with the same slices doesn't refetch
    prefetchSlices(dataContext, state, [stack], mappings(1, 2, 3), limits);
    expect(pending.size).toBe(3);

    await resolveAll();
    expect(isCached('1,:') && isCached('2,:') && isCached('3,:')).toBe(true);
  });

  it('should limit size of slices fetched ahead, but always fetch next slice', () => {
    const { dataContext, pending } = setup();
    const state = createPrefetchState();

    prefetchSlices(dataContext, state, [stack], mappings(1, 2, 3), {
      ...limits,
      maxPrefetchSize: 1000, // room for one slice only
    });
    expect([...pending.keys()]).toStrictEqual(['1,:']);

    prefetchSlices(dataContext, createPrefetchState(), [stack], mappings(4), {
      ...limits,
      maxPrefetchSize: 0,
    });
    expect(pending.has('4,:')).toBe(true);
  });

  it('should cancel prefetches that are no longer wanted', async () => {
    const { dataContext, signals, resolveAll } = setup();
    const state = createPrefetchState();

    prefetchSlices(dataContext, state, [stack], mappings(1, 2, 3), limits);
    prefetchSlices(dataContext, state, [stack], mappings(2, 3, 4), limits);
    expect(signals.get('1,:')?.aborted).toBe(true);
    expect(signals.get('2,:')?.aborted).toBe(false);

    prefetchSlices(dataContext, state, [stack], [], limits); // playback stopped
    expect(signals.get('2,:')?.aborted).toBe(true);
    expect(signals.get('4,:')?.aborted).toBe(true);

    await resolveAll();
  });

  it('should evict played slices beyond cache budget', async () => {
    const { dataContext, resolveAll, isCached } = setup();
    const state = createPrefetchState();
    const smallCache = { maxPrefetchSize: 1e6, maxCacheSize: 2000 }; // ~2 slices

    for (const index of [1, 2, 3, 4]) {
      prefetchSlices(dataContext, state, [stack], mappings(index), smallCache);
      await resolveAll(); // eslint-disable-line no-await-in-loop -- sequential playback
    }

    prefetchSlices(dataContext, state, [stack], mappings(5), smallCache);
    await resolveAll();
    prefetchSlices(dataContext, state, [stack], mappings(6), smallCache);

    // Oldest slices are evicted; recently wanted ones are kept
    expect(isCached('1,:')).toBe(false);
    expect(isCached('2,:')).toBe(false);
    expect(isCached('5,:')).toBe(true);

    await resolveAll();
  });

  it('should not evict slices that were in cache before playback', async () => {
    const { dataContext, queryClient, resolveAll, isCached } = setup();
    queryClient.setQueryData(
      ['file.h5', 'value', '/stack', '0,:'],
      new Float64Array(100),
    );

    const state = createPrefetchState();
    const noCache = { maxPrefetchSize: 1e6, maxCacheSize: 0 };
    for (const index of [1, 2, 3]) {
      prefetchSlices(dataContext, state, [stack], mappings(index), noCache);
      await resolveAll(); // eslint-disable-line no-await-in-loop -- sequential playback
    }
    prefetchSlices(dataContext, state, [stack], mappings(0), noCache);

    expect(isCached('0,:')).toBe(true);
    expect(isCached('1,:')).toBe(false);
  });

  it('should not retry failed slices', async () => {
    const { dataContext, queryClient } = setup();
    const state = createPrefetchState();
    const queryFn = vi
      .fn<() => Promise<never>>()
      .mockRejectedValue(new Error('failed'));

    const failingContext = {
      ...dataContext,
      queries: {
        value: (ds: typeof stack, selection?: string) =>
          queryOptions({
            queryKey: ['file.h5', 'value', ds.path, selection] as const,
            queryFn,
          }),
      },
    } as unknown as DataContextValue;

    prefetchSlices(failingContext, state, [stack], mappings(1), limits);
    await vi.waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });

    prefetchSlices(failingContext, state, [stack], mappings(1), limits);
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it('should only prefetch large slices once a slice as large was requested', async () => {
    const { dataContext, queryClient, pending } = setup();
    const state = createPrefetchState();
    const unsubscribe = trackRequestedSlices(dataContext, state);

    // 800 MB per slice, more than `MAX_AUTO_FETCH_SIZE`
    const bigStack = dataset('big', arrayShape([10, 1e8]), floatType(64));

    prefetchSlices(dataContext, state, [bigStack], mappings(1), limits);
    expect(pending.size).toBe(0);

    // Vis requests the current slice (after confirmation), which fails and gets evicted
    const { queryKey } = dataContext.queries.value(bigStack, '0,:');
    await expect(
      queryClient.query({
        queryKey,
        queryFn: async () => {
          throw new Error('failed');
        },
      }),
    ).rejects.toThrow('failed');
    queryClient.removeQueries({ queryKey });

    prefetchSlices(dataContext, state, [bigStack], mappings(1), limits);
    expect(pending.has('1,:')).toBe(true);

    unsubscribe();
  });
});
