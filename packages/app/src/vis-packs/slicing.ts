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
import {
  createPrefetchState,
  prefetchSlices,
  releasePrefetches,
} from './prefetch';

export type SlicingProps = Required<
  Pick<
    DimensionMapperProps,
    | 'canSliceFast'
    | 'withPlaybackControls'
    | 'isSliceReady'
    | 'prefetchSlices'
    | 'playbackSettings'
    | 'onPlaybackSettingsChange'
  >
>;

/* Props to pass to `DimensionMapper` for fast slicing and playback, given the values a vis
 * fetches for a selection (the same values passed to `LargeValueGuard`). `mapMapping` converts
 * the dimension mapper's mapping to the vis' (e.g. for multi-plotting). */
export function useSlicingProps(
  getRequests: (selection: string | undefined) => ValueQueryParams[],
  mapMapping: (mapping: DimensionMapping) => DimensionMapping = (m) => m,
): SlicingProps {
  const dataContext = useDataContext();
  const [state] = useState(createPrefetchState);
  const [playbackSettings, setPlaybackSettings] = usePlaybackSettingsState();

  // Prefetch only what `LargeValueGuard` would let through in this vis
  const [confirmedSize] = useConfirmedSize(getGuardKey(getRequests(undefined)));
  const maxAutoFetchSize = getMaxAutoFetchSize(confirmedSize);

  useUnmountEffect(() => {
    releasePrefetches(dataContext, state);
  });

  function requestsFor(mapping: DimensionMapping): ValueQueryParams[] {
    return getRequests(getSliceSelection(mapMapping(mapping)));
  }

  return {
    // Sliced values in cache: no need to wait for debounce
    canSliceFast: (mapping) =>
      requestsFor(mapping)
        .filter(({ selection }) => selection !== undefined)
        .every(({ dataset, selection }) =>
          isValueInCache(dataContext, dataset, selection),
        ),

    // Playback can show slices whose values are in cache or failed to load (to show the error)
    isSliceReady: (mapping) =>
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
  };
}

export function useDatasetSlicingProps(
  dataset: Dataset<ScalarShape | ArrayShape>,
  mapMapping?: (mapping: DimensionMapping) => DimensionMapping,
): SlicingProps {
  return useSlicingProps((selection) => [{ dataset, selection }], mapMapping);
}

export function useNxSlicingProps(
  nxData: NxData,
  mapMapping?: (mapping: DimensionMapping) => DimensionMapping,
): SlicingProps {
  return useSlicingProps(
    (selection) => Object.values(getNxValueRequests(nxData, selection)),
    mapMapping,
  );
}
