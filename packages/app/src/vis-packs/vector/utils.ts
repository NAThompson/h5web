import {
  type Domain,
  getCurl2D,
  getDivergence,
  getDomain,
  getMagnitude,
  VectorBackground,
  type VectorField2D,
  type VectorField3D,
  VectorStyle,
} from '@h5web/lib';
import {
  hasArrayShape,
  hasNumericType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type AttributeValues,
  type Dataset,
  type Entity,
  type Group,
  type NumericType,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { type ColorScaleType, type NumArray } from '@h5web/shared/vis-models';
import { useSuspenseQuery } from '@tanstack/react-query';

import {
  type DataContextValue,
  useDataContext,
} from '../../providers/DataProvider';
import { hasAttribute } from '../../utils';
import {
  createGeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import { extendDomain } from '../playback-range';
import { createAttrReader } from '../view-hints/attrs';
import { HintVis } from '../view-hints/models';
import { getHintSafely } from '../view-hints/utils';

export type NumDataset = Dataset<ArrayShape, NumericType>;

/* Vector field of a dataset whose last dimension holds the components, or of a group naming
 * one dataset per component; `rank` is the number of components and spatial dimensions */
export type VectorSource =
  | { kind: 'dataset'; dataset: NumDataset; rank: 2 | 3 }
  | { kind: 'group'; components: NumDataset[]; rank: 2 | 3 };

export interface VectorHint {
  style?: VectorStyle;
  background?: VectorBackground;
  backgroundPath?: string; // `H5WEB_vector_background` naming a dataset
  arrowDensity?: number; // arrows per 100 px
  uniformArrows?: boolean; // `H5WEB_arrow_length = "uniform"`
  notes: string[];
}

const COMPONENT_ATTRS = ['H5WEB_u', 'H5WEB_v', 'H5WEB_w'];
const STYLES = new Set<string>(Object.values(VectorStyle));
const BACKGROUNDS = new Set<string>([
  VectorBackground.Magnitude,
  VectorBackground.None,
  VectorBackground.Divergence,
  VectorBackground.Curl,
]);

function isNumDataset(
  entity: ProvidedEntity | undefined,
): entity is NumDataset {
  return (
    !!entity &&
    isDataset(entity) &&
    hasArrayShape(entity) &&
    hasNumericType(entity)
  );
}

/* Whether a dataset can be shown as a vector field: (…, ny, nx, 2) or (…, nz, ny, nx, 3) */
export function getVectorRank(dataset: ProvidedEntity): 2 | 3 | undefined {
  if (!isNumDataset(dataset)) {
    return undefined;
  }
  const { dims } = dataset.shape;
  const comps = dims.at(-1);
  if (
    (comps === 2 || comps === 3) &&
    dims.length > comps &&
    dims.slice(-comps - 1, -1).every((n) => n >= 2)
  ) {
    return comps;
  }
  return undefined;
}

/* Whether a group has `H5WEB_vis = "vector"`, read as in datasets' view hints (which are then
 * in cache, cf. `useViewHint`) */
export async function isVectorGroup(
  group: ProvidedEntity,
  dataContext: DataContextValue,
): Promise<boolean> {
  if (!hasAttribute(group, 'H5WEB_vis')) {
    return false;
  }
  const hint = await getHintSafely(group, dataContext);
  return hint.vis === HintVis.Vector;
}

/* Vector settings of an entity's attributes; invalid values are ignored with a note */
export function parseVectorHint(
  entity: Entity,
  values: AttributeValues,
): VectorHint {
  const notes: string[] = [];
  const hint: VectorHint = { notes };
  const read = createAttrReader(entity, values, notes);

  const style = read.str('H5WEB_vector_style')?.toLowerCase();
  if (style !== undefined) {
    if (STYLES.has(style)) {
      hint.style = style as VectorStyle;
    } else {
      notes.push(`"H5WEB_vector_style" "${style}" is not valid`);
    }
  }

  const background = read.str('H5WEB_vector_background');
  if (background !== undefined) {
    const key = background.toLowerCase();
    if (BACKGROUNDS.has(key)) {
      hint.background = key as VectorBackground;
    } else {
      hint.background = VectorBackground.Dataset; // path, checked once resolved
      hint.backgroundPath = background;
    }
  }

  const length = read.str('H5WEB_arrow_length')?.toLowerCase();
  if (length === 'uniform' || length === 'magnitude') {
    hint.uniformArrows = length === 'uniform';
  } else if (length !== undefined) {
    notes.push(`"H5WEB_arrow_length" "${length}" is not valid`);
  }

  const density = read.num('H5WEB_arrow_density', (v) => v > 0);
  if (density !== undefined) {
    hint.arrowDensity = Math.min(Math.max(density, 0.5), 20);
  }

  return hint;
}

/* Component datasets named by `H5WEB_u`, `H5WEB_v` (, `H5WEB_w`) of a group, resolved like
 * overlay paths; they must be numeric arrays of the same shape */
export async function resolveVectorGroup(
  group: Group,
  values: AttributeValues,
  dataContext: DataContextValue,
): Promise<VectorSource> {
  const read = createAttrReader(group, values, []);
  const paths = COMPONENT_ATTRS.map((name) => read.str(name));
  if (!paths[0] || !paths[1]) {
    throw new Error('Vector groups need "H5WEB_u" and "H5WEB_v"');
  }
  const named = paths.filter((path) => path !== undefined);

  const ctx = createGeometryContext(dataContext);
  const anchor = `${group.path.replace(/\/$/u, '')}/.`;
  const components = await Promise.all(
    named.map(async (path) => resolveCoordinate(anchor, path, ctx)),
  );

  const datasets = components.map((entity, i) => {
    if (!isNumDataset(entity)) {
      throw new Error(
        `Component "${named[i]}" ${entity ? 'is not a numeric array' : 'not found'}`,
      );
    }
    return entity;
  });

  const rank = datasets.length === 3 ? 3 : 2;
  const { dims } = datasets[0].shape;
  if (datasets.some((d) => d.shape.dims.join(',') !== dims.join(','))) {
    throw new Error('Vector components must have the same shape');
  }
  if (dims.length < rank || dims.slice(-rank).some((n) => n < 2)) {
    throw new Error(
      `Vector components need at least ${rank} dimensions of 2 or more samples`,
    );
  }

  return { kind: 'group', components: datasets, rank };
}

/* Scalar dataset named by `H5WEB_vector_background`, resolved relative to the entity holding
 * the attribute; `undefined` if missing or not numeric */
export async function resolveBackground(
  entity: ProvidedEntity,
  path: string,
  dataContext: DataContextValue,
): Promise<NumDataset | undefined> {
  const anchor = isGroup(entity)
    ? `${entity.path.replace(/\/$/u, '')}/.`
    : entity.path;
  try {
    const found = await resolveCoordinate(
      anchor,
      path,
      createGeometryContext(dataContext),
    );
    return isNumDataset(found) ? found : undefined;
  } catch {
    return undefined;
  }
}

/* Interleaved components of a slice (…, 2|3) split into one array per component (`count`
 * vectors from the `start`-th one) */
export function splitComponents(
  value: ArrayLike<number | bigint>,
  rank: number,
  start = 0,
  count = value.length / rank - start,
): Float32Array[] {
  const out = Array.from({ length: rank }, () => new Float32Array(count));
  const offset = start * rank;
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < rank; c += 1) {
      out[c][i] = Number(value[offset + i * rank + c]);
    }
  }
  return out;
}

