import { hasArrayShape, hasNumericType, isDataset } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type Entity,
  type NumericType,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { buildEntityPath } from '@h5web/shared/hdf5-utils';

import { type DataContextValue } from '../../../providers/DataProvider';
import { findScalarStrAttr, getAttributeValue } from '../../../utils';

/* See `CONVENTION.md` next to this file for the specification of the convention. */
export const COORDINATES_ATTR = 'coordinates'; // CF auxiliary coordinate variables
export const INTERPRETATION_ATTR = 'interpretation'; // NeXus
export const VERTEX_INTERPRETATION = 'vertex'; // NeXus: last dimension holds vertex coordinates

export type NumDataset = Dataset<ArrayShape, NumericType>;

export enum GeometryKind {
  Curve = 'curve',
  Surface = 'surface',
}

export interface CoordinateDef {
  dataset: NumDataset;
  label: string; // name or `long_name`, with `units` if any
  unit?: string;
}

/* Scalar field `field` defined on a curve or surface whose points are given by
 * auxiliary coordinate datasets (CF `coordinates` attribute) */
export interface CoordinatesGeometry {
  source: 'coordinates';
  kind: GeometryKind;
  field: NumDataset;
  coords: [CoordinateDef, CoordinateDef, CoordinateDef]; // x, y, z
}

/* Curve whose points are the rows of an `(..., N, 2 | 3)` dataset with NeXus `interpretation="vertex"` */
export interface VertexGeometry {
  source: 'vertex';
  kind: GeometryKind.Curve;
  vertices: NumDataset;
  unit?: string;
}

export type Geometry = CoordinatesGeometry | VertexGeometry;

/* Abstracts away entity and attribute fetching, for testing */
export interface GeometryContext {
  getEntity: (path: string) => Promise<ProvidedEntity | undefined>; // `undefined` if not found
  getStrAttr: (entity: Entity, name: string) => Promise<string | undefined>;
}

export function createGeometryContext(
  dataContext: DataContextValue,
): GeometryContext {
  const { queryClient, queries } = dataContext;

  return {
    getEntity: async (path) => {
      try {
        return await queryClient.query(queries.entity(path));
      } catch {
        return undefined; // e.g. coordinate not found
      }
    },
    getStrAttr: async (entity, name) => {
      const attr = findScalarStrAttr(entity, name);
      return getAttributeValue(entity, attr, dataContext);
    },
  };
}

/** Split CF `coordinates` attribute into variable names (blank-separated). */
export function parseCoordinatesAttr(value: string): string[] {
  return value.split(/\s+/u).filter((name) => name.length > 0);
}

/** Resolve name of coordinate variable: absolute path, or path relative to the field's group. */
export function resolveCoordinatePath(fieldPath: string, name: string): string {
  if (name.startsWith('/')) {
    return name;
  }

  const parentPath = fieldPath.slice(0, fieldPath.lastIndexOf('/')) || '/';
  return buildEntityPath(parentPath, name);
}

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

/**
 * Coordinates must be 1D (curve) or 2D (surface) and match the trailing dimensions of
 * the field; leading dimensions of the field, if any, can then be sliced (e.g. time).
 */
export function isMatchingCoordinate(
  fieldDims: number[],
  coordDims: number[],
): boolean {
  const rank = coordDims.length;
  if (rank < 1 || rank > 2 || fieldDims.length < rank) {
    return false;
  }

  const trailingDims = fieldDims.slice(-rank);
  return coordDims.every((dim, i) => dim === trailingDims[i]);
}

export function getAxisLabel(
  name: string,
  longName: string | undefined,
  unit: string | undefined,
): string {
  const base = longName || name;
  return unit && !base.includes(`(${unit})`) ? `${base} (${unit})` : base;
}

async function getCoordinateDef(
  dataset: NumDataset,
  ctx: GeometryContext,
): Promise<CoordinateDef> {
  const [longName, unit] = await Promise.all([
    ctx.getStrAttr(dataset, 'long_name'),
    ctx.getStrAttr(dataset, 'units'),
  ]);

  return {
    dataset,
    label: getAxisLabel(dataset.name, longName, unit || undefined),
    unit: unit || undefined,
  };
}

/**
 * Pick X, Y and Z among the matching coordinates: by CF `axis` attribute if any
 * coordinate has one, otherwise in the order in which they are listed (exactly three
 * are then expected, to avoid guessing).
 */
