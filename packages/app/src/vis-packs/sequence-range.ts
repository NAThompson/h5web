import {
  type DimensionMapping,
  getSliceSelection,
  type PlaybackRange,
} from '@h5web/lib';
import { hasArrayShape, isComplexType } from '@h5web/shared/guards';
import { type ArrayValue } from '@h5web/shared/hdf5-models';
import { hashKey } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { type DataContextValue } from '../providers/DataProvider';
import { type ValueQueryParams } from '../providers/models';
import { getGuardKey, getSizeToConfirm } from './LargeValueGuard';
import { type PlaybackRangeValue } from './playback-range';
import { type PrefetchState, seedSlices } from './prefetch';
import { getValueSize, MAX_SEQUENCE_RANGE_SIZE } from './utils';

// Wait this long for the whole sequence's range before playing with the range of slices shown
const MAX_RANGE_WAIT = 1000; // ms

// Max number of slices put in cache from the values of a whole sequence
export const MAX_SEEDED_SLICES = 500;

// Complex values take much more memory than on disk once converted to `[real, imag]` tuples
const COMPLEX_MEMORY_FACTOR = 8;

type GetRequests = (selection: string | undefined) => ValueQueryParams[];
type MapMapping = (mapping: DimensionMapping) => DimensionMapping;

type SequenceStatus = 'loading' | 'ready' | 'partial';

interface Sequence {
  dim: number;
  key: string;
  status: SequenceStatus;
  startedAt: number;
  value?: unknown; // values of whole sequence, provided until visualizations get its range
}

/* Mapping of the whole sequence of slices along dimension `dim` */
function getSequenceMapping(
  dimMapping: DimensionMapping,
  dim: number,
  mapMapping: MapMapping,
): DimensionMapping {
  return mapMapping(dimMapping.map((val, i) => (i === dim ? null : val)));
}

/* Whole sequence's values fit in memory budget and don't need confirmation to be fetched */
function isSequenceAffordable(
  dataContext: DataContextValue,
  request: ValueQueryParams | undefined,
  maxAutoFetchSize: number,
): request is ValueQueryParams {
  return (
    !!request &&
    getInMemorySize(request) <= MAX_SEQUENCE_RANGE_SIZE &&
    getSizeToConfirm(dataContext, [request], maxAutoFetchSize) === 0
  );
}

function getInMemorySize({ dataset, selection }: ValueQueryParams): number {
  const size = getValueSize(dataset, selection);
  return isComplexType(dataset.type) ? size * COMPLEX_MEMORY_FACTOR : size;
}

/* Value range for playback (cf. `PlaybackRangeValue`): range of the whole sequence when it is
 * affordable to fetch it, otherwise running range of slices shown so far.
 * - Values of the whole sequence are fetched once when playback starts; playback waits for them
 *   for up to a second, then plays with the running range and switches to the whole range when
 *   it arrives (one jump at most). They seed the values of individual slices (so slices aren't
 *   fetched twice) and are dropped once visualizations have computed their range.
 * - The range is kept after pausing, until the sequence changes (other dimension sliced, axes
 *   remapped, other signal); if it changes while playing, the new sequence's range is fetched. */
export interface SequenceRange {
  playbackRange: PlaybackRangeValue | undefined;
  isRangePending: () => boolean;
  rangeHint: string | undefined;
  startSequence: (dim: number) => void;
}

