import { DimensionMapper, type DimensionMapping } from '@h5web/lib';
import { type ReactNode } from 'react';

import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { type SlicingProps } from '../slicing';
import { type Link } from './overlays';
import styles from './ViewHints.module.css';

interface Props {
  link: Link;
  index: number;
  onChange: (index: number) => void;
  slicingProps: SlicingProps;
  children: ReactNode; // dimension mapper of the base dataset
}

/* Dimension mapper of the base dataset, followed by a slider (with playback) for a dimension
 * the base dataset doesn't have, but that slices its overlays (e.g. `generation`) */
function LinkedDimMapper(props: Props) {
  const { link, index, onChange, slicingProps, children } = props;
  const mapping: DimensionMapping = [index];

  return (
    <div className={`${visualizerStyles.dimMapper} ${styles.stack}`}>
      {children}
      <div
        className={styles.linked}
        title={`Slices the overlays that share the "${link.label}" dimension scale`}
      >
        <span className={styles.linkedLabel}>{link.label}</span>
        <DimensionMapper
          className={styles.linkedMapper}
          role="group"
          aria-label={`Linked dimension ${link.label}`}
          dims={[link.length]}
          dimMapping={mapping}
          {...slicingProps}
          onChange={([val]) => onChange(val as number)}
        />
      </div>
    </div>
  );
}

export default LinkedDimMapper;
