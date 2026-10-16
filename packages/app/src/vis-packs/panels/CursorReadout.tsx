import { formatTooltipVal } from '@h5web/shared/vis-utils';

import { renderMarkup } from '../view-hints/markup';
import { type CursorStore, useCursor } from './cursor';
import styles from './Panels.module.css';

interface Props {
  store: CursorStore;
  axisLabels: { x?: string; y?: string };
}

/* Coordinates and value of the panel under the pointer, in one place (instead of a label in each
 * panel and a tooltip, which small panels can't hold) */
function CursorReadout(props: Props) {
  const { store, axisLabels } = props;
  const cursor = useCursor(store);
  if (!cursor) {
    return <p className={styles.readout} />; // space kept: the grid doesn't move
  }

  const { title, x, y, value } = cursor;
  return (
    <p
      className={styles.readout}
      role="status"
      aria-label="Cursor"
      data-snapshot-ignore // cf. `SNAPSHOT_IGNORE_ATTR`
    >
      <span>{renderMarkup(title)}</span>
      <span>
        {`${axisLabels.x ?? 'x'} = ${formatTooltipVal(x)}, ${axisLabels.y ?? 'y'} = ${formatTooltipVal(y)}`}
      </span>
      <strong>
        {value === undefined || !Number.isFinite(value)
          ? '—'
          : formatTooltipVal(value)}
      </strong>
    </p>
  );
}

export default CursorReadout;
