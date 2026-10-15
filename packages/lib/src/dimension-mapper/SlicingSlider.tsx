import {
  Root as SliderRoot,
  Thumb as SliderThumb,
} from '@radix-ui/react-slider';
import { useSize } from '@radix-ui/react-use-size';
import { useMeasure } from '@react-hookz/web';
import { useEffect, useId, useRef, useState } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';

import Btn from '../toolbar/controls/Btn';
import { useDynamicDebouncedCallback, usePlayback } from './hooks';
import {
  getNearestFrame,
  getNextFrame,
  type PlaybackSettings,
} from './playback';
import PlaybackControls from './PlaybackControls';
import styles from './SlicingSlider.module.css';

const ID = 'h5w-slider';
const MIN_HEIGHT_PER_MARK = 25;
const MAX_EMPTY_MARKS_LENGTH = 1000; // above, empty slices are not looked up for marks
const SHORT_DELAY = 20;
const LONG_DELAY = 250;
const SLIDER_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
const STEP_KEYS: Record<string, 1 | -1> = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
};
const PAGE_KEYS: Record<string, 1 | -1> = { PageUp: 1, PageDown: -1 };
const PAGE_STEP = 10; // as Radix

interface Props {
  dimension: number;
  label?: string; // short name of the dimension (default: D<dimension>)
  hint?: string; // full name, e.g. with units
  length: number;
  initialValue: number;
  withControls: boolean;
  isFastSlice?: (value: number) => boolean;
  onChange: (value: number) => void;
  withPlayback?: boolean;
  isPlaying?: boolean;
  onPlayingChange?: (isPlaying: boolean) => void;
  isReady?: (value: number) => boolean;
  emptySlices?: ReadonlySet<number>; // skipped by playback and steps; hollow marks on the track
  onPrefetch?: (values: number[], current: number) => boolean;
  playbackSettings: PlaybackSettings;
  onPlaybackSettingsChange: (settings: PlaybackSettings) => void;
  playbackRangeHint?: string;
}