export function useSequenceRange(opts: {
  dataContext: DataContextValue;
  prefetchState: PrefetchState;
  getRequests: GetRequests;
  dimMapping: DimensionMapping;
  mapMapping: MapMapping;
  range: PlaybackRange;
  playingDim: number | undefined;
  maxAutoFetchSize: number;
}): SequenceRange {
  const {
    dataContext,
    prefetchState,
    getRequests,
    dimMapping,
    mapMapping,
    range,
    playingDim,
    maxAutoFetchSize,
  } = opts;
  const { queries, queryClient } = dataContext;

  const [sequence, setSequence] = useState<Sequence>();

  // Sequence is identified by played dimension, other dimensions' slicing and datasets fetched
  const datasetsKey = getGuardKey(getRequests(undefined));
  function getSequenceKey(dim: number): string {
    const mapping = getSequenceMapping(dimMapping, dim, mapMapping);
    return `${dim}:${mapping.join(',')}:${datasetsKey}`;
  }

  function startSequence(dim: number, restart = false): void {
    const key = getSequenceKey(dim);
    setSequence((prev) =>
      // Keep range of sequence already fetched, otherwise (re)start fetching it
      !restart && prev?.key === key && prev.status === 'ready'
        ? prev
        : { dim, key, status: 'loading', startedAt: Date.now() },
    );
  }

  const key = sequence && getSequenceKey(sequence.dim);
  const activeSequence: Sequence | undefined =
    range === 'sequence' && sequence?.key === key ? sequence : undefined;

  // Sequence changed: fetch new one if playing, otherwise forget it
  const isStale = !!sequence && key !== sequence.key;
  useEffect(() => {
    if (!isStale) {
      return;
    }
    if (playingDim === undefined) {
      setSequence(undefined);
    } else {
      startSequence(playingDim, true);
    }
  }, [isStale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signal values of the whole sequence, if affordable
  const signalRequest: ValueQueryParams | undefined =
    activeSequence &&
    getRequests(
      getSliceSelection(
        getSequenceMapping(dimMapping, activeSequence.dim, mapMapping),
      ),
    )[0];
  const isAffordable = isSequenceAffordable(
    dataContext,
    signalRequest,
    maxAutoFetchSize,
  );

  const sequenceQuery =
    signalRequest &&
    queries.value(signalRequest.dataset, signalRequest.selection);
  const queryHash = sequenceQuery && hashKey(sequenceQuery.queryKey);
  const isLoading = isAffordable && activeSequence?.status === 'loading';
  const fetchKey = isLoading ? queryHash : undefined;

  useEffect(() => {
    if (!fetchKey || !activeSequence || !sequenceQuery) {
      return undefined;
    }

    const { key: seqKey, dim } = activeSequence;
    return fetchSequence({
      dataContext,
      query: sequenceQuery,
      onValue: (value) => {
        seedSlices(
          dataContext,
          prefetchState,
          getSliceEntries(value, signalRequest, dimMapping, dim, (mapping) =>
            getRequests(getSliceSelection(mapMapping(mapping))).at(0),
          ),
        );
      },
      onSettled: (update) => {
        setSequence((prev) =>
          prev?.key === seqKey ? { ...prev, ...update } : prev,
        );
      },
    });
  }, [fetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop whole sequence's values once visualizations have computed its range (their effects
  // run before this one)
  const hasValue = sequence?.value !== undefined;
  useEffect(() => {
    if (hasValue) {
      setSequence((prev) => prev && { ...prev, value: undefined });
    }
  }, [hasValue]);

  // Ranges are kept per sequence (even while range setting is switched to "Each slice")
  const rangeKey = activeSequence?.key;
  const sequenceKey = sequence?.key;
  const seenDomains = useMemo(() => new Map(), [sequenceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per sequence
  const sequenceDomains = useMemo(() => new Map(), [sequenceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per sequence
  const computedKinds = useMemo(() => new Set<string>(), [sequenceKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per sequence

  // Values of sequence were dropped, but a visualization needs another kind of range from them
  const canRefetch = isAffordable && activeSequence?.status === 'ready';

  const playbackRange = useMemo(
    (): PlaybackRangeValue | undefined =>
      rangeKey
        ? {
            key: rangeKey,
            sequenceValue: sequence?.value,
            seenDomains,
            sequenceDomains,
            computedKinds,
            requestSequence: canRefetch
              ? () => {
                  setSequence((prev) =>
                    prev?.key === rangeKey && prev.status === 'ready'
                      ? { ...prev, status: 'loading', startedAt: Date.now() }
                      : prev,
                  );
                }
              : undefined,
            loading:
              isLoading && queryHash
                ? getLoading(queryClient, queryHash)
                : undefined,
          }
        : undefined,
    [
      rangeKey,
      sequence?.value,
      seenDomains,
      sequenceDomains,
      computedKinds,
      canRefetch,
      isLoading,
      queryHash,
      queryClient,
    ],
  );

  return {
    playbackRange,
    // Wait (briefly) for the sequence's range before moving on, so it applies from the start
    isRangePending: () =>
      isLoading && Date.now() - activeSequence.startedAt < MAX_RANGE_WAIT,
    rangeHint: getRangeHint(
      range,
      signalRequest,
      isAffordable,
      sequence?.status,
    ),
    startSequence,
  };
}

/* Fetch values of whole sequence (without keeping them in cache); returns cleanup function */
function fetchSequence(opts: {
  dataContext: DataContextValue;
  query: ReturnType<DataContextValue['queries']['value']>;
  onValue: (value: unknown) => void;
  onSettled: (update: Partial<Sequence>) => void;
}): () => void {
  const { dataContext, query, onValue, onSettled } = opts;
  const { queryClient } = dataContext;
  const effect = { isCurrent: true }; // object, so its change in cleanup is seen

  void (async () => {
    try {
      const value = await queryClient.query({ ...query, gcTime: 0 });
      if (!effect.isCurrent) {
        return;
      }

      onValue(value);
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
      onSettled({ status: 'ready', value });
    } catch {
      // Failed or cancelled (e.g. by selecting the dataset again): use range of slices shown
      if (effect.isCurrent) {
        onSettled({ status: 'partial' });
      }
    }
  })();

  return () => {
    effect.isCurrent = false;
    void queryClient.cancelQueries({ queryKey: query.queryKey, exact: true });
  };
}

function getLoading(
  queryClient: DataContextValue['queryClient'],
  queryHash: string,
): PlaybackRangeValue['loading'] {
  return {
    queryHash,
    cancel: () => {
      void queryClient.cancelQueries({
        predicate: (query) => query.queryHash === queryHash,
      });
    },
  };
}

function getRangeHint(
  range: PlaybackRange,
  signalRequest: ValueQueryParams | undefined,
  isAffordable: boolean,
  status: SequenceStatus | undefined,
): string | undefined {
  if (range !== 'sequence' || !signalRequest) {
    return undefined;
  }
  if (!isAffordable) {
    return 'Sequence too large to get its range: using range of slices shown so far';
  }
  return status === 'partial'
    ? "Couldn't get range of sequence: using range of slices shown so far"
    : undefined;
}

/* Split values of whole sequence into values of its slices, as fetched for each slice */
export function getSliceEntries(
  value: unknown,
  signalRequest: ValueQueryParams,
  dimMapping: DimensionMapping,
  dim: number,
  getSliceRequest: (mapping: DimensionMapping) => ValueQueryParams | undefined,
): { request: ValueQueryParams; value: unknown }[] {
  const { dataset, selection } = signalRequest;
  if (!hasArrayShape(dataset) || !isSliceable(value)) {
    return [];
  }

  // Dimensions kept in sequence's values, and position of played dimension among them
  const slicings = selection?.split(',');
  const keptDims = dataset.shape.dims.filter(
    (_, i) => !slicings || slicings[i] === ':',
  );
  const axis = dataset.shape.dims
    .slice(0, dim)
    .filter((_, i) => !slicings || slicings[i] === ':').length;

  const length = keptDims[axis];
  const before = keptDims.slice(0, axis).reduce((acc, d) => acc * d, 1);
  const after = keptDims.slice(axis + 1).reduce((acc, d) => acc * d, 1);

  if (value.length !== before * length * after) {
    return []; // unexpected layout
  }

  // Only seed slices coming next from the current one, to bound the number of cache entries
  const current = dimMapping[dim];
  const first = typeof current === 'number' ? current : 0;

  return Array.from({ length: Math.min(length, MAX_SEEDED_SLICES) }, (_, n) => {
    const index = (first + n) % length;
    const request = getSliceRequest(
      dimMapping.map((v, i) => (i === dim ? index : v)),
    );
    return (
      request && {
        request,
        value: extractSlice(value, index, length, before, after),
      }
    );
  }).filter((entry) => entry !== undefined);
}

type Sliceable = ArrayValue | unknown[];

function isSliceable(value: unknown): value is Sliceable {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function extractSlice(
  value: Sliceable,
  index: number,
  length: number,
  before: number,
  after: number,
): unknown {
  if (before === 1) {
    const start = index * after;
    // Copy (rather than view), so cached slices don't retain the whole sequence's buffer
    return value.slice(start, start + after);
  }

  // Gather strided elements directly into output (no intermediate chunks)
  const result: Record<number, unknown> = Array.isArray(value)
    ? Array.from({ length: before * after })
    : new (
        value.constructor as new (n: number) => Exclude<Sliceable, unknown[]>
      )(before * after);
  const source = value as Record<number, unknown>;

  for (let b = 0; b < before; b += 1) {
    const start = (b * length + index) * after;
    for (let a = 0; a < after; a += 1) {
      result[b * after + a] = source[start + a];
    }
  }

  return result;
}
