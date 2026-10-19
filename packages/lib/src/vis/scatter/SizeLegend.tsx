import { type Domain } from '@h5web/shared/vis-models';
import { formatNumber } from '@h5web/shared/vis-utils';

import styles from './ScatterVis.module.css';
import { getSizePx } from './utils';

interface Props {
  label?: string;
  domain: Domain; // of the size values
  range: [number, number]; // diameters in CSS pixels
  sizeScale: number;
}

/** Diameters of points of the smallest, middle and largest size values. */
function SizeLegend(props: Props) {
  const { label, domain, range, sizeScale } = props;
  const [min, max] = domain;
  const values = min === max ? [min] : [min, (min + max) / 2, max];

  return (
    <div className={styles.sizeLegend} role="group" aria-label="Size legend">
      {label && <span>{label}</span>}
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
            {formatNumber(val, 3)}
          </span>
        );
      })}
    </div>
  );
}

export default SizeLegend;
