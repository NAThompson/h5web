import styles from './LabelledRange.module.css';

interface Props {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

/* Labelled range input of the toolbar, with its value (e.g. height scale of 3D surfaces) */
function LabelledRange(props: Props) {
  const { label, ariaLabel, min, max, step, value, format, onChange } = props;

  return (
    <label className={styles.root}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(evt) => onChange(evt.currentTarget.valueAsNumber)}
      />
      <span
        className={styles.value}
        // As wide as the widest value, so that the slider doesn't move while dragging
        style={{
          minWidth: `${Math.max(format(min).length, format(max).length)}ch`,
        }}
      >
        {format(value)}
      </span>
    </label>
  );
}

export default LabelledRange;
