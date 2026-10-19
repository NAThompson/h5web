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

/* Group with `H5WEB_geometry = "nurbs"` */
export async function isNurbsGroup(
  group: GroupWithChildren,
  dataContext: DataContextValue,
): Promise<boolean> {
  const attr = findScalarStrAttr(group, 'H5WEB_geometry');
  const geometry = await getAttributeValue(group, attr, dataContext);
  return geometry?.toLowerCase() === 'nurbs';
}

/* Datasets of a NURBS group, with the shapes they need (counts are checked with the values) */
export function getNurbsDatasets(group: GroupWithChildren): {
  points: NumDataset;
  weights: NumDataset | undefined;
  knots: NumDataset;
} {
  function find(name: string, rank: number): NumDataset | undefined {
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

  const points = find('control_points', 2);
  const knots = find('knots', 1);
  if (!points || !knots) {
    throw new Error('Expected "control_points" and "knots" datasets');
  }

  const [, dims] = points.shape.dims;
  if (dims !== 2 && dims !== 3) {
    throw new Error(
      `Expected "control_points" of shape (n, 2) or (n, 3), got (${points.shape.dims.join(', ')})`,
    );
  }

  return { points, weights: find('weights', 1), knots };
}
