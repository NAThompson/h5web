import { type Domain } from '@h5web/shared/vis-models';
import { formatTick, needsPowerTicks } from '@h5web/shared/vis-utils';

import styles from './ScatterVis.module.css';
import { getSizeLegendValues, getSizePx } from './utils';

interface Props {
  label?: string;
  domain: Domain; // of the size values
  range: [number, number]; // diameters in CSS pixels
  sizeScale: number;
}

/** Diameters of points of the smallest, middle and largest size values (rounded alike). */
function SizeLegend(props: Props) {
  const { label, domain, range, sizeScale } = props;
  const values = getSizeLegendValues(domain);
  const powers = needsPowerTicks(values.map((value) => ({ value })));

  return (
    <div className={styles.sizeLegend} role="group" aria-label="Size legend">
      {label && <span className={styles.sizeLabel}>{label}</span>}
      <div className={styles.sizeItems}>
        {values.map((val) => {
          const diameter = getSizePx(val, domain, range) * sizeScale;
          return (
            <span key={val} className={styles.sizeItem}>
              <svg width={diameter + 2} height={diameter + 2} aria-hidden>
                <circle
                  cx={diameter / 2 + 1}
                  cy={diameter / 2 + 1}
                  r={diameter / 2}
                  fill="gray"
                  fillOpacity={0.6}
                />
              </svg>
              {formatTick(val, undefined, powers)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default SizeLegend;
