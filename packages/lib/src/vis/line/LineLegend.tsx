import { type ReactNode } from 'react';

import Overlay from '../shared/Overlay';
import { getTextContent } from '../utils';
import styles from './LineVis.module.css';
import { type AuxiliaryParams, type LegendEntry } from './models';

/* Entries of the visible curves, then the given entries (e.g. of children) */
export function getLegendEntries(
  curve: { label?: string; ordinateLabel?: ReactNode; color: string } | false,
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
          },
        ]
      : []),
    ...auxiliaries.flatMap(({ label, color, visible }, index) =>
      visible
        ? [
            {
              label: label || `Auxiliary ${index + 1}`,
              color: color ?? auxColors[index % auxColors.length],
            },
          ]
        : [],
    ),
    ...extraEntries,
  ];
}

interface Props {
  entries: LegendEntry[];
  corner: string; // e.g. `top-right`
  isVisible: boolean; // else only in snapshots (cf. `[data-snapshot]` in CSS)
}

function LineLegend(props: Props) {
  const { entries, corner, isVisible } = props;

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
