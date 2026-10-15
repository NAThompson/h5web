import { hasArrayShape, hasStringType, isDataset } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type Entity,
  type ProvidedEntity,
  type StringType,
} from '@h5web/shared/hdf5-models';

import { type DataContextValue } from '../../providers/DataProvider';
import {
  createGeometryContext,
  type GeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';

export const SLICE_LABELS_ATTR = 'H5WEB_slice_labels';
const MAX_LABELS = 10_000; // longer labels are not fetched: they would hold up every vis

type StrDataset = Dataset<ArrayShape, StringType>;

/* 1D string dataset (fixed- or variable-length strings), e.g. string-valued dimension scale */
export function isLabelsDataset(
  entity: ProvidedEntity | undefined,
  length?: number,
): entity is StrDataset {
  return (
    !!entity &&
    isDataset(entity) &&
    hasArrayShape(entity) &&
    hasStringType(entity) &&
    entity.shape.dims.length === 1 &&
    (length === undefined || entity.shape.dims[0] === length)
  );
}

/* Strings of a labels dataset, without the padding of fixed-length strings */
export async function getLabels(
  dataset: StrDataset,
  dataContext: DataContextValue,
): Promise<string[]> {
  const { queryClient, queries } = dataContext;
  const value: unknown = await queryClient.query(queries.value(dataset));
  return Array.isArray(value)
    ? value.map((str) => String(str).split('\0')[0].trimEnd())
    : [];
}

/* Labels dataset named by the `H5WEB_slice_labels` attribute of an entity (path resolved like CF
 * `coordinates`, relative to the entity); why not if it can't be used */
async function resolveLabelsAttr(
  entity: Entity,
  ctx: GeometryContext,
  length?: number,
): Promise<StrDataset | string | undefined> {
  if (!entity.attributes.some(({ name }) => name === SLICE_LABELS_ATTR)) {
    return undefined;
  }
  const value = await ctx.getStrAttr(entity, SLICE_LABELS_ATTR);
  if (value === undefined) {
    return `ignored invalid "${SLICE_LABELS_ATTR}"`;
  }
  const path = value.trim();
  if (!path) {
    return undefined; // empty: as good as absent
  }
  const labels = await resolveCoordinate(entity.path, path, ctx);
  const strings = length === undefined ? 'strings' : `${length} strings`;
  if (!isLabelsDataset(labels, length)) {
    return `ignored "${SLICE_LABELS_ATTR}": "${path}" is not a 1D dataset of ${strings}`;
  }
  return labels.shape.dims[0] > MAX_LABELS
    ? `ignored "${SLICE_LABELS_ATTR}": "${path}" has more than ${MAX_LABELS} strings`
    : labels;
}

export interface SliceLabels {
  labels?: string[];
  name?: string; // name of a string-valued scale
  note?: string;
}

/**
 * Labels of the indices of a dimension: from the `H5WEB_slice_labels` dataset of its (numeric)
 * scale, else from a string-valued scale attached to it
 */
export async function getScaleLabels(
  scalePaths: string[],
  scale: Dataset | undefined,
  dimSize: number,
  dataContext: DataContextValue,
): Promise<SliceLabels> {
  const ctx = createGeometryContext(dataContext);
  if (scale) {
    const labels = await resolveLabelsAttr(scale, ctx, dimSize);
    if (typeof labels === 'string') {
      return { note: `${scale.name}: ${labels}` };
    }
    if (labels) {
      return { labels: await getLabels(labels, dataContext) };
    }
  }

  /* eslint-disable no-await-in-loop -- first string-valued scale */
  for (const path of scalePaths) {
    const entity = await ctx.getEntity(path);
    if (isLabelsDataset(entity, dimSize)) {
      const name = (await ctx.getStrAttr(entity, 'NAME')) || entity.name;
      return dimSize > MAX_LABELS
        ? { name, note: `${name}: more than ${MAX_LABELS} labels, not shown` }
        : { labels: await getLabels(entity, dataContext), name };
    }
  }
  /* eslint-enable no-await-in-loop */
  return {};
}

/**
 * Labels named by the `H5WEB_slice_labels` attribute of a dataset, and the dimension they label:
 * the one that shares a dimension scale with the labels dataset (e.g. a netCDF dimension), else
 * the only one of their length
 */
export async function getDatasetLabels(
  dataset: Dataset<ArrayShape>,
  scales: string[][] | null | undefined,
  dataContext: DataContextValue,
): Promise<{ dim?: number; labels?: string[]; note?: string }> {
  const ctx = createGeometryContext(dataContext);
  const labels = await resolveLabelsAttr(dataset, ctx);
  if (!labels || typeof labels === 'string') {
    return { note: labels };
  }

  const { dims } = dataset.shape;
  const [length] = labels.shape.dims;
  const [labelScales = []] = (await ctx.getDimensionScales(labels)) ?? [];
  const shared = dims.findIndex(
    (size, i) =>
      size === length &&
      labelScales.some((path) => scales?.[i]?.includes(path)),
  );
  const sameLength = dims.flatMap((size, i) => (size === length ? [i] : []));
  const dim =
    shared !== -1
      ? shared
      : sameLength.length === 1
        ? sameLength[0]
        : undefined;

  return dim === undefined
    ? {
        note: `ignored "${SLICE_LABELS_ATTR}": no dimension of ${length} indices to label`,
      }
    : { dim, labels: await getLabels(labels, dataContext) };
}
