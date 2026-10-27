import { getLegendKey, type LegendItem } from './hooks';
import { renderMarkup } from './markup';
import PointMarker from './PointMarker';
import styles from './ViewHints.module.css';

interface Props {
  items: LegendItem[];
  inline?: boolean; // in the flow (e.g. below a grid of panels), not over the plot
}

/* Legend of the labelled overlays of a `H5WEB_*` view hint */
function OverlayLegend(props: Props) {
  const { items, inline = false } = props;
  if (items.length === 0) {
    return null;
  }

  return (
    <ul
      className={inline ? styles.legendInline : styles.legend}
      aria-label="Overlays"
    >
      {items.map((item) => {
        const { label, color, kind, dash, marker = 'dot' } = item;
        return (
          <li key={getLegendKey(item)} className={styles.legendItem}>
            <svg
              className={styles.legendSwatch}
              viewBox="0 0 20 12"
              aria-hidden
              data-keep-colors
            >
              {kind === 'points' && marker === 'dot' && (
                <circle cx={10} cy={6} r={4} fill={color} stroke="#202020" />
              )}
              {kind === 'points' && marker !== 'dot' && (
                <PointMarker
                  marker={marker}
                  x={10}
                  y={6}
                  size={4}
                  color={color}
                />
              )}
              {kind === 'line' && (
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
        );
      })}
    </ul>
  );
}

export default OverlayLegend;