export function is3DField(
  field: VectorField2D | VectorField3D,
): field is VectorField3D {
  return 'w' in field;
}

/* Scalar under the field (3D: magnitude, colouring the arrows; none: still colours them) */
export function getVectorBackground(
  field: VectorField2D | VectorField3D,
  kind: VectorBackground,
  dataset: NumArray | undefined,
): NumArray | undefined {
  const { u, v } = field;
  if (is3DField(field)) {
    return getMagnitude(u, v, field.w);
  }
  switch (kind) {
    case VectorBackground.None:
    case VectorBackground.Magnitude:
      return getMagnitude(u, v);
    case VectorBackground.Divergence:
      return getDivergence(field);
    case VectorBackground.Curl:
      return getCurl2D(field);
    case VectorBackground.Dataset:
      return dataset;
    default:
      return undefined;
  }
}

/* Domain of the background over a sequence of slices of a dataset-form field (interleaved
 * components, slice after slice, on the grid of `field`); none for a background dataset (not
 * part of the sequence) */
export function getSequenceDomain(
  sequence: ArrayLike<number | bigint>,
  field: VectorField2D | VectorField3D,
  kind: VectorBackground,
  scaleType: ColorScaleType,
): Domain | undefined {
  if (kind === VectorBackground.Dataset) {
    return undefined;
  }
  const rank = is3DField(field) ? 3 : 2;
  const count = field.u.length;
  let domain: Domain | undefined;
  for (
    let start = 0;
    (start + count) * rank <= sequence.length;
    start += count
  ) {
    const [u, v, w] = splitComponents(sequence, rank, start, count);
    const slice = rank === 3 ? { ...field, u, v, w } : { ...field, u, v };
    const values = getVectorBackground(slice, kind, undefined);
    domain = extendDomain(domain, values && getDomain(values, { scaleType }));
  }
  return domain;
}

