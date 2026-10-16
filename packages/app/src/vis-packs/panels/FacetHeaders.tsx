import { getAxisOffsets } from '@h5web/lib';

import { toUnicodeScripts } from '../view-hints/attrs';
import { renderMarkup } from '../view-hints/markup';
import styles from './Panels.module.css';

const OFFSETS = getAxisOffsets(); // of the plots in the panels

interface Props {
  headers: { rows: string[]; cols: string[] };
  rows: number;
  cols: number;
  start: [number, number]; // grid row and column of the first panel
  axesSize: [number, number]; // y axis in the first column, x axis in `axisRows`
  axisRows: Set<number>;
}

/* Facet grid: the label of each column above it, of each row to its left, along the plots */
function FacetHeaders(props: Props) {
  const { headers, rows, cols, start, axesSize, axisRows } = props;
  const [firstRow, firstCol] = start;
  const [axesWidth, axesHeight] = axesSize;
  return (
    <>
      {headers.cols.slice(0, cols).map((label, col) => (
        <p
          key={label}
          className={styles.colHeader}
          style={{
            gridRow: firstRow - 1,
            gridColumn: firstCol + col,
            paddingLeft: col === 0 ? axesWidth : 0,
            paddingRight: OFFSETS.right,
          }}
          title={toUnicodeScripts(label)}
        >
          {renderMarkup(label)}
        </p>
      ))}
      {headers.rows.slice(0, rows).map((label, row) => (
        <p
          key={label}
          className={styles.rowHeader}
          style={{
            gridRow: firstRow + row,
            gridColumn: firstCol - 1,
            // Rotated: its top padding is at the bottom (x axis)
            paddingTop: axisRows.has(row) ? axesHeight : 0,
            paddingBottom: OFFSETS.top,
          }}
          title={toUnicodeScripts(label)}
        >
          {renderMarkup(label)}
        </p>
      ))}
    </>
  );
}

export default FacetHeaders;
