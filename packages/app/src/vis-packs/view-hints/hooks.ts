import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useDataContext } from '../../providers/DataProvider';
import { type VolumeConfig } from '../core/volume/config';
import { type ViewHint } from './models';
import { viewHintQuery } from './utils';

/* `H5WEB_view` hint of a dataset or NXdata group (already in cache once the entity is resolved) */
export function useViewHint(
  entity: ProvidedEntity,
  signal?: ProvidedEntity,
): ViewHint {
  const dataContext = useDataContext();
  return useSuspenseQuery(viewHintQuery(entity, dataContext, signal)).data;
}

/* Iso levels suggested by a hint replace the current ones when the volume is opened (they
 * depend on the dataset); the user may then change them freely */
export function useSuggestedIsoLevels(
  hint: ViewHint,
  config: Pick<VolumeConfig, 'isoLevels' | 'addIsoLevel' | 'removeIsoLevel'>,
): void {
  const isApplied = useRef(false);
  const initial = useRef({ levels: hint.isoLevels, config });

  useEffect(() => {
    const { levels, config: initialConfig } = initial.current;
    if (!levels || isApplied.current) {
      return;
    }

    isApplied.current = true;
    for (const { id } of initialConfig.isoLevels) {
      initialConfig.removeIsoLevel(id);
    }
    for (const value of levels) {
      initialConfig.addIsoLevel(value);
    }
  }, []);
}
