import { hasArrayShape, hasNumericType, isDataset } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
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

/* Group with `H5WEB_geometry = "nurbs"` or `"bspline"` */
export async function isNurbsGroup(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<boolean> {
  const attr = findScalarStrAttr(group, 'H5WEB_geometry');
  const geometry = await getAttributeValue(group, attr, dataContext);
  return isNurbsGeometry(geometry);
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
