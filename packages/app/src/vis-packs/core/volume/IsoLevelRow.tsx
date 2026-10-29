import { MdClose } from 'react-icons/md';

import { type IsoLevel } from './config';
import styles from './IsosurfacesControl.module.css';
import LevelInput from './LevelInput';

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

  return (
    <li className={styles.level}>
      <input
        type="checkbox"
        aria-label={`Show level ${index}`}
        checked={visible}
        onChange={() => onUpdate({ visible: !visible })}
      />
      <LevelInput
        value={value}
        sliderPosition={sliderPosition}
        label={`Level ${index} value`}
        sliderLabel={`Level ${index} slider`}
        onChange={(newValue) => onUpdate({ value: newValue })}
        onSliderChange={onSliderChange}
      />
      {withColor && (
        <input
          className={styles.colorInput}
          type="color"
          aria-label={`Level ${index} color`}
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
