import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

import {
  type DataContextValue,
  useDataContext,
} from '../../../providers/DataProvider';
import { hasAttribute } from '../../../utils';
import { createOverlayContext } from '../../view-hints/overlays';
import { getHintSafely } from '../../view-hints/utils';
import { COORDINATES_ATTR } from '../geometry/utils';
import { findScatterSource, type ScatterSource } from './source';

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function scatterSourceQuery(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'scatter', entity.path] as const,
    queryFn: async (): Promise<ScatterSource | null> => {
      const hint = await getHintSafely(entity, dataContext);
      const source = await findScatterSource(
        entity,
        hint.vis,
        createOverlayContext(dataContext),
        hint.xDim,
      );
      return source ?? null;
    },
  });
}

/**
 * Points an entity describes, if any (cheap checks first, so as not to fetch attributes of other
 * entities). Never rejects, so the visualization selector cannot break: a transient error (e.g.
 * network) offers no scatter this time, without caching the failure.
 */
export async function getScatterSource(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
): Promise<ScatterSource | undefined> {
  if (
    !hasAttribute(entity, 'H5WEB_vis') &&
    !hasAttribute(entity, COORDINATES_ATTR)
  ) {
    return undefined;
  }

  const query = scatterSourceQuery(entity, dataContext);
  try {
    return (await dataContext.queryClient.query(query)) ?? undefined;
  } catch {
    dataContext.queryClient.removeQueries({
      queryKey: query.queryKey,
      exact: true,
    });
    return undefined;
  }
}

/** Points an entity describes (resolved when the visualization was offered). */
export function useScatterSource(entity: ProvidedEntity): ScatterSource {
  const dataContext = useDataContext();
  const { data } = useSuspenseQuery(scatterSourceQuery(entity, dataContext));
  if (!data) {
    throw new Error('Expected entity to describe points');
  }
  return data;
}
