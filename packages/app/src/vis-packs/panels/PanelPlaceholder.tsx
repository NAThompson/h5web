import { type ReactNode } from 'react';

import styles from './Panels.module.css';

interface Props {
  children?: ReactNode;
  isEmpty?: boolean; // values are all NaN
}

function PanelPlaceholder(props: Props) {
  const { children, isEmpty } = props;
  return (
    <div
      className={styles.placeholder}
      data-empty={isEmpty || undefined}
      title={isEmpty ? 'No values (all NaN)' : undefined}
    >
      {children}
    </div>
  );
}

export default PanelPlaceholder;
