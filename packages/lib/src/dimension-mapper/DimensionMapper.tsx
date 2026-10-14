import { type DimensionMapping } from '@h5web/shared/vis-models';
import { type HTMLAttributes, useState } from 'react';

import AxisMapper from './AxisMapper';
import styles from './DimensionMapper.module.css';
import InertBox from './InertBox';
import { DEFAULT_PLAYBACK_SETTINGS, type PlaybackSettings } from './playback';
import SlicingSlider from './SlicingSlider';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  dims: number[];
  dimHints?: (string | undefined)[];
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
  // Playback: dimension being played (controlled when `onPlayingDimChange` is provided)
  playingDim?: number;
  onPlayingDimChange?: (dim: number | undefined) => void;
  // Playback: speed, repeat mode and timing (controlled when `playbackSettings` is provided)
  playbackSettings?: PlaybackSettings;
  onPlaybackSettingsChange?: (settings: PlaybackSettings) => void;
}

function DimensionMapper(props: Props) {
  const {
    className,
    dims,
    dimHints,
    dimMapping,
    withSlicingControls = false,
    canSliceFast,
    onChange,
    multiDim,
    maxMultiDimLength = 20,
    onMultiDimChange,
    withPlaybackControls = false,
    isSliceReady = canSliceFast,
    prefetchSlices,
    playingDim: controlledPlayingDim,
    onPlayingDimChange,
    playbackSettings: controlledSettings,
    onPlaybackSettingsChange,
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
          dimMapping={dimMapping}
          onChange={handleAxisChange}
        />
        <AxisMapper
          axis="y"
          dimHints={dimHints}
          dimMapping={dimMapping}
          onChange={handleAxisChange}
        />
      </div>
      <div className={styles.sliders}>
        {dimMapping.map((val, index) => {
          if (typeof val !== 'number') {
            return undefined;
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
              length={dims[index]}
              initialValue={val}
              withControls={withSlicingControls}
              isFastSlice={
                canSliceFast && ((newVal) => canSliceFast(withMapping(newVal)))
              }
              onChange={(newVal) => onChange(withMapping(newVal))}
              withPlayback={withPlaybackControls}
              isPlaying={playingDim === index && multiDim !== index}
              onPlayingChange={(isPlaying) => {
                setPlayingDim(isPlaying ? index : undefined);
              }}
              isReady={
                isSliceReady && ((newVal) => isSliceReady(withMapping(newVal)))
              }
              onPrefetch={
                prefetchSlices &&
                ((values, current) =>
                  prefetchSlices(values.map(withMapping), withMapping(current)))
              }
              playbackSettings={playbackSettings}
              onPlaybackSettingsChange={setPlaybackSettings}
            />
          );

          if (!onMultiDimChange) {
            return slider;
          }

          const isMultiDim = multiDim === index;
          const isTooLong = dims[index] > maxMultiDimLength;

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
                title={
                  isTooLong
                    ? `Too many slices to plot at once (max ${maxMultiDimLength})`
                    : `Plot all D${index} slices`
                }
              >
                <input
                  type="checkbox"
                  aria-label={`Plot all D${index} slices`}
                  checked={isMultiDim}
                  disabled={
                    (multiDim !== undefined && !isMultiDim) || // only one multi-plotting dimension at a time
                    dims[index] <= 1 ||
                    isTooLong
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
