import { type ReactNode } from 'react';

import { getTextContent } from '../utils';
import styles from './CategoryLegend.module.css';
import { type Category } from './models';
import { formatCategoryValue } from './utils';

interface Props {
  categories: Category[];
  label?: ReactNode; // e.g. quantity of the values
}

/* Discrete legend of categorical colors, instead of a color bar: a swatch per category with its
 * value and label (in columns when there are many) */
function CategoryLegend(props: Props) {
  const { categories, label } = props;

  return (
    <div className={styles.legend} aria-label="Categories">
      {label && (
        <p className={styles.label} title={getTextContent(label)}>
          {label}
        </p>
      )}
      <ul className={styles.items}>
        {categories.map(({ value, color, label: name }) => (
          <li key={value} className={styles.item}>
            <span
              className={styles.swatch}
              data-keep-colors
              style={{ backgroundColor: color }}
            />
            <span className={styles.value}>{formatCategoryValue(value)}</span>
            {name && <span className={styles.name}>{name}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { Props as CategoryLegendProps };
export default CategoryLegend;
