import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { useLocalStorageValue } from '@react-hookz/web';
import { useState } from 'react';

import { type VisDef } from '../vis-packs/models';

function canBePreferred(vis: VisDef, entity: ProvidedEntity): boolean {
  return vis.canBePreferredFor?.(entity) ?? true;
}

export function useActiveVis(
  entity: ProvidedEntity,
  supportedVis: VisDef[],
  primaryVis: VisDef | undefined,
): [VisDef, (index: number) => void] {
  const {
    value: preferredVisName,
    set: savePreferredVisName,
    remove: removePreferredVisName,
  } = useLocalStorageValue<string>('h5web:preferredVis');

  const preferredVis = preferredVisName
    ? supportedVis.find(
        (v) => v.name === preferredVisName && canBePreferred(v, entity),
      )
    : undefined;

  const lastSupportedIndex = supportedVis.length - 1;
  const lastVis = supportedVis[lastSupportedIndex];

  const state = useState(primaryVis || preferredVis || lastVis); // reset when selecting a new entity (cf. `key` on `VisManager`)
  const [activeVis, setActiveVis] = state;

  return [
    activeVis,
    (index: number) => {
      const vis = supportedVis[index];

      // Vis that only makes sense as a default for some entities (e.g. 3D curve of a 2D slice): leave preference alone
      if (!canBePreferred(vis, entity)) {
        setActiveVis(vis);
        return;
      }

      if (index < lastSupportedIndex) {
        // When user explicitly selects another vis than the last, save it as the preferred vis in local storage
        savePreferredVisName(vis.name);
      } else if (index === lastSupportedIndex && preferredVisName) {
        // When user selects last vis again, remove preferred vis from local storage
        removePreferredVisName();
      }

      setActiveVis(vis);
    },
  ];
}
