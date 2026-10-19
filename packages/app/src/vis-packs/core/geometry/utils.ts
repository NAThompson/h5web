import {
  hasArrayShape,
  hasNumericType,
  hasScalarShape,
  hasStringType,
  isDataset,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Attribute,
  type Dataset,
  type Entity,
  EntityKind,
  type NumericType,
  type ProvidedEntity,
  type ScalarShape,
  type StringType,
} from '@h5web/shared/hdf5-models';

import { type DataContextValue } from '../../../providers/DataProvider';
import { isTransportError } from '../../../providers/utils';
import { findAttribute, getAttributeValue, hasAttribute } from '../../../utils';
import { formatUnits } from '../../units';

/* See `apps/storybook/src/CurvesAndSurfaces.mdx` for the specification of the convention. */
export const COORDINATES_ATTR = 'coordinates'; // CF auxiliary coordinate variables
export const FEATURE_TYPE_ATTR = 'featureType'; // CF discrete sampling geometries
export const TRAJECTORY_FEATURE_TYPE = 'trajectory';
export const DIMENSION_LIST_ATTR = 'DIMENSION_LIST'; // HDF5 dimension scales attached to a dataset
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
 * auxiliary coordinate datasets (CF `coordinates` attribute), or on a curve whose
 * points are given by the HDF5 dimension scales attached to its last dimension */
export interface CoordinatesGeometry {
  source: 'coordinates' | 'dimension-scales';
  kind: GeometryKind;
  field: NumDataset;
  coords: [CoordinateDef, CoordinateDef, CoordinateDef | undefined]; // x, y, z (planar curve without z)
}

/* Curve whose points are the rows of an `(..., N, 2 | 3)` dataset with NeXus `interpretation="vertex"` */
export interface VertexGeometry {
  source: 'vertex';
  kind: GeometryKind.Curve;
  vertices: NumDataset;
  unit?: string;
}

export type Geometry = CoordinatesGeometry | VertexGeometry;

/* Abstracts away entity and attribute fetching, for testing. Both functions resolve to
 * `undefined` when the entity or attribute does not exist or cannot be read/decoded,
 * but reject on transport errors (network failure, etc.), which say nothing about the data. */
export interface GeometryContext {
  getEntity: (path: string) => Promise<ProvidedEntity | undefined>;
  getStrAttr: (entity: Entity, name: string) => Promise<string | undefined>;
  // Paths of scales attached to each dimension; `null` if the provider cannot dereference `DIMENSION_LIST`
  getDimensionScales: (
    dataset: Dataset<ArrayShape>,
  ) => Promise<string[][] | null | undefined>;
}

/** String attribute: scalar string, or array holding a single string (e.g. NetCDF, MATLAB). */
export function findStrAttr(
  entity: Entity,
  name: string,
): Attribute<ScalarShape | ArrayShape, StringType> | undefined {
  const attr = findAttribute(entity, name);
  if (!attr || !hasStringType(attr)) {
    return undefined;
  }

  if (hasScalarShape(attr)) {
    return attr;
  }

  return hasArrayShape(attr) &&
    attr.shape.dims.length === 1 &&
    attr.shape.dims[0] === 1
    ? attr
    : undefined;
}

async function ignoreDataErrors<T>(
  promise: Promise<T>,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (isTransportError(error)) {
      throw error; // transient: must not be mistaken for missing data
    }
    return undefined; // not found, unreadable, undecodable...
  }
}

export function createGeometryContext(
  dataContext: DataContextValue,
): GeometryContext {
  const { queryClient, queries } = dataContext;

  return {
    getEntity: async (path) =>
      ignoreDataErrors(queryClient.query(queries.entity(path))),
    getDimensionScales: async (dataset) =>
      ignoreDataErrors(queryClient.query(queries.dimensionScales(dataset))),
    getStrAttr: async (entity, name) => {
      const attr = findStrAttr(entity, name);
      if (!attr) {
        return undefined;
      }

      const value = await ignoreDataErrors(
        getAttributeValue(entity, attr, dataContext),
      );
      const str: unknown = Array.isArray(value) ? value[0] : value;
      return typeof str === 'string' ? str : undefined;
    },
  };
}

/** Split CF `coordinates` attribute into variable names (blank-separated). */
export function parseCoordinatesAttr(value: string): string[] {
  return value.split(/\s+/u).filter((name) => name.length > 0);
}

