import { normalizeMinus } from '@h5web/lib';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { useState } from 'react';
import { MdClose } from 'react-icons/md';

import { type IsoLevel } from './config';
import styles from './IsosurfacesControl.module.css';
import { SLIDER_STEPS } from './utils';

interface RowProps {
  level: IsoLevel;
  index: number;
  sliderPosition: number;
  withColor: boolean;
  onSliderChange: (position: number) => void;
  onUpdate: (update: Partial<Omit<IsoLevel, 'id'>>) => void;
  onRemove: () => void;
}

function IsoLevelRow(props: RowProps) {
  const {
    level,
    index,
    sliderPosition,
    withColor,
    onSliderChange,
    onUpdate,
    onRemove,
  } = props;
  const { value, visible, opacity, color } = level;

  const [draft, setDraft] = useState<string>();

  function commitDraft() {
    if (draft !== undefined) {
      const text = normalizeMinus(draft.trim());
      const newValue = Number(text);
      if (text !== '' && Number.isFinite(newValue)) {
        onUpdate({ value: newValue });
      }
      setDraft(undefined);
    }
  }

  return (
    <li className={styles.level}>
      <input
        type="checkbox"
        aria-label={`Show level ${index}`}
        checked={visible}
        onChange={() => onUpdate({ visible: !visible })}
      />
      <input
        className={styles.valueInput}
        type="text"
        inputMode="decimal"
        aria-label={`Level ${index} value`}
        value={draft ?? formatTooltipVal(value)}
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
        aria-label={`Level ${index} slider`}
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={Number.isFinite(sliderPosition) ? sliderPosition : 0}
        onChange={(evt) => onSliderChange(evt.currentTarget.valueAsNumber)}
      />
      {withColor && (
        <input
          className={styles.colorInput}
          type="color"
          aria-label={`Level ${index} colour`}
          value={color}
          onChange={(evt) => onUpdate({ color: evt.currentTarget.value })}
        />
      )}
      <input
        className={styles.opacity}
        type="range"
        aria-label={`Level ${index} opacity`}
        title="Opacity"
        min={0.1}
        max={1}
        step={0.05}
        value={opacity}
        onChange={(evt) =>
          onUpdate({ opacity: evt.currentTarget.valueAsNumber })
        }
      />
      <button
        className={styles.removeBtn}
        type="button"
        aria-label={`Remove level ${index}`}
        onClick={onRemove}
      >
        <MdClose aria-hidden />
      </button>
    </li>
  );
}

export default IsoLevelRow;
