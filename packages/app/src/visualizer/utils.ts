import { isDataset, isDefined, isGroup } from '@h5web/shared/guards';
import {
  type ChildEntity,
  type Dataset,
  type Group,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { buildEntityPath } from '@h5web/shared/hdf5-utils';
import { queryOptions } from '@tanstack/react-query';

import { type DataContextValue } from '../providers/DataProvider';
import { findScalarStrAttr, getAttributeValue } from '../utils';
import {
  CORE_VIS,
  type CoreVisDef,
  Vis,
} from '../vis-packs/core/visualizations';
import { type VisDef } from '../vis-packs/models';
import {
  findAxesDatasets,
  findSignalDataset,
  getNxClass,
  isMalformedError,
  isNxDataGroup,
  isNxNoteGroup,
} from '../vis-packs/nexus/utils';
import {
  NX_DATA_VIS,
  NX_NOTE_VIS,
  NxDataVis,
  type NxDataVisDef,
} from '../vis-packs/nexus/visualizations';
import { isNurbsGroup, isNurbsMultiPatchGroup } from '../vis-packs/nurbs/utils';
import { NURBS_BASIS_VIS, NURBS_VIS } from '../vis-packs/nurbs/visualizations';
import { hasPanelsAttr } from '../vis-packs/panels/hint';
import { PANELS_VIS } from '../vis-packs/panels/visualizations';
import {
  findHintVis,
  getHintSafely,
  getHintVisNotes,
} from '../vis-packs/view-hints/utils';

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function resolvePathQuery(path: string, dataContext: DataContextValue) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'resolution', path] as const,
    queryFn: async () => resolvePath(path, dataContext),
  });
}

async function resolvePath(
  path: string,
  dataContext: DataContextValue,
): Promise<{
  entity: ProvidedEntity;
  supportedVis: VisDef[];
  primaryVis?: VisDef;
  notes?: string[]; // e.g. hinted vis not available
} | null> {
  const { queryClient, queries } = dataContext;
  const entity = await queryClient.query(queries.entity(path));

  if (isDataset(entity)) {
    const supportedVis = await getSupportedCoreVis(entity, dataContext);
    if (supportedVis.length === 0) {
      return null;
    }

    // `H5WEB_*` view hint takes precedence over heuristics
    const hint = await getHintSafely(entity, dataContext);
    const primaryVis = findHintVis(hint, supportedVis);
    return {
      entity,
      supportedVis,
      primaryVis,
      notes: getHintVisNotes(hint, primaryVis),
    };
  }

  if (!isGroup(entity)) {
    return null;
  }

  if (await isNurbsGroup(entity, dataContext)) {
    return {
      entity,
      supportedVis: isNurbsMultiPatchGroup(entity)
        ? [NURBS_VIS]
        : [NURBS_VIS, NURBS_BASIS_VIS],
      primaryVis: NURBS_VIS,
    };
  }

  // `H5WEB_panels`: datasets side by side, by default (over NeXus)
  const isPanels = hasPanelsAttr(entity);

  if (await isNxNoteGroup(entity, dataContext)) {
    return { entity, supportedVis: [NX_NOTE_VIS] };
  }

  if (await isNxDataGroup(entity, dataContext)) {
    const signal = await findSignalDataset(entity, dataContext);

    const interpretationAttr = findScalarStrAttr(signal, 'interpretation');
    const interpretation = await getAttributeValue(
      signal,
      interpretationAttr,
      dataContext,
    );

    const results = await Promise.all(
      Object.values(NX_DATA_VIS).map(async (vis) => {
        const supported = await vis.supports(
          entity,
          signal,
          interpretation,
          dataContext,
        );
        return supported ? vis : undefined;
      }),
    );

    const supportedVis = results.filter(isDefined);
    if (supportedVis.length > 0) {
      // Axes only matter to decide whether a volume is the primary vis
      const axisDatasets = supportedVis.includes(
        NX_DATA_VIS[NxDataVis.NxVolume],
      )
        ? await findAxesForPrimaryVis(entity, signal, dataContext)
        : [];
      // `H5WEB_*` view hint takes precedence over NeXus `interpretation`
      const hint = await getHintSafely(entity, dataContext, signal);
      const hintVis = findHintVis(hint, supportedVis);
      return {
        entity,
        supportedVis: isPanels ? [PANELS_VIS, ...supportedVis] : supportedVis,
        primaryVis: isPanels
          ? PANELS_VIS
          : (hintVis ??
            findPrimaryVis(supportedVis, interpretation, signal, axisDatasets)),
        notes: getHintVisNotes(hint, hintVis),
      };
    }
  }

  if (isPanels) {
    return { entity, supportedVis: [PANELS_VIS], primaryVis: PANELS_VIS };
  }

  const nxDefaultPath =
    (await getNxDefaultPath(entity, dataContext)) ||
    (await getImplicitNxDefaultPath(entity.children, dataContext));

  if (!nxDefaultPath) {
    return null;
  }

  return dataContext.queryClient.query(
    resolvePathQuery(nxDefaultPath, dataContext),
  );
}

