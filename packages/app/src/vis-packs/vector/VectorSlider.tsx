import styles from '../core/heatmap/HeightScaleSlider.module.css';

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

/* Labelled range input of the toolbar (as the heatmap's height slider) */
function VectorSlider(props: Props) {
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
      <span className={styles.value}>{format(value)}</span>
    </label>
  );
}

export default VectorSlider;
