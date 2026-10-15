import { type LegendItem } from './hooks';
import { renderMarkup } from './markup';
import styles from './ViewHints.module.css';

interface Props {
  items: LegendItem[];
}

/* Legend of the labelled overlays of a `H5WEB_*` view hint */
function OverlayLegend(props: Props) {
  const { items } = props;
  if (items.length === 0) {
    return null;
  }

  return (
    <ul className={styles.legend} aria-label="Overlays">
      {items.map(({ label, color, kind, dash }) => (
        <li key={label} className={styles.legendItem}>
          <svg className={styles.legendSwatch} viewBox="0 0 20 12" aria-hidden>
            {kind === 'points' ? (
              <circle cx={10} cy={6} r={4} fill={color} stroke="#202020" />
            ) : (
              <line
                x1={1}
                y1={6}
                x2={19}
                y2={6}
                stroke={color}
                strokeWidth={2}
                strokeDasharray={dash ? '4 3' : undefined}
              />
            )}
          </svg>
          <span>{renderMarkup(label)}</span>
        </li>
      ))}
    </ul>
  );
}

export default OverlayLegend;
