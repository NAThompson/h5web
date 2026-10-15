import {
  type DimensionMapperProps,
  type DimensionMapping,
  getSliceSelection,
  type PlaybackSettings,
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
import { getCachedValue, hasValueFailed, isValueInCache } from '../utils';
import { useConfirmedSize } from './fetch-confirmation';
import { getGuardKey, getMaxAutoFetchSize } from './LargeValueGuard';
import { getCachedIsInvalid } from './netcdf/hooks';
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
  Pick<
    DimensionMapperProps,
    'playingDim' | 'playbackRangeHint' | 'isSliceEmpty'
  >;

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
  /* Skip slices whose values (the first request) are all `NaN` or ignored, once in cache (e.g.
   * prefetched during playback): no value is fetched to find out */
  skipEmpty?: boolean;
  /* Initial playback settings (e.g. from a view hint), over the remembered ones until the user
   * changes them */
  playbackDefaults?: Partial<PlaybackSettings>;
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
    skipEmpty = false,
    playbackDefaults,
  } = opts;
  const dataContext = useDataContext();
  const [state] = useState(createPrefetchState);
  const [emptyValues] = useState(() => new WeakMap<object, boolean>());
  const [storedSettings, setPlaybackSettings] = usePlaybackSettingsState();
  const [isSettingsEdited, setSettingsEdited] = useState(false);
  const playbackSettings = isSettingsEdited
    ? storedSettings
    : { ...storedSettings, ...playbackDefaults };
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

  function isSliceEmpty(mapping: DimensionMapping): boolean {
    const [request] = getRequests(getSliceSelection(mapMapping(mapping)));
    const value = getCachedValue(dataContext, request);
    if (!value || typeof value !== 'object') {
      return false; // unknown
    }

    let isEmpty = emptyValues.get(value);
    if (isEmpty === undefined) {
      const isInvalid = getCachedIsInvalid(request.dataset, dataContext);
      isEmpty = isAllInvalid(value, isInvalid);
      emptyValues.set(value, isEmpty);
    }
    return isEmpty;
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
    onPlaybackSettingsChange: (settings) => {
      setSettingsEdited(true);
      setPlaybackSettings(settings);
    },
    playingDim,
    onPlayingDimChange: (dim) => {
      setPlayingDim(dim);
      if (dim !== undefined) {
        startSequence(dim);
      }
    },
    playbackRangeHint: rangeHint,
    isSliceEmpty: skipEmpty ? isSliceEmpty : undefined,
  };

  return { slicingProps, playbackRange };
}

/* Whether all values are `NaN` or ignored (not numbers, e.g. strings: never) */
function isAllInvalid(
  value: object,
  isInvalid?: (val: number | bigint) => boolean,
): boolean {
  if (!ArrayBuffer.isView(value) && !Array.isArray(value)) {
    return false;
  }
  const values = value as ArrayLike<unknown>; // array or typed array
  return (
    values.length > 0 &&
    Array.prototype.every.call(
      values,
      (val) =>
        (typeof val === 'number' && Number.isNaN(val)) ||
        ((typeof val === 'number' || typeof val === 'bigint') &&
          !!isInvalid?.(val)),
    )
  );
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
