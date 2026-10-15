import {
  type DimensionMapperProps,
  type DimensionMapping,
  getSliceSelection,
} from '@h5web/lib';
import {
  type ArrayShape,
  type Dataset,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { useUnmountEffect } from '@react-hookz/web';
import { useState } from 'react';

import { usePlaybackSettingsState } from '../dim-mapping-store';
import { useDataContext } from '../providers/DataProvider';
import { type ValueQueryParams } from '../providers/models';
import { hasValueFailed, isValueInCache } from '../utils';
import { useConfirmedSize } from './fetch-confirmation';
import { getGuardKey, getMaxAutoFetchSize } from './LargeValueGuard';
import { type NxData } from './nexus/models';
import { getNxValueRequests } from './nexus/NxValuesFetcher';
import { type PlaybackRangeValue } from './playback-range';
import {
  createPrefetchState,
  prefetchSlices,
  releasePrefetches,
} from './prefetch';
import { useSequenceRange } from './sequence-range';

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
  /* Other values shown with each slice (e.g. overlays), prefetched for playback but not guarded
   * by `LargeValueGuard` nor part of the sequence's range */
  getExtraRequests?: GetRequests;
}

export function useSlicingProps(
  getRequests: GetRequests,
  dimMapping: DimensionMapping,
  opts: SlicingOpts = {},
): Slicing {
  const {
    mapMapping = (m) => m,
    withPlaybackRange = false,
    getExtraRequests = () => [],
  } = opts;
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
    useSequenceRange({
      dataContext,
      prefetchState: state,
      getRequests,
      dimMapping,
      mapMapping,
      range: withPlaybackRange ? playbackSettings.range : 'frame',
      playingDim,
      maxAutoFetchSize,
    });

  function requestsFor(mapping: DimensionMapping): ValueQueryParams[] {
    const selection = getSliceSelection(mapMapping(mapping));
    return [...getRequests(selection), ...getExtraRequests(selection)];
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
      !isRangePending() &&
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