/*
 * Malformed axes are reported by the visualizations themselves; transient errors (e.g. network)
 * are rethrown, so that the resolution is not cached without a primary vis.
 */
export async function findAxesForPrimaryVis(
  ...args: Parameters<typeof findAxesDatasets>
): Promise<Awaited<ReturnType<typeof findAxesDatasets>>> {
  try {
    return await findAxesDatasets(...args);
  } catch (error) {
    if (isMalformedError(error)) {
      return [];
    }
    throw error;
  }
}

/* Volumes are primary only as a last resort: e.g. RGB images and geometries take precedence */
export function findPrimaryVis(
  supportedVis: NxDataVisDef[],
  ...args: Parameters<NxDataVisDef['isPrimary']>
): NxDataVisDef | undefined {
  const volume = NX_DATA_VIS[NxDataVis.NxVolume];
  return (
    supportedVis.find((vis) => vis !== volume && vis.isPrimary(...args)) ??
    (supportedVis.includes(volume) && volume.isPrimary(...args)
      ? volume
      : undefined)
  );
}

async function getSupportedCoreVis(
  dataset: Dataset,
  dataContext: DataContextValue,
): Promise<CoreVisDef[]> {
  const results = await Promise.all(
    Object.values(CORE_VIS).map(async (vis) => {
      return (await vis.supportsDataset(dataset, dataContext))
        ? vis
        : undefined;
    }),
  );

  const supportedVis = results.filter(isDefined);

  // Remove `Scalar` vis unless it's the only supported vis
  return supportedVis.length > 1
    ? supportedVis.filter((vis) => vis.name !== Vis.Scalar)
    : supportedVis;
}

export async function getNxDefaultPath(
  group: Group,
  dataContext: DataContextValue,
): Promise<string | undefined> {
  const defaultAttr = findScalarStrAttr(group, 'default');
  if (!defaultAttr) {
    return undefined;
  }

  const defaultPath = await getAttributeValue(group, defaultAttr, dataContext);
  return defaultPath.startsWith('/')
    ? defaultPath
    : buildEntityPath(group.path, defaultPath);
}

async function getImplicitNxDefaultPath(
  children: ChildEntity[],
  dataContext: DataContextValue,
): Promise<string | undefined> {
  let firstNxEntry: ChildEntity | undefined;
  let firstNxProcess: ChildEntity | undefined;

  for (const child of children) {
    if (!isGroup(child)) {
      continue;
    }

    // Use first `NXdata` child group
    const nxClass = await getNxClass(child, dataContext); // eslint-disable-line no-await-in-loop -- stop at first `NXdata` group found
    if (nxClass === 'NXdata') {
      return child.path;
    }

    if (nxClass === 'NXentry' && !firstNxEntry) {
      firstNxEntry = child;
    }

    if (nxClass === 'NXprocess' && !firstNxProcess) {
      firstNxProcess = child;
    }
  }

  // No `NXdata`; use first `NXentry` or `NXprocess` if any
  return (firstNxEntry || firstNxProcess)?.path;
}