function SlicingSlider(props: Props) {
  const {
    dimension,
    label,
    hint,
    length,
    initialValue,
    withControls,
    isFastSlice,
    onChange,
    withPlayback = false,
    isPlaying = false,
    onPlayingChange,
    isReady,
    emptySlices,
    onPrefetch,
    playbackSettings,
    onPlaybackSettingsChange,
    playbackRangeHint,
  } = props;

  if (length <= 0) {
    throw new Error('Expected non-empty dimension');
  }

  const [stride, setStride] = useState(1);
  const strideInputId = useId();

  const [value, setValue] = useState(initialValue);
  const isEmpty = emptySlices && ((val: number) => emptySlices.has(val));

  /* During playback, frames are only shown once ready, so there is no need to debounce.
   * Ref is updated on render, and as soon as user interaction pauses playback (so the slice
   * picked by the user is debounced as usual). */
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const onDebouncedChange = useDynamicDebouncedCallback(
    (val: number) => {
      setEmittedValue(val);
      onChange(val);
    },
    [onChange],
    (val) => {
      if (isPlayingRef.current) {
        return 0;
      }
      return isFastSlice?.(val) ? SHORT_DELAY : LONG_DELAY;
    },
  );

  // Follow values set from outside (e.g. past an empty first slice), not echoes of the slider's own
  const [propValue, setPropValue] = useState(initialValue);
  const [emittedValue, setEmittedValue] = useState<number>(); // emitted, not echoed yet
  if (initialValue !== propValue) {
    setPropValue(initialValue);
    setEmittedValue(undefined);
    if (initialValue !== emittedValue) {
      onDebouncedChange.cancel(); // outside value wins over a pending one
      setValue(initialValue);
    }
  }

  const waiting = usePlayback({
    isPlaying: isPlaying && length > 1,
    value,
    length,
    stride,
    settings: playbackSettings,
    isReady: (val) => isReady?.(val) ?? true,
    isSkipped: isEmpty,
    onFrame: (newValue) => {
      setValue(newValue);
      onDebouncedChange(newValue);
    },
    onEnd: () => onPlayingChange?.(false),
    onPrefetch,
  });

  function pause() {
    if (isPlaying) {
      isPlayingRef.current = false;
      onPlayingChange?.(false);
    }
  }

  function moveTo(next: number | undefined) {
    pause();
    if (next !== undefined && next !== value) {
      setValue(next);
      onDebouncedChange(next);
    }
  }

  function step(direction: 1 | -1, by = stride) {
    const next = getNextFrame(
      { value, direction },
      { length, stride: by, mode: 'once', isSkipped: isEmpty },
    );
    moveTo(next?.value);
  }

  /* Keys of the slider, over empty slices: by one slice (by a page with `Shift`), to the first
   * or last slice, or by a page, landing on the nearest slice that isn't empty */
  function handleKeyOverEmpty(key: string, shiftKey: boolean): boolean {
    const direction = STEP_KEYS[key] ?? PAGE_KEYS[key];
    if (key === 'Home' || key === 'End') {
      const [target, dir] =
        key === 'Home' ? [0, 1 as const] : [length - 1, -1 as const];
      moveTo(getNearestFrame(target, dir, value, length, isEmpty));
    } else if (key in PAGE_KEYS || (key in STEP_KEYS && shiftKey)) {
      moveTo(
        getNearestFrame(
          value + direction * PAGE_STEP,
          direction,
          value,
          length,
          isEmpty,
        ),
      );
    } else if (key in STEP_KEYS) {
      step(direction, 1);
    } else {
      return false;
    }
    return true;
  }

  const [containerSize, containerRef] = useMeasure<HTMLDivElement>();

  // Once Radix has measured the thumb, it offsets it to keep it within the bounds of the slider;
  // measure it the same way to cancel this offset, so the thumb ends up centred on its value
  const [thumb, setThumb] = useState<HTMLSpanElement | null>(null);
  const thumbSize = useSize(thumb);

  const sliderLabelId = `${ID}-${dimension}-label`;

  return (
    <div key={dimension} ref={containerRef} className={styles.container}>
      <span id={sliderLabelId} className={styles.label} title={hint}>
        {label ?? `D${dimension}`}
      </span>
      <span className={styles.sublabel}>0:{length - 1}</span>
      {length > 1 && (
        <>
          <SliderRoot
            className={styles.slider}
            orientation="vertical"
            min={0}
            max={length - 1}
            step={1}
            value={[value]}
            onPointerDown={pause}
            onValueChange={([newValue]) => {
              pause();
              setValue(newValue);
              onDebouncedChange(newValue);
            }}
          >
            <span className={styles.track} />
            {containerSize &&
              (containerSize.height / length >= MIN_HEIGHT_PER_MARK ||
                (emptySlices && length <= MAX_EMPTY_MARKS_LENGTH)) &&
              Array.from({ length }, (_, index) => {
                // Empty slices are marked even when there are too many slices to mark them all
                const empty = emptySlices?.has(index);
                return (
                  (empty ||
                    containerSize.height / length >= MIN_HEIGHT_PER_MARK) && (
                    <span
                      key={index}
                      className={styles.mark}
                      data-empty={empty || undefined}
                      style={{ bottom: `${(index / (length - 1)) * 100}%` }}
                    />
                  )
                );
              })}
            <SliderThumb
              ref={setThumb}
              className={styles.thumb}
              aria-labelledby={sliderLabelId}
              aria-keyshortcuts={withPlayback ? 'Space' : undefined}
              onKeyDown={(evt) => {
                if (withPlayback && evt.key === ' ') {
                  evt.preventDefault(); // don't scroll
                  onPlayingChange?.(!isPlaying);
                } else if (
                  isEmpty &&
                  handleKeyOverEmpty(evt.key, evt.shiftKey)
                ) {
                  evt.preventDefault(); // over empty slices instead
                } else if (SLIDER_KEYS.has(evt.key)) {
                  pause(); // even if value doesn't change (e.g. `Home` on first slice)
                }
              }}
              style={
                thumbSize?.height
                  ? { translate: `0 ${(0.5 - value / (length - 1)) * 100}%` }
                  : {}
              }
            >
              <span className={styles.thumbValue}>{value}</span>
            </SliderThumb>
          </SliderRoot>

          {withPlayback && (
            <PlaybackControls
              dimension={dimension}
              isPlaying={isPlaying}
              waiting={waiting}
              settings={playbackSettings}
              rangeHint={playbackRangeHint}
              onTogglePlay={() => onPlayingChange?.(!isPlaying)}
              onSettingsChange={onPlaybackSettingsChange}
            />
          )}

          {withControls && (
            <div className={styles.slicingControls}>
              <Btn
                label="Next slice"
                Icon={FiChevronUp}
                iconOnly
                small
                onClick={() => step(1)}
              />
              <Btn
                label="Previous slice"
                Icon={FiChevronDown}
                iconOnly
                small
                onClick={() => step(-1)}
              />
              <div className={styles.stride} title={`D${dimension} stride`}>
                <label
                  className={styles.strideLabel}
                  htmlFor={strideInputId}
                  aria-label="Stride"
                >
                  Δ
                </label>
                <input
                  id={strideInputId}
                  type="text"
                  className={styles.strideInput}
                  aria-label={`D${dimension} stride`}
                  defaultValue={stride}
                  onChange={(evt) => {
                    const newStride = Math.floor(Number(evt.target.value));
                    if (Number.isFinite(newStride) && newStride > 0) {
                      setStride(newStride);
                    }
                  }}
                  onFocus={(evt) => {
                    evt.target.select();
                  }}
                  onBlur={(evt) => {
                    const { target } = evt;
                    target.value = stride.toString(); // overwrite any invalid input on blur
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SlicingSlider;
