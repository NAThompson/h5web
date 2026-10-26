import { type NumArray } from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';

import styles from './ScatterVis.module.css';

export interface PointChannel {
  label: string;
  values: NumArray;
  format?: (val: number) => string; // e.g. label of a category
}

interface Props {
  index: number;
  channels: PointChannel[]; // coordinates, then colour and size values
}

/** Index and values of a picked point. */
function PointTooltip(props: Props) {
  const { index, channels } = props;

  return (
    <>
      <span>{`#${index}`}</span>
      {channels.map(({ label, values, format = formatTooltipVal }) => (
        <div key={label} className={styles.tooltipRow}>
          {`${label} = `}
          <strong>{format(values[index])}</strong>
        </div>
      ))}
    </>
  );
}

export default PointTooltip;