function getParentPath(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || '/';
}

/** Join path segments, resolving `.` and `..` (never above root). */
export function normalizePath(basePath: string, relativePath: string): string {
  const segments = basePath.split('/').filter(Boolean);
  for (const segment of relativePath.split('/')) {
    if (segment === '..') {
      segments.pop();
    } else if (segment && segment !== '.') {
      segments.push(segment);
    }
  }

  return `/${segments.join('/')}`;
}

/**
 * Candidate paths of a coordinate variable, following CF 1.8 group references:
 * - absolute path (`/grp/x`): as is;
 * - relative path (`../x`, `./sub/x`, `sub/x`): relative to the field's group;
 * - bare name (`x`): search by proximity, from the field's group up to the root.
 */
export function getCoordinatePaths(fieldPath: string, name: string): string[] {
  const groupPath = getParentPath(fieldPath);

  if (name.startsWith('/')) {
    return [normalizePath('/', name)];
  }

  if (name.includes('/')) {
    return [normalizePath(groupPath, name)];
  }

  const paths = [normalizePath(groupPath, name)];
  let current = groupPath;
  while (current !== '/') {
    current = getParentPath(current);
    paths.push(normalizePath(current, name));
  }

  return paths;
}

export async function resolveCoordinate(
  fieldPath: string,
  name: string,
  ctx: GeometryContext,
): Promise<ProvidedEntity | undefined> {
  /* eslint-disable no-await-in-loop -- stop at nearest match */
  for (const path of getCoordinatePaths(fieldPath, name)) {
    const entity = await ctx.getEntity(path);
    // h5wasm gives an unresolved entity without link for a path that doesn't exist
    if (entity && (entity.kind !== EntityKind.Unresolved || entity.link)) {
      return entity;
    }
  }
  /* eslint-enable no-await-in-loop */

  return undefined;
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
  const shown = unit && formatUnits(unit);
  return shown && !base.includes(`(${unit})`) && !base.includes(`(${shown})`)
    ? `${base} (${shown})`
    : base;
}

/* Role of a coordinate variable, identified as described in CF §4 */
export type CoordinateRole = 'X' | 'Y' | 'Z' | 'T';

export interface CoordinateAttrs {
  axis?: string;
  standardName?: string;
  units?: string;
  positive?: string;
  scaleName?: string; // `NAME` of HDF5 dimension scale
}

const STANDARD_NAME_ROLES: Record<string, CoordinateRole> = {
  longitude: 'X',
  grid_longitude: 'X',
  projection_x_coordinate: 'X',
  projection_x_angular_coordinate: 'X',
  latitude: 'Y',
  grid_latitude: 'Y',
  projection_y_coordinate: 'Y',
  projection_y_angular_coordinate: 'Y',
  height: 'Z',
  altitude: 'Z',
  depth: 'Z',
  height_above_geopotential_datum: 'Z',
  height_above_reference_ellipsoid: 'Z',
  height_above_mean_sea_level: 'Z',
  atmosphere_sigma_coordinate: 'Z',
  air_pressure: 'Z',
  time: 'T',
};

const LONGITUDE_UNITS = /^degrees?_?e(?:ast)?$/iu; // degrees_east, degree_E, degreesE...
const LATITUDE_UNITS = /^degrees?_?n(?:orth)?$/iu;
const TIME_UNITS = /\ssince\s/iu; // e.g. "days since 1970-01-01"

function getRoleFromUnits(units: string): CoordinateRole | undefined {
  if (LONGITUDE_UNITS.test(units)) {
    return 'X';
  }
  if (LATITUDE_UNITS.test(units)) {
    return 'Y';
  }
  return TIME_UNITS.test(units) ? 'T' : undefined;
}

/**
 * Identify the role of a coordinate, by order of precedence: `axis` attribute, `standard_name`,
 * `units` (longitude, latitude, or time reference), then `positive` (vertical coordinate).
 */
