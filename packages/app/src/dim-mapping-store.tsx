import {
  clampPlaybackFps,
  DEFAULT_PLAYBACK_SETTINGS,
  type DimensionMapping,
  initDimMapping,
  type PlaybackSettings,
} from '@h5web/lib';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { createStore, type StoreApi, useStore } from 'zustand';
import { persist } from 'zustand/middleware';

import { type DefaultSlice } from './vis-packs/nexus/models';
import { applyDefaultSlice, areSameDims } from './vis-packs/nexus/utils';

interface DimMappingState {
  dims: number[];
  axesCount: number;
  lockedDimsCount: number;
  mapping: DimensionMapping;
  multiDim: number | undefined;
}

function createDimMappingStore() {
  return createStore<DimMappingState>(() => ({
    dims: [],
    axesCount: 0,
    lockedDimsCount: 0,
    mapping: [],
    multiDim: undefined,
  }));
}

interface PlaybackSettingsState {
  playbackSettings: PlaybackSettings;
}

/* Playback settings are remembered across datasets, files and reloads (in a separate store, so
 * slicing doesn't write to local storage) */
const PLAYBACK_MODES = new Set<unknown>(['loop', 'bounce', 'once']);
const PLAYBACK_TIMINGS = new Set<unknown>(['wait', 'realtime']);
const PLAYBACK_RANGES = new Set<unknown>(['sequence', 'frame']);

/* Persisted settings may be invalid (e.g. edited or saved by another version): use defaults */
export function sanitizePlaybackSettings(settings: unknown): PlaybackSettings {
  const { fps, mode, timing, range } = (
    typeof settings === 'object' && settings !== null ? settings : {}
  ) as Partial<Record<keyof PlaybackSettings, unknown>>;
  const defaults = DEFAULT_PLAYBACK_SETTINGS;

  return {
    fps:
      typeof fps === 'number' && Number.isFinite(fps)
        ? clampPlaybackFps(fps)
        : defaults.fps,
    mode: PLAYBACK_MODES.has(mode)
      ? (mode as PlaybackSettings['mode'])
      : defaults.mode,
    timing: PLAYBACK_TIMINGS.has(timing)
      ? (timing as PlaybackSettings['timing'])
      : defaults.timing,
    range: PLAYBACK_RANGES.has(range)
      ? (range as PlaybackSettings['range'])
      : defaults.range,
  };
}

function createPlaybackSettingsStore() {
  return createStore<PlaybackSettingsState>()(
    persist(
      (): PlaybackSettingsState => ({
        playbackSettings: DEFAULT_PLAYBACK_SETTINGS,
      }),
      {
        name: 'h5web:playback',
        version: 2,
        migrate: (persisted) => persisted as PlaybackSettingsState, // sanitized in `merge`
        merge: (persisted) => ({
          playbackSettings: sanitizePlaybackSettings(
            (persisted as Partial<PlaybackSettingsState> | undefined)
              ?.playbackSettings,
          ),
        }),
      },
    ),
  );
}

const StoreContext = createContext({} as StoreApi<DimMappingState>);
const PlaybackStoreContext = createContext(
  {} as StoreApi<PlaybackSettingsState>,
);

export function DimMappingProvider(props: PropsWithChildren) {
  const { children } = props;

  const [store] = useState(createDimMappingStore);
  const [playbackStore] = useState(createPlaybackSettingsStore);

  return (
    <StoreContext value={store}>
      <PlaybackStoreContext value={playbackStore}>
        {children}
      </PlaybackStoreContext>
    </StoreContext>
  );
}

export function useDimMappingState(opts: {
  dims: number[];
  axesCount: number;
  lockedDimsCount?: number;
  defaultSlice?: DefaultSlice;
}): [
  DimensionMapping,
  (mapping: DimensionMapping) => void,
  number | undefined,
  (dim: number | undefined) => void,
] {
  const { dims, axesCount, lockedDimsCount = 0, defaultSlice } = opts;

  const store = useContext(StoreContext);
  const state = useStore(store);

  // Prepare new, memoised mapping and setter
  const mapping = useMemo(() => {
    const newMapping = initDimMapping(dims, axesCount, lockedDimsCount);

    return defaultSlice
      ? applyDefaultSlice(newMapping, defaultSlice)
      : newMapping;
  }, [dims, axesCount, lockedDimsCount, defaultSlice]);

  const isStateValid = useCallback(
    (st: DimMappingState) =>
      areSameDims(dims, st.dims) &&
      axesCount === st.axesCount &&
      lockedDimsCount === st.lockedDimsCount,
    [dims, axesCount, lockedDimsCount],
  );

  // Use previous dimension mapping if it is still valid
  const currentMapping = isStateValid(state) ? state.mapping : mapping;
  const currentMultiDim = isStateValid(state) ? state.multiDim : undefined;

  // Read latest store state, as setters can be called asynchronously (e.g. debounced slicing)
  const setMapping = useCallback(
    (newMapping: DimensionMapping) => {
      store.setState((prevState) => {
        const prevMultiDim = isStateValid(prevState)
          ? prevState.multiDim
          : undefined;

        return {
          dims,
          axesCount,
          lockedDimsCount,
          mapping: newMapping,
          // Reset multi-plotting dimension if it is no longer sliceable (e.g. mapped to axis)
          multiDim:
            prevMultiDim !== undefined &&
            typeof newMapping[prevMultiDim] === 'number'
              ? prevMultiDim
              : undefined,
        };
      });
    },
    [dims, axesCount, lockedDimsCount, isStateValid, store],
  );

  const setMultiDim = useCallback(
    (dim: number | undefined) => {
      store.setState((prevState) => ({
        dims,
        axesCount,
        lockedDimsCount,
        mapping: isStateValid(prevState) ? prevState.mapping : mapping,
        multiDim: dim,
      }));
    },
    [dims, axesCount, lockedDimsCount, mapping, isStateValid, store],
  );

  return [currentMapping, setMapping, currentMultiDim, setMultiDim];
}

export function usePlaybackSettingsState(): [
  PlaybackSettings,
  (settings: PlaybackSettings) => void,
] {
  const store = useContext(PlaybackStoreContext);
  const settings = useStore(store, (state) => state.playbackSettings);
  const setSettings = useCallback(
    (playbackSettings: PlaybackSettings) =>
      store.setState({ playbackSettings }),
    [store],
  );

  return [settings, setSettings];
}
