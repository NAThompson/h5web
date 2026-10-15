import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { useToggle } from '@react-hookz/web';
import { useId } from 'react';
import { FiLoader, FiPause, FiPlay, FiSettings } from 'react-icons/fi';

import Btn from '../toolbar/controls/Btn';
import {
  POPOVER_CLEARANCE,
  useFloatingDismiss,
} from '../toolbar/controls/hooks';
import FpsInput from './FpsInput';
import { type PlaybackWaiting } from './hooks';
import {
  type PlaybackMode,
  type PlaybackRange,
  type PlaybackSettings,
} from './playback';
import styles from './PlaybackControls.module.css';

const MODE_LABELS: Record<PlaybackMode, string> = {
  loop: 'Loop',
  bounce: 'Bounce',
  once: 'Once',
};

const RANGE_LABELS: Record<PlaybackRange, string> = {
  sequence: 'Whole sequence',
  frame: 'Each slice',
};

const WAITING_TITLES: Record<PlaybackWaiting, string> = {
  loading: 'Waiting for next slice to load',
  blocked: 'Waiting for confirmation to load next slice',
};

interface Props {
  dimension: number;
  isPlaying: boolean;
  isDefault?: boolean; // dimension played by default (e.g. from a file's hint): marked
  waiting?: PlaybackWaiting;
  settings: PlaybackSettings;
  rangeHint?: string;
  onTogglePlay: () => void;
  onSettingsChange: (settings: PlaybackSettings) => void;
}

function PlaybackControls(props: Props) {
  const {
    dimension,
    isPlaying,
    isDefault,
    waiting,
    settings,
    rangeHint,
    onTogglePlay,
    onSettingsChange,
  } = props;

  // Open to the side of the slider, since the controls sit at the bottom of the mapper
  const [isOpen, toggleOpen] = useToggle();
  const { context, refs, floatingStyles } = useFloating<HTMLButtonElement>({
    open: isOpen,
    onOpenChange: toggleOpen,
    placement: 'right-end',
    middleware: [
      offset(POPOVER_CLEARANCE),
      flip(),
      shift({ padding: POPOVER_CLEARANCE }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const { floatingId } = context;
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useFloatingDismiss(context),
  ]);

  const fieldId = useId();

  return (
    <div className={styles.controls}>
      <span
        className={styles.playBtn}
        data-waiting={waiting}
        data-default={isDefault || undefined}
      >
        <Btn
          label={`Play D${dimension}`}
          Icon={waiting ? FiLoader : isPlaying ? FiPause : FiPlay}
          iconOnly
          small
          aria-pressed={isPlaying}
          aria-busy={!!waiting}
          aria-describedby={waiting && `${fieldId}-waiting`}
          title={
            waiting
              ? `${WAITING_TITLES[waiting]} (click to pause)`
              : isDefault
                ? 'Default playback dimension'
                : undefined
          }
          onClick={onTogglePlay}
        />
        {waiting && (
          <span id={`${fieldId}-waiting`} className={styles.srOnly}>
            {WAITING_TITLES[waiting]}
          </span>
        )}
      </span>
      <Btn
        ref={refs.setReference}
        label={`D${dimension} playback settings`}
        Icon={FiSettings}
        iconOnly
        small
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={(isOpen && floatingId) || undefined}
        {...getReferenceProps()}
      />

      {isOpen && (
        <div
          ref={refs.setFloating}
          id={floatingId}
          className={styles.popover}
          style={floatingStyles}
          role="dialog"
          aria-label={`D${dimension} playback settings`}
          {...getFloatingProps()}
        >
          <div className={styles.field}>
            <label id={`${fieldId}-fps-label`} htmlFor={`${fieldId}-fps`}>
              Speed
            </label>
            <FpsInput
              id={`${fieldId}-fps`}
              labelledBy={`${fieldId}-fps-label ${fieldId}-fps-unit`}
              fps={settings.fps}
              onChange={(fps) => onSettingsChange({ ...settings, fps })}
            />
            <span id={`${fieldId}-fps-unit`} className={styles.unit}>
              slices/s
            </span>
          </div>

          <fieldset className={styles.fieldset}>
            <legend>Repeat</legend>
            {(Object.keys(MODE_LABELS) as PlaybackMode[]).map((mode) => (
              <label key={mode} className={styles.option}>
                <input
                  type="radio"
                  name={`${fieldId}-mode`}
                  aria-label={MODE_LABELS[mode]}
                  checked={settings.mode === mode}
                  onChange={() => onSettingsChange({ ...settings, mode })}
                />
                {MODE_LABELS[mode]}
              </label>
            ))}
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend>Range</legend>
            {(Object.keys(RANGE_LABELS) as PlaybackRange[]).map((range) => (
              <label key={range} className={styles.option}>
                <input
                  type="radio"
                  name={`${fieldId}-range`}
                  aria-label={`Range: ${RANGE_LABELS[range]}`}
                  checked={settings.range === range}
                  onChange={() => onSettingsChange({ ...settings, range })}
                />
                {RANGE_LABELS[range]}
              </label>
            ))}
            {rangeHint && settings.range === 'sequence' && (
              <p className={styles.hint} role="status">
                {rangeHint}
              </p>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

export default PlaybackControls;
