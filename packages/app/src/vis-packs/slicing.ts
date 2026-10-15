import {
  type DimensionMapperProps,
  type DimensionMapping,
  getSliceSelection,
  type PlaybackSettings,
} from '@h5web/lib';
import { hasArrayShape } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { useSyncedRef, useUnmountEffect } from '@react-hookz/web';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { usePlaybackSettingsState } from '../dim-mapping-store';
import {
  type DataContextValue,
  useDataContext,
} from '../providers/DataProvider';
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
    'playingDim' | 'playbackRangeHint' | 'isSliceEmpty' | 'defaultPlayingDim'
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
  /* With `skipEmpty`: on first load, until the user changes the mapping, called to move the first
   * sliced dimension past empty slices (e.g. all `NaN` at k = 0) */
  onSkipEmptyStart?: (mapping: DimensionMapping) => void;
  /* Dimension played by default (e.g. from a view hint), if sliced: walked past empty slices
   * instead of the first sliced dimension, and its play button marked */
  playbackDim?: number;
}

const SKIP_START_PREFETCH = 4; // slices fetched ahead at once to find a non-empty one

/* Keys of the edited settings, and the defaults they override */
function withoutEdited(
  defaults: Partial<PlaybackSettings> | undefined,
  edited: string[],
): Partial<PlaybackSettings> {
  return Object.fromEntries(
    Object.entries(defaults ?? {}).filter(([key]) => !edited.includes(key)),
  );
}

/* Version of the values (and invalid values) of a dataset in cache, bumped as they arrive */
function useCacheVersion(
  dataContext: DataContextValue,
  datasetPath: string | undefined,
  enabled: boolean,
): number {
  const { filepath, queryClient } = dataContext;
  const version = useRef(0);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled) {
        return () => undefined;
      }
      return queryClient.getQueryCache().subscribe((event) => {
        const [file, type, path] = event.query.queryKey;
        if (
          file === filepath &&
          path === datasetPath &&
          CACHED_TYPES.has(type) &&
          (event.type === 'removed' ||
            (event.type === 'updated' && event.action.type === 'success'))
        ) {
          version.current += 1;
          onChange();
        }
      });
    },
    [datasetPath, enabled, filepath, queryClient],
  );
  return useSyncExternalStore(subscribe, () => version.current);
}

