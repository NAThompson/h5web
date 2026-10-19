import styles from './Orthoslices.module.css';

interface Props {
  label: string; // axis name, e.g. `x`
  title?: string; // e.g. name of the dimension
  color: string; // of the crosshair line standing for the slice
  value: number;
  count: number; // indices from 0 to `count - 1`
  onChange: (value: number) => void;
}

/* Index of a slice, as a slider with its value: applies while dragging (slicing is local) */
function SliceIndexInput(props: Props) {
  const { label, title, color, value, count, onChange } = props;

  return (
    <label className={styles.indexInput} title={title}>
      <span className={styles.indexLabel} style={{ color }}>
        {label}
      </span>
      <input
        type="range"
        aria-label={`${label} index`}
        min={0}
        max={count - 1}
        step={1}
        value={value}
        style={{ accentColor: color }}
        onChange={(evt) => onChange(evt.currentTarget.valueAsNumber)}
      />
      <span
        className={styles.indexValue}
        style={{ minWidth: `${String(count - 1).length}ch` }}
      >
        {value}
      </span>
    </label>
  );
}

export default SliceIndexInput;