/* Axis of `n` samples: the dimension scale's values, else indices */
export function getAxisCoords(
  values: ArrayLike<number | bigint> | undefined,
  n: number,
): Float64Array {
  return values?.length === n
    ? Float64Array.from(values, Number)
    : Float64Array.from({ length: n }, (_, i) => i);
}

export interface ResolvedVector {
  source: VectorSource;
  hint: VectorHint;
  background?: NumDataset;
  units?: string;
}

async function resolveVector(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
): Promise<ResolvedVector> {
  const { queryClient, queries } = dataContext;
  const values = await queryClient.query(queries.attrValues(entity));
  const hint = parseVectorHint(entity, values);

  let source: VectorSource;
  if (isDataset(entity)) {
    const rank = getVectorRank(entity);
    if (!rank) {
      throw new Error(
        'Vector datasets need a last dimension of 2 (…, ny, nx, 2) or 3 (…, nz, ny, nx, 3)',
      );
    }
    source = { kind: 'dataset', dataset: entity as NumDataset, rank };
  } else {
    source = await resolveVectorGroup(entity as Group, values, dataContext);
  }

  const background = hint.backgroundPath
    ? await resolveBackground(entity, hint.backgroundPath, dataContext)
    : undefined;
  if (hint.backgroundPath && !background) {
    hint.notes.push(
      `"H5WEB_vector_background" "${hint.backgroundPath}" is not a numeric dataset`,
    );
  }

  const units: unknown = values.units;
  return {
    source,
    hint,
    background,
    units: typeof units === 'string' && units ? units : undefined,
  };
}

/* Source, settings and background of a vector entity (suspends; throws for invalid ones) */
export function useResolvedVector(entity: ProvidedEntity): ResolvedVector {
  const dataContext = useDataContext();
  return useSuspenseQuery({
    queryKey: [dataContext.cacheScope, 'vector', entity.path] as const,
    queryFn: async () => resolveVector(entity, dataContext),
  }).data;
}

/* x, y, z labels of the spatial dimensions (last ones, before the components) */
export function getSpatialLabels(
  labels: (string | undefined)[],
  dims: number[],
  isDatasetForm: boolean,
): [string?, string?, string?] {
  const last = dims.length - (isDatasetForm ? 2 : 1);
  return [labels[last], labels[last - 1], labels[last - 2]];
}
