import { normalizeMinus } from '@h5web/lib';
import { formatInputVal } from '@h5web/shared/vis-utils';
import { useState } from 'react';

import styles from './IsosurfacesControl.module.css';
import { SLIDER_STEPS } from './utils';

interface Props {
  value: number | null; // `null`: none (empty field, disabled slider)
  sliderPosition: number;
  label: string; // of the text field
  sliderLabel: string;
  onChange: (value: number) => void;
  onSliderChange: (position: number) => void;
}

/* Text field of a level (committed on Enter or blur) and its slider */
function LevelInput(props: Props) {
  const { value, sliderPosition, label, sliderLabel } = props;
  const { onChange, onSliderChange } = props;

  const [draft, setDraft] = useState<string>();

  function commitDraft() {
    if (draft !== undefined) {
      const text = normalizeMinus(draft.trim());
      const newValue = Number(text);
      if (text !== '' && Number.isFinite(newValue)) {
        onChange(newValue);
      }
      setDraft(undefined);
    }
  }

  return (
    <>
      <input
        className={styles.valueInput}
        type="text"
        inputMode="decimal"
        aria-label={label}
        placeholder="none"
        value={draft ?? (value === null ? '' : formatInputVal(value))}
        onChange={(evt) => setDraft(evt.currentTarget.value)}
        onBlur={commitDraft}
        onKeyDown={(evt) => {
          if (evt.key === 'Enter') {
            commitDraft();
          }
        }}
      />
      <input
        className={styles.slider}
        type="range"
        aria-label={sliderLabel}
        min={0}
        max={SLIDER_STEPS}
        step={1}
        disabled={value === null}
        value={Number.isFinite(sliderPosition) ? sliderPosition : 0}
        onChange={(evt) => onSliderChange(evt.currentTarget.valueAsNumber)}
      />
    </>
  );
}

export default LevelInput;
