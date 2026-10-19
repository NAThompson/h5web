import { useState } from 'react';

import styles from './LogSlider.module.css';

const STEPS = 200;

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: 'percent' | 'times'; // shown as `30 %` or `×1.5`
  onChange: (value: number) => void;
}

function formatValue(value: number, isPercent: boolean): string {
  return String(Number((isPercent ? value * 100 : value).toPrecision(2)));
}

/* Slider over a logarithmic range (e.g. small opacities of dense clouds), with a number box */
function LogSlider(props: Props) {
  const { label, value, min, max, unit, onChange } = props;
  const isPercent = unit === 'percent';
  const [draft, setDraft] = useState<string>(); // while typing

  function toStep(val: number): number {
    return Math.round((STEPS * Math.log(val / min)) / Math.log(max / min));
  }

  function fromStep(step: number): number {
    return min * (max / min) ** (step / STEPS);
  }

  function commit() {
    const entered = Number(draft) / (isPercent ? 100 : 1);
    if (draft !== undefined && Number.isFinite(entered) && entered > 0) {
      onChange(Math.min(Math.max(entered, min), max));
    }
    setDraft(undefined);
  }

  return (
    <label className={styles.root}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.range}
        type="range"
        aria-label={label}
        min={0}
        max={STEPS}
        value={toStep(value)}
        onChange={(evt) => onChange(fromStep(evt.currentTarget.valueAsNumber))}
      />
      {!isPercent && <span className={styles.unit}>×</span>}
      <input
        className={styles.number}
        type="text"
        inputMode="decimal"
        aria-label={`${label} value`}
        value={draft ?? formatValue(value, isPercent)}
        onChange={(evt) => setDraft(evt.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(evt) => {
          if (evt.key === 'Enter') {
            commit();
          }
        }}
      />
      {isPercent && <span className={styles.unit}>%</span>}
    </label>
  );
}

export default LogSlider;
