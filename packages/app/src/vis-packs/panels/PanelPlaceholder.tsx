import { type ReactNode } from 'react';

import styles from './Panels.module.css';

interface Props {
  children?: ReactNode;
  isEmpty?: boolean; // values are all NaN
  isPending?: boolean; // values are loading
}

function PanelPlaceholder(props: Props) {
  const { children, isEmpty, isPending } = props;
  return (
    <div
      className={styles.placeholder}
      data-empty={isEmpty || undefined}
      data-pending={isPending || undefined}
      title={isEmpty ? 'No values (all NaN)' : undefined}
    >
      {children}
    </div>
  );
}

export default PanelPlaceholder;
