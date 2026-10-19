import { useState } from 'react';

import styles from './Orthoslices.module.css';

interface Props {
  label: string; // axis name, e.g. `x`
  title?: string; // e.g. name of the dimension
  color: string; // of the crosshair line standing for the slice
  value: number;
  count: number; // indices from 0 to `count - 1`
  onChange: (value: number) => void;
}

/* Index of a slice, as a number box: valid entries apply as they are typed (slicing is local) */
function SliceIndexInput(props: Props) {
  const { label, title, color, value, count, onChange } = props;
  const [draft, setDraft] = useState<string>(); // while typing

  return (
    <label className={styles.indexInput} title={title}>
      <span className={styles.indexLabel} style={{ color }}>
        {label}
      </span>
      <input
        type="number"
        aria-label={`${label} index`}
        min={0}
        max={count - 1}
        step={1}
        value={draft ?? value}
        onChange={(evt) => {
          const { value: text, valueAsNumber: index } = evt.currentTarget;
          setDraft(text);
          if (Number.isInteger(index) && index >= 0 && index < count) {
            onChange(index);
          }
        }}
        onBlur={() => setDraft(undefined)}
      />
    </label>
  );
}

export default SliceIndexInput;
