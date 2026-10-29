import { type ReactNode, useMemo } from 'react';

import { type Size } from '../models';
import Overlay from '../shared/Overlay';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { getTextContent } from '../utils';
import styles from './LineVis.module.css';
import { type AuxiliaryParams, type LegendEntry } from './models';
import { type LegendBox } from './utils';

/* Entries of the visible curves, then the given entries (e.g. of children) */
export function getLegendEntries(
  curve:
    | {
        label?: string;
        ordinateLabel?: ReactNode;
        color: string;
        dash?: boolean;
      }
    | false,
  auxiliaries: AuxiliaryParams[],
  auxColors: string[],
  extraEntries: LegendEntry[],
): LegendEntry[] {
  return [
    ...(curve
      ? [
          {
            label:
              curve.label || getTextContent(curve.ordinateLabel) || 'Signal',
            color: curve.color,
            dash: curve.dash,
          },
        ]
      : []),
    ...auxiliaries.flatMap(({ label, color, dash, visible }, index) =>
      visible
        ? [
            {
              label: label || `Auxiliary ${index + 1}`,
              color: color ?? auxColors[index % auxColors.length],
              dash,
            },
          ]
        : [],
    ),
    ...extraEntries,
  ];
}

// Approximate size of the legend (cf. CSS), in px
const FONT_SIZE = 14;
const CHAR_WIDTH = 0.6 * FONT_SIZE; // average, a bit generous
const ROW_HEIGHT = 1.2 * FONT_SIZE;
const ROW_GAP = 4;
const PADDING = [10, 6]; // x, y (with borders)
const MARK_WIDTH = 1.25 * FONT_SIZE + 6;
const MARGIN = 12; // from the edges of the canvas

/* Box of the legend relative to the canvas, from the number and length of its entries */
export function getLegendBox(
  entries: LegendEntry[],
  canvasSize: Size,
): LegendBox {
  const chars = Math.max(
    0,
    ...entries.map(
      ({ label }) => (getTextContent(label).match(/./gsu) ?? []).length,
    ),
  );
  const width = 2 * PADDING[0] + MARK_WIDTH + chars * CHAR_WIDTH;
  const height =
    2 * PADDING[1] + entries.length * (ROW_HEIGHT + ROW_GAP) - ROW_GAP;
  return {
    width: Math.min(width / canvasSize.width, 1),
    height: Math.min(height / canvasSize.height, 1),
    marginX: MARGIN / canvasSize.width,
    marginY: MARGIN / canvasSize.height,
  };
}

interface Props {
  entries: LegendEntry[];
  getCorner: (box: LegendBox) => string; // e.g. `top-right`
  isVisible: boolean; // else only in snapshots (cf. `[data-snapshot]` in CSS)
}

function LineLegend(props: Props) {
  const { entries, getCorner, isVisible } = props;
  const { canvasSize } = useVisCanvasContext();

  const box = getLegendBox(entries, canvasSize);
  const corner = useMemo(
    () => getCorner(box),
    [getCorner, box.width, box.height, box.marginX, box.marginY], // eslint-disable-line react-hooks/exhaustive-deps -- `box` is recreated on every render
  );

  return (
    <Overlay>
      <ul
        className={styles.legend}
        data-visible={isVisible || undefined}
        data-corner={corner}
      >
        {entries.map(({ label, color, dash, isBand }, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <li className={styles.legendItem} key={index}>
            <span
              className={styles.legendMark}
              data-keep-colors
              data-dash={dash || undefined}
              data-band={isBand || undefined}
              style={{ color }}
            />
            {label}
          </li>
        ))}
      </ul>
    </Overlay>
  );
}

export default LineLegend;
