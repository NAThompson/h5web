import { type DimensionMapping } from '@h5web/shared/vis-models';
import { type HTMLAttributes, useMemo, useState } from 'react';

import AxisMapper from './AxisMapper';
import styles from './DimensionMapper.module.css';
import InertBox from './InertBox';
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettings } from './playback';
import SlicingSlider, { MAX_EMPTY_MARKS_LENGTH } from './SlicingSlider';

const MAX_EMPTY_LOOKUPS = MAX_EMPTY_MARKS_LENGTH; // slices of a dimension all looked up at once

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  dims: number[];
  dimHints?: (string | undefined)[];
  dimLabels?: (string | undefined)[]; // short names of the dimensions (default: D0, D1...)
  sliceLabels?: (string[] | undefined)[]; // labels of the indices of each dimension
  dimMapping: DimensionMapping;
  withSlicingControls?: boolean;
  canSliceFast?: (nextMapping: DimensionMapping) => boolean; // shortens debounce delay when slicing
  onChange: (d: DimensionMapping) => void;
  multiDim?: number;
  maxMultiDimLength?: number;
  onMultiDimChange?: (dim: number | undefined) => void; // shows multi-plotting checkboxes when provided
  withPlaybackControls?: boolean;
  /* Playback: whether a slice can be shown without waiting for data (defaults to `canSliceFast`).
   * Playback never shows a slice before it is ready. */
  isSliceReady?: (mapping: DimensionMapping) => boolean;
  /* Playback: called repeatedly with the mappings of upcoming slices, in playback order, and
   * with the current mapping (upcoming list is empty once playback stops). Return `false` if
   * upcoming slices can't be fetched automatically (e.g. they need confirmation), `true` otherwise. When provided,
   * playback waits for the *next* slice to be ready before showing it; otherwise, it waits for
   * the current slice to be ready before moving on. */
  prefetchSlices?: (
    nextMappings: DimensionMapping[],
    currentMapping: DimensionMapping,
  ) => boolean;
  /* Slices known to be empty (e.g. all `NaN`): skipped by playback, step buttons and arrow keys.
   * Called for every slice of each sliced dimension when it changes identity (or the mapping
   * does), so it should only change when emptiness may have (e.g. new values in a cache). */
  isSliceEmpty?: (mapping: DimensionMapping) => boolean;
  // Playback: dimension played by default (e.g. from a file's hint), whose play button is marked
  defaultPlayingDim?: number;
  // Playback: dimension being played (controlled when `onPlayingDimChange` is provided)
  playingDim?: number;
  onPlayingDimChange?: (dim: number | undefined) => void;
  // Playback: speed, repeat mode and range (controlled when `playbackSettings` is provided)
  playbackSettings?: PlaybackSettings;
  onPlaybackSettingsChange?: (settings: PlaybackSettings) => void;
  // Playback: note about the value range in use (e.g. when the whole sequence's range is unknown)
  playbackRangeHint?: string;
  // Recording: called before each frame is snapshot (e.g. to load panels out of view)
  beforeSnapshot?: () => Promise<void> | void;
  // Dimension reduced instead of sliced (e.g. maximum over it), shown without a slider
  projectedDim?: number;
  projectionLabel?: string; // e.g. `max`
}

