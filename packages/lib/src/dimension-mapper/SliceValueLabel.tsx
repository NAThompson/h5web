import styles from './SlicingSlider.module.css';

interface Props {
  labels: string[] | undefined;
  value: number;
  dimension: number;
}

/* Label of the current index, with all labels in the tooltip */
function SliceValueLabel(props: Props) {
  const { labels, value, dimension } = props;
  if (!labels) {
    return null;
  }

  return (
    <span
      className={styles.valueLabel}
      title={labels.map((text, i) => `${i}: ${text}`).join('\n')}
      data-testid={`D${dimension} slice label`}
    >
      {labels[value]}
    </span>
  );
}

export default SliceValueLabel;
