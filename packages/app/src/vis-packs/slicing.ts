import {
  type DimensionMapperProps,
  type DimensionMapping,
  getSliceSelection,
  type PlaybackRange,
} from '@h5web/lib';
import {
  type ArrayShape,
  type Dataset,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { useUnmountEffect } from '@react-hookz/web';
import { type QueryFunction, skipToken, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { usePlaybackSettingsState } from '../dim-mapping-store';
import {
  type DataContextValue,
  useDataContext,
} from '../providers/DataProvider';
import { type ValueQueryParams } from '../providers/models';
import { hasValueFailed, isValueInCache } from '../utils';
import { useConfirmedSize } from './fetch-confirmation';
import {
  getGuardKey,
  getMaxAutoFetchSize,
  getSizeToConfirm,
} from './LargeValueGuard';
import { type NxData } from './nexus/models';
import { getNxValueRequests } from './nexus/NxValuesFetcher';
import { type PlaybackRangeValue } from './playback-range';
import {
  createPrefetchState,
  prefetchSlices,
  releasePrefetches,
} from './prefetch';
import { getValueSize, MAX_SEQUENCE_RANGE_SIZE } from './utils';

export type SlicingProps = Required<
  Pick<
    DimensionMapperProps,
    | 'canSliceFast'
    | 'withPlaybackControls'
    | 'isSliceReady'
    | 'prefetchSlices'
    | 'playbackSettings'
    | 'onPlaybackSettingsChange'
    | 'onPlayingDimChange'
  >
> &
  Pick<DimensionMapperProps, 'playingDim' | 'playbackRangeHint'>;

export interface Slicing {
  slicingProps: SlicingProps; // to pass to `DimensionMapper`
  playbackRange: PlaybackRangeValue | undefined; // to provide with `PlaybackRangeContext`
}

type GetRequests = (selection: string | undefined) => ValueQueryParams[];
type MapMapping = (mapping: DimensionMapping) => DimensionMapping;

/* Props to pass to `DimensionMapper` for fast slicing and playback, given the values a vis
 * fetches for a selection (the same values passed to `LargeValueGuard`), and the value range
 * to use while playing. `mapMapping` converts the dimension mapper's mapping to the vis' (e.g.
 * for multi-plotting). */
export interface SlicingOpts {
  mapMapping?: MapMapping;
  withPlaybackRange?: boolean; // for visualizations with an axis or colour domain
}

export function useSlicingProps(
  getRequests: GetRequests,
  dimMapping: DimensionMapping,
  opts: SlicingOpts = {},
): Slicing {
  const { mapMapping = (m) => m, withPlaybackRange = false } = opts;
  const dataContext = useDataContext();
  const [state] = useState(createPrefetchState);
  const [playbackSettings, setPlaybackSettings] = usePlaybackSettingsState();
  const [playingDim, setPlayingDim] = useState<number>();

  // Prefetch only what `LargeValueGuard` would let through in this vis
  const [confirmedSize] = useConfirmedSize(getGuardKey(getRequests(undefined)));
  const maxAutoFetchSize = getMaxAutoFetchSize(confirmedSize);

  useUnmountEffect(() => {
    releasePrefetches(dataContext, state);
  });

  const { playbackRange, isRangePending, rangeHint, startSequence } =
    usePlaybackRange(
      dataContext,
      getRequests,
      dimMapping,
      mapMapping,
      withPlaybackRange ? playbackSettings.range : 'frame',
      maxAutoFetchSize,
    );

  function requestsFor(mapping: DimensionMapping): ValueQueryParams[] {
    return getRequests(getSliceSelection(mapMapping(mapping)));
  }

  const slicingProps: SlicingProps = {
    // Sliced values in cache: no need to wait for debounce
    canSliceFast: (mapping) =>
      requestsFor(mapping)
        .filter(({ selection }) => selection !== undefined)
        .every(({ dataset, selection }) =>
          isValueInCache(dataContext, dataset, selection),
        ),

    // Playback can show slices whose values are in cache or failed to load (to show the error)
    isSliceReady: (mapping) =>
      !isRangePending &&
      requestsFor(mapping).every(
        ({ dataset, selection }) =>
          isValueInCache(dataContext, dataset, selection) ||
          hasValueFailed(dataContext, dataset, selection),
      ),

    withPlaybackControls: true,
    prefetchSlices: (nextMappings, currentMapping) =>
      prefetchSlices(
        dataContext,
        state,
        nextMappings.map(requestsFor),
        requestsFor(currentMapping),
        maxAutoFetchSize,
      ),
    playbackSettings,
    onPlaybackSettingsChange: setPlaybackSettings,
    playingDim,
    onPlayingDimChange: (dim) => {
      setPlayingDim(dim);
      if (dim !== undefined) {
        startSequence(dim);
      }
    },
    playbackRangeHint: rangeHint,
  };

  return { slicingProps, playbackRange };
}

/* Mapping of the whole sequence of slices along dimension `dim` */
function getSequenceMapping(
  dimMapping: DimensionMapping,
  dim: number,
  mapMapping: MapMapping,
): DimensionMapping {
  return mapMapping(dimMapping.map((val, i) => (i === dim ? null : val)));
}

/* Value range for playback: whole sequence's range when it's affordable to fetch, otherwise
 * running range of slices shown so far. Kept after pausing, until the sequence changes (other
 * dimension sliced, axes remapped) or a new sequence is played. */
function usePlaybackRange(
  dataContext: DataContextValue,
  getRequests: GetRequests,
  dimMapping: DimensionMapping,
  mapMapping: MapMapping,
  range: PlaybackRange,
  maxAutoFetchSize: number,
) {
  const [sequence, setSequence] = useState<{ dim: number; key: string }>();

  const sequenceMapping =
    sequence && getSequenceMapping(dimMapping, sequence.dim, mapMapping);
  const key = sequenceMapping && `${sequence.dim}:${sequenceMapping.join(',')}`;
  const isActive = range === 'sequence' && !!sequence && key === sequence.key;

  // Forget sequence once it changes (rather than reviving its range if it comes back)
  const isStale = !!sequence && key !== sequence.key;
  useEffect(() => {
    if (isStale) {
      setSequence(undefined);
    }
  }, [isStale]);

  // Fetch values of the whole sequence if affordable, to get its range from the start
  const signalRequest: ValueQueryParams | undefined = isActive
    ? getRequests(getSliceSelection(sequenceMapping))[0]
    : undefined;
  const isAffordable =
    !!signalRequest &&
    getValueSize(signalRequest.dataset, signalRequest.selection) <=
      MAX_SEQUENCE_RANGE_SIZE &&
    getSizeToConfirm(dataContext, [signalRequest], maxAutoFetchSize) === 0;

  const sequenceQuery =
    signalRequest &&
    dataContext.queries.value(signalRequest.dataset, signalRequest.selection);
  const { data: sequenceValue, isError: hasSequenceFailed } = useQuery({
    queryKey: sequenceQuery?.queryKey ?? [dataContext.filepath, 'no-sequence'],
    queryFn:
      (isAffordable && (sequenceQuery?.queryFn as QueryFunction | undefined)) ||
      skipToken,
  });

  const seenDomains = useMemo(() => new Map(), [key]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per sequence

  const playbackRange = useMemo(
    () =>
      isActive && key
        ? {
            key,
            sequenceValue: isAffordable ? sequenceValue : undefined,
            seenDomains,
          }
        : undefined,
    [isActive, key, isAffordable, sequenceValue, seenDomains],
  );

  return {
    playbackRange,
    // Wait for the sequence's range before moving on, so it applies from the first slice played
    isRangePending:
      isAffordable && sequenceValue === undefined && !hasSequenceFailed,
    rangeHint:
      range === 'sequence' && signalRequest && !isAffordable
        ? 'Sequence too large to get its range: using range of slices shown so far'
        : undefined,
    startSequence: (dim: number) => {
      setSequence({
        dim,
        key: `${dim}:${getSequenceMapping(dimMapping, dim, mapMapping).join(',')}`,
      });
    },
  };
}

export function useDatasetSlicingProps(
  dataset: Dataset<ScalarShape | ArrayShape>,
  dimMapping: DimensionMapping,
  opts?: SlicingOpts,
): Slicing {
  return useSlicingProps(
    (selection) => [{ dataset, selection }],
    dimMapping,
    opts,
  );
}

export function useNxSlicingProps(
  nxData: NxData,
  dimMapping: DimensionMapping,
  opts?: SlicingOpts,
): Slicing {
  return useSlicingProps(
    (selection) => Object.values(getNxValueRequests(nxData, selection)),
    dimMapping,
    opts,
  );
}