function DimensionMapper(props: Props) {
  const {
    className,
    dims,
    dimHints,
    dimLabels,
    sliceLabels,
    dimMapping,
    withSlicingControls = false,
    canSliceFast,
    onChange,
    multiDim,
    maxMultiDimLength = 20,
    onMultiDimChange,
    withPlaybackControls = false,
    isSliceReady = canSliceFast,
    isSliceEmpty,
    prefetchSlices,
    defaultPlayingDim,
    playingDim: controlledPlayingDim,
    onPlayingDimChange,
    playbackSettings: controlledSettings,
    onPlaybackSettingsChange,
    playbackRangeHint,
    beforeSnapshot,
    projectedDim,
    projectionLabel = 'projected',
    ...htmlProps
  } = props;

  // Only one dimension plays at a time, to avoid conflicting mapping updates
  const [localPlayingDim, setLocalPlayingDim] = useState<number>();
  const playingDim = onPlayingDimChange
    ? controlledPlayingDim
    : localPlayingDim;
  function setPlayingDim(dim: number | undefined) {
    if (dim !== playingDim) {
      setLocalPlayingDim(dim);
      onPlayingDimChange?.(dim);
    }
  }

  // Shared by all dimensions; kept here so they survive sliders being remounted
  const [localSettings, setLocalSettings] = useState(DEFAULT_PLAYBACK_SETTINGS);
  const playbackSettings = controlledSettings ?? localSettings;
  function setPlaybackSettings(settings: PlaybackSettings) {
    setLocalSettings(settings);
    onPlaybackSettingsChange?.(settings);
  }

  /* Empty slices of each sliced dimension (the other dimensions at their current index): looked
   * up once for short dimensions (e.g. to mark them all), lazily for long ones */
  const emptySlices = useMemo(
    () =>
      isSliceEmpty &&
      dimMapping.map(
        (val, dim): Pick<ReadonlySet<number>, 'has'> | undefined => {
          if (typeof val !== 'number') {
            return undefined;
          }
          function withIndex(i: number): DimensionMapping {
            return dimMapping.map((v, d) => (d === dim ? i : v));
          }
          if (dims[dim] > MAX_EMPTY_LOOKUPS) {
            return { has: (i) => isSliceEmpty(withIndex(i)) };
          }
          return new Set(
            Array.from({ length: dims[dim] }, (_, i) => i).filter((i) =>
              isSliceEmpty(withIndex(i)),
            ),
          );
        },
      ),
    [isSliceEmpty, dimMapping, dims],
  );

  if (dims.length !== dimMapping.length) {
    throw new Error('Expected dimensions and mapping arrays of same length');
  }

  if (dimMapping.length === 0) {
    return null;
  }

  function handleAxisChange(newMapping: DimensionMapping) {
    setPlayingDim(undefined);
    onChange(newMapping);

    // Reset multi-plotting dimension if it gets mapped to an axis
    if (multiDim !== undefined && typeof newMapping[multiDim] !== 'number') {
      onMultiDimChange?.(undefined);
    }
  }

  return (
    <div className={`${styles.mapper} ${className}`} {...htmlProps}>
      <div className={styles.axisMapperWrapper}>
        <div className={styles.dims}>
          <span className={styles.dimsLabel}>
            <abbr title="Number of elements in each dimension">n</abbr>
          </span>
          {dims.map((d, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <span key={i} className={styles.dimSize}>
              {' '}
              {d}
            </span>
          ))}
        </div>
        <AxisMapper
          axis="x"
          dimHints={dimHints}
          dimLabels={dimLabels}
          dimMapping={dimMapping}
          onChange={handleAxisChange}
        />
        <AxisMapper
          axis="y"
          dimHints={dimHints}
          dimLabels={dimLabels}
          dimMapping={dimMapping}
          onChange={handleAxisChange}
        />
      </div>
      <div className={styles.sliders}>
        {dimMapping.map((val, index) => {
          if (typeof val !== 'number') {
            return undefined;
          }

          if (index === projectedDim) {
            const dimLabel = dimLabels?.[index] ?? `D${index}`;
            return (
              <div
                key={index} // eslint-disable-line react/no-array-index-key
                className={styles.projected}
                role="group"
                aria-label={`${dimLabel} projected`}
                title={dimHints?.[index]}
              >
                <span className={styles.projectedLabel}>{dimLabel}</span>
                <span className={styles.projectedValue}>{projectionLabel}</span>
                <span className={styles.projectedRange}>
                  over 0:{dims[index] - 1}
                </span>
              </div>
            );
          }

          function withMapping(newVal: number): DimensionMapping {
            const newMapping = [...dimMapping];
            newMapping[index] = newVal;
            return newMapping;
          }

          const slider = (
            <SlicingSlider
              key={index} // eslint-disable-line react/no-array-index-key
              dimension={index}
              label={dimLabels?.[index]}
              hint={dimHints?.[index]}
              valueLabels={sliceLabels?.[index]}
              length={dims[index]}
              initialValue={val}
              withControls={withSlicingControls}
              isFastSlice={
                canSliceFast && ((newVal) => canSliceFast(withMapping(newVal)))
              }
              onChange={(newVal) => onChange(withMapping(newVal))}
              withPlayback={withPlaybackControls}
              isPlaying={playingDim === index && multiDim !== index}
              isDefaultPlayback={defaultPlayingDim === index}
              onPlayingChange={(isPlaying) => {
                setPlayingDim(isPlaying ? index : undefined);
              }}
              isReady={
                isSliceReady && ((newVal) => isSliceReady(withMapping(newVal)))
              }
              emptySlices={emptySlices?.[index]}
              onPrefetch={
                prefetchSlices &&
                ((values, current) =>
                  prefetchSlices(values.map(withMapping), withMapping(current)))
              }
              playbackSettings={playbackSettings}
              onPlaybackSettingsChange={setPlaybackSettings}
              playbackRangeHint={playbackRangeHint}
              beforeSnapshot={beforeSnapshot}
            />
          );

          if (!onMultiDimChange) {
            return slider;
          }

          const isMultiDim = multiDim === index;
          // Nothing to plot all at once: no toggle (rather than a disabled one)
          if (dims[index] <= 1 || dims[index] > maxMultiDimLength) {
            return (
              <div
                key={index} // eslint-disable-line react/no-array-index-key
                className={styles.sliderWrapper}
              >
                {slider}
              </div>
            );
          }

          return (
            <div
              key={index} // eslint-disable-line react/no-array-index-key
              className={styles.sliderWrapper}
            >
              {/* Disable slider of multi-plotting dimension */}
              <InertBox className={styles.sliderBox} inert={isMultiDim}>
                {slider}
              </InertBox>
              <label
                className={styles.multiToggle}
                title={`Plot all D${index} slices`}
              >
                <input
                  type="checkbox"
                  aria-label={`Plot all D${index} slices`}
                  checked={isMultiDim}
                  disabled={
                    multiDim !== undefined && !isMultiDim // only one multi-plotting dimension at a time
                  }
                  onChange={() => {
                    if (playingDim === index) {
                      setPlayingDim(undefined); // can't play multi-plotting dimension
                    }
                    onMultiDimChange(isMultiDim ? undefined : index);
                  }}
                />
                all
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { Props as DimensionMapperProps };
export default DimensionMapper;
