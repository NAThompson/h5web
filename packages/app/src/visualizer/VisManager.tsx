import { assertDefined } from '@h5web/shared/guards';
import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { useState } from 'react';

import { useDataContext } from '../providers/DataProvider';
import { FetchConfirmationProvider } from '../vis-packs/fetch-confirmation';
import { type VisDef } from '../vis-packs/models';
import { EntityNotesContext } from '../vis-packs/view-hints/OverlayNotes';
import { useActiveVis } from './hooks';
import { VisAreaContext } from './vis-area';
import VisSelector from './VisSelector';
import styles from './Visualizer.module.css';

const NO_NOTES: string[] = [];

interface Props {
  entity: ProvidedEntity;
  supportedVis: VisDef[];
  primaryVis: VisDef | undefined;
  notes?: string[]; // about the entity, shown by visualizations that show notes
}

function VisManager(props: Props) {
  const { entity, supportedVis, primaryVis, notes = NO_NOTES } = props;
  assertDefined(supportedVis[0], 'Expected supported visualization');

  if (!('ResizeObserver' in globalThis)) {
    throw new Error(
      "Your browser's version is not supported. Please upgrade to the latest version.",
    );
  }

  const [activeVis, setActiveVis] = useActiveVis(
    entity,
    supportedVis,
    primaryVis,
  );
  const { Container } = activeVis;

  const [visBarElem, setVisBarElem] = useState<HTMLDivElement>();
  const [visAreaElem, setVisAreaElem] = useState<HTMLDivElement | null>(null);

  const { filepath, queryClient } = useDataContext();
  function onVisChange(index: number) {
    setActiveVis(index);
    void queryClient.cancelQueries(
      { queryKey: [filepath, 'value'] },
      { silent: true },
    );
  }

  return (
    <div className={styles.visManager}>
      <div
        ref={(elem) => setVisBarElem(elem ?? undefined)}
        className={styles.visBar}
      >
        <VisSelector
          activeVis={activeVis}
          choices={supportedVis}
          onChange={onVisChange}
        />
      </div>

      <div ref={setVisAreaElem} className={styles.visArea}>
        <VisAreaContext value={visAreaElem}>
          <FetchConfirmationProvider scope={activeVis.name}>
            <EntityNotesContext value={notes}>
              <Container entity={entity} toolbarContainer={visBarElem} />
            </EntityNotesContext>
          </FetchConfirmationProvider>
        </VisAreaContext>
      </div>
    </div>
  );
}

export default VisManager;
