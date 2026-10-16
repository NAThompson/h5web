import { renderMarkup } from '../view-hints/markup';
import styles from './Panels.module.css';

interface Props {
  labels: { x?: string; y?: string };
  rows: number;
  cols: number;
  visibleSize: [number, number]; // of the grid's area: labels stay in view as it scrolls
}

/* Axis labels of all panels, once: x under the grid, y to its left (first column and last row) */
function SharedAxisLabels(props: Props) {
  const { labels, rows, cols, visibleSize } = props;
  const [width, height] = visibleSize;
  return (
    <>
      {labels.y && (
        <p
          className={styles.yLabel}
          style={{
            gridRow: `1 / span ${rows}`,
            gridColumn: 1,
            maxHeight: height,
          }}
        >
          {renderMarkup(labels.y)}
        </p>
      )}
      {labels.x && (
        <p
          className={styles.xLabel}
          style={{
            gridRow: rows + 1,
            gridColumn: `2 / span ${cols}`,
            maxWidth: width,
          }}
        >
          {renderMarkup(labels.x)}
        </p>
      )}
    </>
  );
}

export default SharedAxisLabels;