export function identifyRole(
  attrs: CoordinateAttrs,
): CoordinateRole | undefined {
  const axis = attrs.axis?.trim().toUpperCase();
  if (axis === 'X' || axis === 'Y' || axis === 'Z' || axis === 'T') {
    return axis;
  }

  const standardName = attrs.standardName?.trim();
  if (standardName && standardName in STANDARD_NAME_ROLES) {
    return STANDARD_NAME_ROLES[standardName];
  }

  const unitsRole = getRoleFromUnits(attrs.units?.trim() ?? '');
  if (unitsRole) {
    return unitsRole;
  }

  const positive = attrs.positive?.trim().toLowerCase();
  return positive === 'up' || positive === 'down' ? 'Z' : undefined;
}

/**
 * Role of a dimension scale: as for coordinates (cf. `identifyRole`), then by the scale's
 * `NAME` (given to `make_scale`) if literally `x`, `y` or `z`. Not used for `coordinates`,
 * where an unidentified coordinate must keep the listed-order fallback.
 */
export function identifyScaleRole(
  attrs: CoordinateAttrs,
): CoordinateRole | undefined {
  const role = identifyRole(attrs);
  if (role) {
    return role;
  }

  const scaleName = attrs.scaleName?.trim().toUpperCase();
  return scaleName === 'X' || scaleName === 'Y' || scaleName === 'Z'
    ? scaleName
    : undefined;
}

/**
 * Pick X, Y and Z among the matching coordinates, given their identified roles:
 * - time coordinates are left out;
 * - each spatial role must be held by at most one coordinate;
 * - if exactly one spatial role is unidentified and exactly one coordinate is left, it takes it
 *   (e.g. longitude and latitude identified by their units, plus an altitude in metres);
 * - if no coordinate is identified, exactly three must remain: X, Y, Z in the order listed.
 */
export function pickXYZ<T>(
  candidates: T[],
  roles: (CoordinateRole | undefined)[],
): [T, T, T] | undefined {
  const spatial = candidates
    .map((candidate, i) => ({ candidate, role: roles[i] }))
    .filter(({ role }) => role !== 'T');

  if (spatial.every(({ role }) => role === undefined)) {
    return spatial.length === 3
      ? [spatial[0].candidate, spatial[1].candidate, spatial[2].candidate]
      : undefined;
  }

  const byRole = new Map<CoordinateRole, T>();
  const unidentified: T[] = [];
  for (const { candidate, role } of spatial) {
    if (!role) {
      unidentified.push(candidate);
    } else if (byRole.has(role)) {
      return undefined; // ambiguous
    } else {
      byRole.set(role, candidate);
    }
  }

  const missing = (['X', 'Y', 'Z'] as const).filter((r) => !byRole.has(r));
  if (missing.length === 1 && unidentified.length === 1) {
    byRole.set(missing[0], unidentified[0]);
  } else if (missing.length > 0 || unidentified.length > 0) {
    return undefined;
  }

  const [x, y, z] = (['X', 'Y', 'Z'] as const).map((r) => byRole.get(r));
  return x && y && z ? [x, y, z] : undefined;
}

async function getCoordinateAttrs(
  dataset: NumDataset,
  ctx: GeometryContext,
): Promise<CoordinateAttrs & { longName?: string }> {
  const [axis, standardName, units, positive, longName, scaleName] =
    await Promise.all(
      ['axis', 'standard_name', 'units', 'positive', 'long_name', 'NAME'].map(
        async (name) => ctx.getStrAttr(dataset, name),
      ),
    );
  return { axis, standardName, units, positive, longName, scaleName };
}

function toCoordinateDef({
  dataset,
  attrs,
}: {
  dataset: NumDataset;
  attrs: CoordinateAttrs & { longName?: string };
}): CoordinateDef {
  const { longName, units } = attrs;
  return {
    dataset,
    label: getAxisLabel(dataset.name, longName, units || undefined),
    unit: units || undefined,
  };
}

/* Label of a dimension scale used as curve axis, as for dimension scales in other visualizations
 * (scale `NAME`, else dataset name, plus units), CF `long_name` first. The dimension's own
 * `DIMENSION_LABELS` entry names the curve's parameter, shared by all three scales, so it
 * cannot label them. */
function toScaleCoordinateDef({
  dataset,
  attrs,
}: {
  dataset: NumDataset;
  attrs: CoordinateAttrs & { longName?: string };
}): CoordinateDef {
  const { longName, scaleName, units } = attrs;
  return {
    dataset,
    label: getAxisLabel(
      dataset.name,
      longName || scaleName || undefined,
      units || undefined,
    ),
    unit: units || undefined,
  };
}