async function pickXYZ(
  candidates: NumDataset[],
  ctx: GeometryContext,
): Promise<[NumDataset, NumDataset, NumDataset] | undefined> {
  const axisAttrs = await Promise.all(
    candidates.map(async (c) => ctx.getStrAttr(c, 'axis')),
  );
  const axes = axisAttrs.map((axis) => axis?.toUpperCase());

  if (axes.some((axis) => axis === 'X' || axis === 'Y' || axis === 'Z')) {
    const [x, y, z] = ['X', 'Y', 'Z'].map((axis) => {
      const matches = candidates.filter((_, i) => axes[i] === axis);
      return matches.length === 1 ? matches[0] : undefined;
    });
    return x && y && z ? [x, y, z] : undefined;
  }

  const spatial = candidates.filter((_, i) => axes[i] !== 'T'); // e.g. time of trajectory
  return spatial.length === 3
    ? [spatial[0], spatial[1], spatial[2]]
    : undefined;
}

async function findCoordinatesGeometry(
  field: NumDataset,
  coordinatesAttr: string,
  ctx: GeometryContext,
): Promise<CoordinatesGeometry | undefined> {
  const fieldDims = field.shape.dims;
  const names = parseCoordinatesAttr(coordinatesAttr);

  const entities = await Promise.all(
    names.map(async (name) =>
      ctx.getEntity(resolveCoordinatePath(field.path, name)),
    ),
  );

  // Ignore variables that are not plottable coordinates (e.g. scalar coordinates, labels)
  const candidates = entities.filter(
    (entity): entity is NumDataset =>
      isNumDataset(entity) &&
      entity.path !== field.path &&
      isMatchingCoordinate(fieldDims, entity.shape.dims),
  );

  const xyz = await pickXYZ(candidates, ctx);
  if (!xyz) {
    return undefined;
  }

  // Coordinates must all describe the same grid
  const [x, y, z] = xyz;
  const rank = x.shape.dims.length;
  if (y.shape.dims.length !== rank || z.shape.dims.length !== rank) {
    return undefined;
  }

  const coords = await Promise.all(
    xyz.map(async (c) => getCoordinateDef(c, ctx)),
  );

  return {
    source: 'coordinates',
    kind: rank === 1 ? GeometryKind.Curve : GeometryKind.Surface,
    field,
    coords: [coords[0], coords[1], coords[2]],
  };
}

/**
 * Find out whether a dataset is a curve or surface with a scalar field defined on it,
 * according to the convention described in `CONVENTION.md`.
 */
export async function findGeometry(
  dataset: Dataset,
  ctx: GeometryContext,
): Promise<Geometry | undefined> {
  if (!isNumDataset(dataset)) {
    return undefined;
  }

  // When present, `coordinates` attribute alone decides (no fallback to `vertex` interpretation)
  if (findScalarStrAttr(dataset, COORDINATES_ATTR)) {
    const coordinatesAttr = await ctx.getStrAttr(dataset, COORDINATES_ATTR);
    return coordinatesAttr
      ? findCoordinatesGeometry(dataset, coordinatesAttr, ctx)
      : undefined;
  }

  const { dims } = dataset.shape;
  const lastDim = dims[dims.length - 1];
  if (
    dims.length < 2 ||
    (lastDim !== 2 && lastDim !== 3) ||
    !findScalarStrAttr(dataset, INTERPRETATION_ATTR)
  ) {
    return undefined;
  }

  const interpretation = await ctx.getStrAttr(dataset, INTERPRETATION_ATTR);
  if (interpretation !== VERTEX_INTERPRETATION) {
    return undefined;
  }

  const unit = await ctx.getStrAttr(dataset, 'units');
  return {
    source: 'vertex',
    kind: GeometryKind.Curve,
    vertices: dataset,
    unit: unit || undefined,
  };
}

/** Number of trailing dimensions of the dataset taken up by the geometry, i.e. that cannot be sliced. */
export function getGeometryDimsCount(
  dataset: Dataset,
  kind: GeometryKind,
): number {
  // `vertex` curves: points + vertex coordinates; surfaces: (u, v) grid
  return kind === GeometryKind.Surface ||
    !findScalarStrAttr(dataset, COORDINATES_ATTR)
    ? 2
    : 1;
}
