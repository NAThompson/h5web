import { assertGroup } from '@h5web/shared/guards';
import { useSuspenseQuery } from '@tanstack/react-query';

import { useDataContext } from '../../providers/DataProvider';
import visualizerStyles from '../../visualizer/Visualizer.module.css';
import { type VisContainerProps } from '../models';
import OverlayNotes from '../view-hints/OverlayNotes';
import GroupPanels from './GroupPanels';
import { panelsQuery } from './hint';
import styles from './Panels.module.css';

/* Datasets listed by a group's `H5WEB_panels`, side by side */
function PanelsVisContainer(props: VisContainerProps) {
  const { entity } = props;
  assertGroup(entity);

  const dataContext = useDataContext();
  const { data: resolved } = useSuspenseQuery(panelsQuery(entity, dataContext));

  if (resolved.panels.length === 0) {
    return (
      <>
        <p className={`${visualizerStyles.vis} ${styles.fallback}`}>
          No panels to display
        </p>
        <OverlayNotes notes={resolved.notes} />
      </>
    );
  }

  return <GroupPanels {...props} resolved={resolved} />;
}

export default PanelsVisContainer;
