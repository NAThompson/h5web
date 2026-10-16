import { renderMarkup } from '../view-hints/markup';
import styles from './Panels.module.css';

interface Props {
  labels: { x?: string; y?: string };
  rows: number;
  cols: number;
  start: [number, number]; // grid row and column of the first panel
  visibleSize: [number, number]; // of the grid's area: labels stay in view as it scrolls
}

/* Axis labels of all panels, once: x under the grid, y to its left (first column and last row
 * of the grid) */
function SharedAxisLabels(props: Props) {
  const { labels, rows, cols, start, visibleSize } = props;
  const [width, height] = visibleSize;
  const [firstRow, firstCol] = start;
  return (
    <>
      {labels.y && (
        <p
          className={styles.yLabel}
          style={{
            gridRow: `${firstRow} / span ${rows}`,
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
            gridRow: firstRow + rows,
            gridColumn: `${firstCol} / span ${cols}`,
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
