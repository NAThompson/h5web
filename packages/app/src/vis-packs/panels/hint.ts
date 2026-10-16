import {
  hasArrayShape,
  hasComplexType,
  hasNumericLikeType,
  isDataset,
} from '@h5web/shared/guards';
import {
  type AttributeValues,
  type Entity,
  type Group,
} from '@h5web/shared/hdf5-models';
import { queryOptions } from '@tanstack/react-query';

import { type DataContextValue } from '../../providers/DataProvider';
import { isTransportError } from '../../providers/utils';
import { findAttribute } from '../../utils';
import {
  createGeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import { createAttrReader, splitNames } from '../view-hints/attrs';
import { HintVis, type ViewHint } from '../view-hints/models';
import { getHintSafely } from '../view-hints/utils';
import { type PanelDataset, type PanelKind, type PanelsHint } from './models';
import { type DimsInfo } from './utils';

export const PANELS_ATTR = 'H5WEB_panels';

export function hasPanelsAttr(entity: Entity): boolean {
  return !!findAttribute(entity, PANELS_ATTR);
}

/* `H5WEB_*` attributes of a group of panels (cf. `parseViewHint`) */
export function parsePanelsHint(
  entity: Entity,
  values: AttributeValues,
): PanelsHint {
  const notes: string[] = [];
  const read = createAttrReader(entity, values, notes);

  const domain = read.nums('H5WEB_shared_domain', (arr) => arr.length === 2);
  const fixedDomain = domain?.map((v) => (Number.isFinite(v) ? v : null)) as
    [number | null, number | null] | undefined;
  const isSymmetric = read.bool('H5WEB_symmetric');
  const layout = read.nums(
    'H5WEB_layout',
    (arr) => arr.length === 2 && arr.every((v) => Number.isInteger(v) && v > 0),
  );

  return {
    paths: splitNames(read.str(PANELS_ATTR) ?? ''),
    layout: layout && [layout[0], layout[1]],
    linkAxes: read.bool('H5WEB_link_axes'),
    linkCursor: read.bool('H5WEB_link_cursor'),
    domain: fixedDomain?.some((v) => v !== null)
      ? fixedDomain
      : isSymmetric
        ? 'symmetric'
        : undefined,
    center: read.num('H5WEB_center'),
    notes,
  };
}

export interface ResolvedPanel extends DimsInfo {
  dataset: PanelDataset;
  hint: ViewHint;
  kind: PanelKind;
}

export interface ResolvedPanels {
  hint: PanelsHint;
  panels: ResolvedPanel[];
  notes: string[]; // panels that can't be shown, and why
}

/* How a panel shows its dataset: as a line or heatmap (the only views of panels) */
export function getPanelKind(
  hint: ViewHint,
  dims: number[],
): { kind: PanelKind; note?: string } {
  if (dims.length === 1 || hint.vis === HintVis.Line) {
    return { kind: 'line' };
  }
  const isHeatmap =
    !hint.vis ||
    hint.vis === HintVis.Heatmap ||
    hint.vis === HintVis.ComplexHeatmap;
  return {
    kind: 'heatmap',
    note: isHeatmap ? undefined : `"H5WEB_vis" "${hint.vis}": shown as heatmap`,
  };
}

/* Dimension scales attached to each dimension of a dataset (none if they can't be read) */
export async function getScalePaths(
  dataset: PanelDataset,
  dataContext: DataContextValue,
): Promise<string[][]> {
  const scales =
    await createGeometryContext(dataContext).getDimensionScales(dataset);
  return dataset.shape.dims.map((_, i) => scales?.[i] ?? []);
}

async function resolvePanel(
  group: Group,
  path: string,
  dataContext: DataContextValue,
): Promise<ResolvedPanel | string> {
  const anchor = `${group.path.replace(/\/$/u, '')}/.`;
  const entity = await resolveCoordinate(
    anchor,
    path,
    createGeometryContext(dataContext),
  );
  if (!entity) {
    return `panel "${path}" was not found`;
  }
  if (
    !isDataset(entity) ||
    !hasArrayShape(entity) ||
    !hasNumericLikeType(entity) ||
    hasComplexType(entity)
  ) {
    return `panel "${path}" is not a real numeric array`;
  }
  const { dims } = entity.shape;
  if (dims.includes(0)) {
    return `panel "${path}" is empty`;
  }

  const [hint, scales] = await Promise.all([
    getHintSafely(entity, dataContext),
    getScalePaths(entity, dataContext),
  ]);
  const { kind, note } = getPanelKind(hint, dims);
  return {
    dataset: entity,
    hint: note ? { ...hint, notes: [...hint.notes, note] } : hint,
    kind,
    dims,
    scales,
  };
}

/* Panels listed by a group's `H5WEB_panels`; those that can't be shown are left out (with a note) */
export async function resolvePanels(
  group: Group,
  dataContext: DataContextValue,
): Promise<ResolvedPanels> {
  const { queryClient, queries } = dataContext;

  let values: AttributeValues;
  try {
    values = await queryClient.query(queries.attrValues(group));
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }
    return {
      hint: { paths: [], notes: [] },
      panels: [],
      notes: ['H5WEB_* attributes could not be read'],
    };
  }

  const hint = parsePanelsHint(group, values);
  const results = await Promise.all(
    hint.paths.map(async (path) => resolvePanel(group, path, dataContext)),
  );

  return {
    hint,
    panels: results.filter((res) => typeof res !== 'string'),
    notes: [
      ...hint.notes,
      ...results.filter((res) => typeof res === 'string'),
      ...(hint.paths.length === 0 ? ['no panels in "H5WEB_panels"'] : []),
    ],
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function panelsQuery(group: Group, dataContext: DataContextValue) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'panels', group.path] as const,
    queryFn: async () => resolvePanels(group, dataContext),
  });
}
