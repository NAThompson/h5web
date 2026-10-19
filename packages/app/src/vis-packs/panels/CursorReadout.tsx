import { formatTooltipVal } from '@h5web/shared/vis-utils';

import { renderMarkup } from '../view-hints/markup';
import { type CursorStore, useCursor, useCursorValues } from './cursor';
import { type PanelSpec } from './models';
import styles from './Panels.module.css';
import { MAX_LISTED_VALUES } from './utils';

interface Props {
  store: CursorStore;
  axisLabels: { x?: string; y?: string };
  panels: PanelSpec[]; // values of those linked to the hovered one listed, if few
}

function formatValue(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value)
    ? '—'
    : formatTooltipVal(value);
}

/* Coordinates and value of the panel under the pointer, in one place (instead of a label in each
 * panel and a tooltip, which small panels can't hold); with few panels, the value of each panel
 * linked to it (the hovered one in bold) */
function CursorReadout(props: Props) {
  const { store, axisLabels, panels } = props;
  const cursor = useCursor(store);
  const values = useCursorValues(store);
  if (!cursor) {
    return <p className={styles.readout} />; // space kept: the grid doesn't move
  }

  const { title, x, y, value, linkKey, source } = cursor;
  const linked =
    panels.length <= MAX_LISTED_VALUES
      ? panels.filter((spec) => spec.linkKey === linkKey)
      : [];
  return (
    <p
      className={styles.readout}
      role="status"
      aria-label="Cursor"
      data-snapshot-ignore // cf. `SNAPSHOT_IGNORE_ATTR`
    >
      {linked.length === 0 && <span>{renderMarkup(title)}</span>}
      <span>
        {`${axisLabels.x ?? '𝑥'} = ${formatTooltipVal(x)}, ${axisLabels.y ?? '𝑦'} = ${formatTooltipVal(y)}`}
      </span>
      {linked.length === 0 && <strong>{formatValue(value)}</strong>}
      {linked.map(({ key, title: panelTitle }) => {
        const text = (
          <>
            {renderMarkup(panelTitle)}
            {` = ${formatValue(key === source ? value : values.get(key))}`}
          </>
        ); // markup as HTML: Unicode has no superscript of many letters
        return key === source ? (
          <strong key={key}>{text}</strong>
        ) : (
          <span key={key}>{text}</span>
        );
      })}
    </p>
  );
}

export default CursorReadout;
