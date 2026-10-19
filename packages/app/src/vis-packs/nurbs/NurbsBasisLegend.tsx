import { Overlay } from '@h5web/lib';

import styles from './NurbsBasis.module.css';

export interface BasisLegendEntry {
  label: string;
  color: string;
  dash?: boolean;
}

interface Props {
  entries: BasisLegendEntry[];
}

/* One row (wrapped if need be) along the top of the plot, over the headroom above 1 */
function NurbsBasisLegend(props: Props) {
  const { entries } = props;

  return (
    <Overlay>
      <ul className={styles.legend} aria-label="Basis functions">
        {entries.map(({ label, color, dash }) => (
          <li key={label} className={styles.legendItem}>
            <span
              className={styles.swatch}
              data-keep-colors
              data-dash={dash || undefined}
              style={{ color }}
            />
            {label}
          </li>
        ))}
      </ul>
    </Overlay>
  );
}

export default NurbsBasisLegend;