/**
 * 1D auxiliary coordinates do not imply that points are connected (e.g. CF `timeSeries` or
 * `point` features): a field is drawn as a curve only if its own `featureType` attribute
 * (opt-in), or else the file's global `featureType` attribute, is `trajectory`.
 */
async function isTrajectory(
  field: NumDataset,
  ctx: GeometryContext,
): Promise<boolean> {
  const ownType = await ctx.getStrAttr(field, FEATURE_TYPE_ATTR);
  if (ownType !== undefined) {
    return ownType.trim().toLowerCase() === TRAJECTORY_FEATURE_TYPE;
  }

  const root = await ctx.getEntity('/');
  const globalType = root && (await ctx.getStrAttr(root, FEATURE_TYPE_ATTR));
  return globalType?.trim().toLowerCase() === TRAJECTORY_FEATURE_TYPE;
}

async function findCoordinatesGeometry(
  field: NumDataset,
  coordinatesAttr: string,
  ctx: GeometryContext,
): Promise<CoordinatesGeometry | undefined> {
  const names = parseCoordinatesAttr(coordinatesAttr);
  if (names.length < 3) {
    return undefined; // e.g. "lon lat" of curvilinear grid: no further request
  }

  const entities = await Promise.all(
    names.map(async (name) => resolveCoordinate(field.path, name, ctx)),
  );

  // Ignore variables that are not plottable coordinates (e.g. scalar coordinates, labels)
  const fieldDims = field.shape.dims;
  const candidates = entities.filter(
    (entity): entity is NumDataset =>
      isNumDataset(entity) &&
      entity.path !== field.path &&
      isMatchingCoordinate(fieldDims, entity.shape.dims),
  );
  if (candidates.length < 3) {
    return undefined;
  }

  const attrs = await Promise.all(
    candidates.map(async (c) => getCoordinateAttrs(c, ctx)),
  );
  const xyz = pickXYZ(
    candidates.map((dataset, i) => ({ dataset, attrs: attrs[i] })),
    attrs.map(identifyRole),
  );
  if (!xyz) {
    return undefined;
  }

  // Coordinates must all describe the same grid
  const [x, y, z] = xyz;
  const rank = x.dataset.shape.dims.length;
  if (
    y.dataset.shape.dims.length !== rank ||
    z.dataset.shape.dims.length !== rank
  ) {
    return undefined;
  }

  // Surfaces need at least two rows and two columns to have any triangle
  if (rank === 2 && x.dataset.shape.dims.some((dim) => dim < 2)) {
    return undefined;
  }

  // Grid connectivity is implied for surfaces, not for curves
  if (rank === 1 && !(await isTrajectory(field, ctx))) {
    return undefined;
  }

  return {
    source: 'coordinates',
    kind: rank === 1 ? GeometryKind.Curve : GeometryKind.Surface,
    field,
    coords: [toCoordinateDef(x), toCoordinateDef(y), toCoordinateDef(z)],
  };
}

/**
 * Curve given by the HDF5 dimension scales attached to the last dimension of the field:
 * scales identified as X and Y (and optionally Z) by the same rules as for `coordinates`,
 * plus the scale's `NAME` (cf. `identifyScaleRole`). Unidentified scales are alternatives for the axis (e.g. time in
 * other units) and are ignored; without X and Y, there is no curve. As for 1D `coordinates`,
 * points are connected only for trajectories (`featureType`). Dimension scales are 1D by
 * definition, so they cannot describe surfaces.
 */
