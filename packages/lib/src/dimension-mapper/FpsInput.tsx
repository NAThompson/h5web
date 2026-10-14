import { useState } from 'react';

import { clampFps, MAX_FPS, MIN_FPS } from './playback';
import styles from './PlaybackControls.module.css';

interface Props {
  id: string;
  labelledBy: string;
  fps: number;
  onChange: (fps: number) => void;
}

/* Keep what the user types while editing (even if playback re-renders), apply valid values
 * as they are typed, and show the applied value once done (Enter or blur) */
function FpsInput(props: Props) {
  const { id, labelledBy, fps, onChange } = props;
  const [draft, setDraft] = useState<string>();

  function apply(text: string) {
    const value = Number(text);
    if (text.trim() !== '' && Number.isFinite(value)) {
      onChange(clampFps(value));
    }
  }

  return (
    <input
      id={id}
      aria-labelledby={labelledBy}
      className={styles.fpsInput}
      type="number"
      min={MIN_FPS}
      max={MAX_FPS}
      step="any"
      value={draft ?? fps}
      onChange={(evt) => {
        setDraft(evt.target.value);
        apply(evt.target.value);
      }}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter') {
          apply(evt.currentTarget.value);
          setDraft(undefined);
        }
      }}
      onBlur={() => setDraft(undefined)}
    />
  );
}

export default FpsInput;
