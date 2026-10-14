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
import {
  FiChevronLeft,
  FiChevronRight,
  FiPause,
  FiPlay,
  FiSettings,
} from 'react-icons/fi';

import Btn from '../toolbar/controls/Btn';
import {
  POPOVER_CLEARANCE,
  useFloatingDismiss,
} from '../toolbar/controls/hooks';
import {
  clampFps,
  MAX_FPS,
  MIN_FPS,
  type PlaybackMode,
  type PlaybackSettings,
  type PlaybackTiming,
} from './playback';
import styles from './PlaybackControls.module.css';

const MODE_LABELS: Record<PlaybackMode, string> = {
  loop: 'Loop',
  bounce: 'Bounce',
  once: 'Once',
};

const TIMING_LABELS: Record<PlaybackTiming, string> = {
  wait: 'Wait for each slice',
  realtime: 'Skip slices to keep up',
};

interface Props {
  dimension: number;
  isPlaying: boolean;
  settings: PlaybackSettings;
  onTogglePlay: () => void;
  onSettingsChange: (settings: PlaybackSettings) => void;
  onStep: (direction: 1 | -1) => void;
}

function PlaybackControls(props: Props) {
  const {
    dimension,
    isPlaying,
    settings,
    onTogglePlay,
    onSettingsChange,
    onStep,
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
      <Btn
        label={`${isPlaying ? 'Pause' : 'Play'} D${dimension}`}
        Icon={isPlaying ? FiPause : FiPlay}
        iconOnly
        small
        aria-pressed={isPlaying}
        onClick={onTogglePlay}
      />
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
            <label htmlFor={`${fieldId}-fps`}>Speed</label>
            <input
              id={`${fieldId}-fps`}
              aria-label="Slices per second"
              className={styles.fpsInput}
              type="number"
              min={MIN_FPS}
              max={MAX_FPS}
              step="any"
              defaultValue={settings.fps}
              onChange={(evt) => {
                const fps = Number(evt.target.value);
                if (evt.target.value !== '' && Number.isFinite(fps)) {
                  onSettingsChange({ ...settings, fps: clampFps(fps) });
                }
              }}
              onBlur={(evt) => {
                const { target } = evt;
                target.value = settings.fps.toString(); // overwrite invalid input
              }}
            />
            <span className={styles.unit}>slices/s</span>
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
            <legend>When data is slow</legend>
            {(Object.keys(TIMING_LABELS) as PlaybackTiming[]).map((timing) => (
              <label key={timing} className={styles.option}>
                <input
                  type="radio"
                  name={`${fieldId}-timing`}
                  aria-label={TIMING_LABELS[timing]}
                  checked={settings.timing === timing}
                  onChange={() => onSettingsChange({ ...settings, timing })}
                />
                {TIMING_LABELS[timing]}
              </label>
            ))}
          </fieldset>

          <div className={styles.steps}>
            <Btn
              label="Step back"
              Icon={FiChevronLeft}
              small
              raised
              onClick={() => onStep(-1)}
            />
            <Btn
              label="Step forward"
              Icon={FiChevronRight}
              small
              raised
              onClick={() => onStep(1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default PlaybackControls;