const CACHED_TYPES = new Set<unknown>(['value', 'packing', 'ignoreValue']);

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
    onSkipEmptyStart,
    playbackDim,
  } = opts;
  const dataContext = useDataContext();
  const [state] = useState(createPrefetchState);
  const [emptyValues] = useState(() => new WeakMap<object, boolean>());
  const mainRequest = getRequests(undefined).at(0); // values whose slices may be empty
  const datasetPath = mainRequest?.dataset.path;

  // Playback settings: hint defaults over the remembered ones, except those edited for this dataset
  const [storedSettings, setPlaybackSettings] = usePlaybackSettingsState();
  const [edited, setEdited] = useState<{ path?: string; keys: string[] }>({
    keys: [],
  });
  const editedKeys = edited.path === datasetPath ? edited.keys : [];
  const playbackSettings = {
    ...storedSettings,
    ...withoutEdited(playbackDefaults, editedKeys),
  };
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

  /* Whether a slice is empty: `undefined` until its values (and invalid values) are in cache */
  function getEmptiness(mapping: DimensionMapping): boolean | undefined {
    const [request] = getRequests(getSliceSelection(mapMapping(mapping)));
    const value = getCachedValue(dataContext, request);
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    let isEmpty = emptyValues.get(value);
    if (isEmpty === undefined) {
      const invalid = getCachedIsInvalid(request.dataset, dataContext);
      isEmpty = isAllInvalid(value, invalid?.isInvalid);
      if (!invalid && !isEmpty) {
        return undefined; // until invalid values are known (e.g. all `_FillValue`)
      }
      emptyValues.set(value, isEmpty);
    }
    return isEmpty;
  }

  // Same function until values of the dataset arrive, so that slices aren't all looked up again
  const cacheVersion = useCacheVersion(dataContext, datasetPath, skipEmpty);
  const latest = useSyncedRef({
    getEmptiness,
    mapMapping,
    requestsFor,
    onSkipEmptyStart,
    maxAutoFetchSize,
    playbackDim,
  });
  const isSliceEmpty = useCallback(
    (mapping: DimensionMapping) =>
      latest.current.getEmptiness(mapping) === true,
    [cacheVersion], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // First load: move past empty slices, fetching a few slices ahead to find a non-empty one
  const skipStart = useRef({
    isActive: true,
    expected: JSON.stringify(dimMapping),
    next: 0, // slices before it known to be empty, even once evicted from the cache
  });
  const sliceDims =
    mainRequest && hasArrayShape(mainRequest.dataset)
      ? mainRequest.dataset.shape.dims
      : undefined;
  useEffect(() => {
    const start = skipStart.current;
    const { getEmptiness: emptiness, onSkipEmptyStart: skip } = latest.current;
    if (!skipEmpty || !skip || !start.isActive) {
      return;
    }

    const dim = getPlaybackDim(
      dimMapping,
      latest.current.mapMapping,
      latest.current.playbackDim,
    );
    const index = dimMapping[dim];
    if (
      JSON.stringify(dimMapping) !== start.expected ||
      typeof index !== 'number'
    ) {
      start.isActive = false; // changed by the user, or nothing to slice
      return;
    }

    function withIndex(i: number): DimensionMapping {
      return dimMapping.map((val, d) => (d === dim ? i : val));
    }
    const length = sliceDims?.[dim] ?? 0;
    for (let i = Math.max(index, start.next); i < length; i += 1) {
      const isEmpty = emptiness(withIndex(i));
      if (isEmpty) {
        start.next = i + 1;
        continue;
      }
      if (isEmpty === undefined) {
        if (i > index) {
          const ahead = Array.from(
            { length: Math.min(SKIP_START_PREFETCH, length - i) },
            (_, k) => withIndex(i + k),
          );
          const { requestsFor: forMapping, maxAutoFetchSize: maxSize } =
            latest.current;
          if (
            !prefetchSlices(
              dataContext,
              state,
              ahead.map(forMapping),
              forMapping(dimMapping),
              maxSize,
            )
          ) {
            start.isActive = false; // too large to fetch automatically
          }
        }
        return; // wait for values
      }
      // Not empty
      if (i === index) {
        start.isActive = false;
      } else {
        start.expected = JSON.stringify(withIndex(i));
        skip(withIndex(i)); // straight past the empty slices
      }
      return;
    }
    start.isActive = false; // all empty
  }, [
    cacheVersion,
    dataContext,
    dimMapping,
    latest,
    skipEmpty,
    sliceDims,
    state,
  ]);

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
      // Remember only the edited settings, not the hint's defaults
      const changed = Object.entries(settings).filter(
        ([key, val]) => playbackSettings[key as keyof PlaybackSettings] !== val,
      );
      setPlaybackSettings({
        ...storedSettings,
        ...Object.fromEntries(changed),
      });
      setEdited({
        path: datasetPath,
        keys: [...new Set([...editedKeys, ...changed.map(([key]) => key)])],
      });
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
    defaultPlayingDim:
      getPlaybackDim(dimMapping, mapMapping, playbackDim) === playbackDim
        ? playbackDim
        : undefined, // e.g. on an axis
  };

  return { slicingProps, playbackRange };
}

/* Dimension played by default: the given one if sliced and not multi-plotted (as mapped for the
 * vis), else the first such dimension (-1 if none) */
function getPlaybackDim(
  dimMapping: DimensionMapping,
  mapMapping: MapMapping,
  preferred: number | undefined,
): number {
  const visMapping = mapMapping(dimMapping);
  function isPlayable(d: number): boolean {
    return (
      typeof dimMapping[d] === 'number' && typeof visMapping[d] === 'number'
    );
  }
  return preferred !== undefined && isPlayable(preferred)
    ? preferred
    : dimMapping.findIndex((_, d) => isPlayable(d));
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
