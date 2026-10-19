import {
  hasArrayShape,
  hasChildren,
  hasNumericType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type Entity,
  type GroupWithChildren,
  type NumericType,
} from '@h5web/shared/hdf5-models';

import { type DataContextValue } from '../../providers/DataProvider';
import { findScalarStrAttr, getAttributeValue } from '../../utils';

type NumDataset = Dataset<ArrayShape, NumericType>;

/* `H5WEB_geometry` of NURBS groups: "bspline" for non-rational ones (no weights) */
export function isNurbsGeometry(geometry: string | undefined): boolean {
  const val = geometry?.toLowerCase();
  return val === 'nurbs' || val === 'bspline';
}

/* `H5WEB_geometry` of a NURBS group, or of the multi-patch group of a lone patch (a surface
 * group without its own `H5WEB_geometry`, cf. `isNurbsMultiPatchGroup`) */
export async function getNurbsGeometry(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<string | undefined> {
  const attr = findScalarStrAttr(group, 'H5WEB_geometry');
  if (attr || !isNurbsSurfaceGroup(group) || group.path === '/') {
    return getAttributeValue(group, attr, dataContext);
  }

  const { queryClient, queries } = dataContext;
  const parentPath = group.path.slice(0, group.path.lastIndexOf('/')) || '/';
  const parent = await queryClient.query(queries.entity(parentPath));
  if (!isGroup(parent) || !hasChildren(parent)) {
    return undefined;
  }
  const geometry = await getAttributeValue(
    parent,
    findScalarStrAttr(parent, 'H5WEB_geometry'),
    dataContext,
  );
  return isNurbsMultiPatchGroup(parent) && isNurbsGeometry(geometry)
    ? geometry
    : undefined;
}

/* Group with `H5WEB_geometry = "nurbs"` or `"bspline"`, or lone patch of such a group */
export async function isNurbsGroup(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<boolean> {
  return isNurbsGeometry(await getNurbsGeometry(group, dataContext));
}

const BSPLINE_WEIGHTS_ERROR =
  'B-splines have no weights; use H5WEB_geometry = "nurbs"';

/* Child dataset `name` of a NURBS group, if any, checked to be numeric with given rank */
function findNumDataset(
  group: GroupWithChildren,
  name: string,
  rank: number,
): NumDataset | undefined {
  const child = group.children.find((entity) => entity.name === name);
  if (!child) {
    return undefined;
  }
  if (
    !isDataset(child) ||
    !hasArrayShape(child) ||
    !hasNumericType(child) ||
    child.shape.dims.length !== rank
  ) {
    throw new Error(`Expected "${name}" to be a ${rank}D numeric dataset`);
  }
  return child;
}

/* Surface if its control points are a grid: `(nu, nv, 3)` */
export function isNurbsSurfaceGroup(group: GroupWithChildren): boolean {
  const points = group.children.find(({ name }) => name === 'control_points');
  return (
    !!points &&
    isDataset(points) &&
    hasArrayShape(points) &&
    points.shape.dims.length === 3
  );
}

/* Multi-patch surface: no control points of its own, but patch groups, each a surface */
export function isNurbsMultiPatchGroup(group: GroupWithChildren): boolean {
  return (
    !group.children.some(({ name }) => name === 'control_points') &&
    group.children.some(isGroup)
  );
}

/* Datasets of a NURBS group, with the shapes they need (counts are checked with the values) */
export function getNurbsDatasets(
  group: GroupWithChildren,
  isBspline: boolean,
): {
  points: NumDataset;
  weights: NumDataset | undefined;
  knots: NumDataset;
} {
  const points = findNumDataset(group, 'control_points', 2);
  const knots = findNumDataset(group, 'knots', 1);
  if (!points || !knots) {
    throw new Error('Expected "control_points" and "knots" datasets');
  }

  const [, dims] = points.shape.dims;
  if (dims !== 2 && dims !== 3) {
    throw new Error(
      `Expected "control_points" of shape (n, 2) or (n, 3), got (${points.shape.dims.join(', ')})`,
    );
  }

  const weights = findNumDataset(group, 'weights', 1);
  if (weights && isBspline) {
    throw new Error(BSPLINE_WEIGHTS_ERROR);
  }
  return { points, weights, knots };
}

/* Datasets of a NURBS surface group: control points `(nu, nv, 3)`, weights `(nu, nv)` */
export function getNurbsSurfaceDatasets(
  group: GroupWithChildren,
  isBspline: boolean,
): {
  points: NumDataset;
  weights: NumDataset | undefined;
  knotsU: NumDataset;
  knotsV: NumDataset;
} {
  const points = findNumDataset(group, 'control_points', 3);
  const knotsU = findNumDataset(group, 'knots_u', 1);
  const knotsV = findNumDataset(group, 'knots_v', 1);
  if (!points || !knotsU || !knotsV) {
    throw new Error(
      'Expected "control_points", "knots_u" and "knots_v" datasets',
    );
  }

  const [nu, nv, dims] = points.shape.dims;
  if (dims !== 3) {
    throw new Error(
      `Expected "control_points" of shape (nu, nv, 3), got (${points.shape.dims.join(', ')})`,
    );
  }

  const weights = findNumDataset(group, 'weights', 2);
  if (weights && isBspline) {
    throw new Error(BSPLINE_WEIGHTS_ERROR);
  }
  if (
    weights &&
    (weights.shape.dims[0] !== nu || weights.shape.dims[1] !== nv)
  ) {
    throw new Error(
      `Expected "weights" of shape (${nu}, ${nv}), got (${weights.shape.dims.join(', ')})`,
    );
  }

  return { points, weights, knotsU, knotsV };
}

/* Group of the scalar fields of a NURBS surface (or patch): one dataset per field, by name */
export const FIELDS_GROUP = 'fields';

/* Datasets of a `fields` group, if any: control values `(nu, nv)` in the basis of the surface */
export function getNurbsFieldDatasets(
  group: Entity | undefined,
  [nu, nv]: [number, number],
): NumDataset[] {
  if (!group || !isGroup(group) || !hasChildren(group)) {
    return [];
  }
  return group.children.filter(isDataset).map((child) => {
    if (
      !hasArrayShape(child) ||
      !hasNumericType(child) ||
      child.shape.dims.length !== 2 ||
      child.shape.dims[0] !== nu ||
      child.shape.dims[1] !== nv
    ) {
      const shape = hasArrayShape(child)
        ? ` (got (${child.shape.dims.join(', ')}))`
        : '';
      throw new Error(
        `Expected field "${child.name}" to be a numeric dataset of shape (${nu}, ${nv})${shape}`,
      );
    }
    return child;
  });
}
