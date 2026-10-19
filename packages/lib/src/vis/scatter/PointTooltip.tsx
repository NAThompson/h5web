import { type NumArray } from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';

import styles from './ScatterVis.module.css';

export interface PointChannel {
  label: string;
  values: NumArray;
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
      {channels.map(({ label, values }) => (
        <div key={label} className={styles.tooltipRow}>
          {`${label} = `}
          <strong>{formatTooltipVal(values[index])}</strong>
        </div>
      ))}
    </>
  );
}

export default PointTooltip;