async function findDimScalesGeometry(
  field: NumDataset,
  ctx: GeometryContext,
): Promise<CoordinatesGeometry | undefined> {
  // Cheap check first (attributes only): most datasets with scales (e.g. any NetCDF4 variable)
  // are not trajectories, and must not cost a dereferencing round-trip to the provider
  if (!(await isTrajectory(field, ctx))) {
    return undefined;
  }

  const { dims } = field.shape;
  const dimSize = dims[dims.length - 1];
  const allScalePaths = await ctx.getDimensionScales(field); // `null`: provider can't dereference
  if (allScalePaths?.length !== dims.length) {
    return undefined; // unsupported, or list inconsistent with the dataset's dimensions
  }

  const scalePaths = allScalePaths[dims.length - 1];
  if (scalePaths.length < 2) {
    return undefined; // e.g. single coordinate variable of NetCDF dimension
  }

  const entities = await Promise.all(
    scalePaths.map(async (path) => ctx.getEntity(path)),
  );
  const candidates = entities.filter(
    (entity): entity is NumDataset =>
      isNumDataset(entity) &&
      entity.shape.dims.length === 1 &&
      entity.shape.dims[0] === dimSize,
  );
  if (candidates.length < 2) {
    return undefined;
  }

  const attrs = await Promise.all(
    candidates.map(async (c) => getCoordinateAttrs(c, ctx)),
  );
  const byRole = new Map<
    CoordinateRole,
    { dataset: NumDataset; attrs: CoordinateAttrs }
  >();
  for (const [i, dataset] of candidates.entries()) {
    const role = identifyScaleRole(attrs[i]);
    if (role && role !== 'T') {
      if (byRole.has(role)) {
        return undefined; // ambiguous
      }
      byRole.set(role, { dataset, attrs: attrs[i] });
    }
  }

  const [x, y, z] = (['X', 'Y', 'Z'] as const).map((role) => byRole.get(role));
  if (!x || !y) {
    return undefined;
  }

  return {
    source: 'dimension-scales',
    kind: GeometryKind.Curve,
    field,
    coords: [
      toScaleCoordinateDef(x),
      toScaleCoordinateDef(y),
      z && toScaleCoordinateDef(z),
    ],
  };
}

/**
 * Find out whether a dataset is a curve or surface with a scalar field defined on it,
 * according to the convention described in `CurvesAndSurfaces.mdx` (Storybook).
 * Resolves to `undefined` when it is not; rejects on transport errors (cf. `GeometryContext`).
 */
export async function findGeometry(
  dataset: Dataset,
  ctx: GeometryContext,
): Promise<Geometry | undefined> {
  if (!isNumDataset(dataset)) {
    return undefined;
  }

  // When present (whatever its type), `coordinates` attribute alone decides
  if (hasAttribute(dataset, COORDINATES_ATTR)) {
    const coordinatesAttr = await ctx.getStrAttr(dataset, COORDINATES_ATTR);
    return coordinatesAttr
      ? findCoordinatesGeometry(dataset, coordinatesAttr, ctx)
      : undefined;
  }

  // Then HDF5 dimension scales (curves only)
  if (hasAttribute(dataset, DIMENSION_LIST_ATTR)) {
    const geometry = await findDimScalesGeometry(dataset, ctx);
    if (geometry) {
      return geometry;
    }
  }

  const { dims } = dataset.shape;
  const lastDim = dims[dims.length - 1];
  if (
    dims.length < 2 ||
    (lastDim !== 2 && lastDim !== 3) ||
    !findStrAttr(dataset, INTERPRETATION_ATTR)
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

/** Best guess of `getGeometryDimsCount` from attributes alone, before the geometry is resolved. */
export function guessGeometryDimsCount(
  dataset: Dataset,
  kind: GeometryKind,
): number {
  return kind === GeometryKind.Surface ||
    (hasAttribute(dataset, INTERPRETATION_ATTR) &&
      !hasAttribute(dataset, COORDINATES_ATTR))
    ? 2
    : 1;
}

/** Number of trailing dimensions of the dataset taken up by the geometry, i.e. that cannot be sliced. */
export function getGeometryDimsCount(geometry: Geometry): number {
  // Surfaces: (u, v) grid; `vertex` curves: points + vertex coordinates; other curves: points
  return geometry.kind === GeometryKind.Surface || geometry.source === 'vertex'
    ? 2
    : 1;
}

/**
 * NeXus `default_slice` applies to the leading (sliceable) dimensions only: it is ignored
 * unless it keeps exactly the trailing geometry dimensions (`.`) and gives indices for the others.
 */
export function getGeometryDefaultSlice<T extends number | '.'>(
  defaultSlice: T[] | undefined,
  geometryDimsCount: number,
): T[] | undefined {
  if (!defaultSlice) {
    return undefined;
  }

  const leadCount = defaultSlice.length - geometryDimsCount;
  return leadCount >= 0 &&
    defaultSlice.every((val, i) => (i < leadCount ? val !== '.' : val === '.'))
    ? defaultSlice
    : undefined;
}
