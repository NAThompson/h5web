import { type IgnoreValue } from '@h5web/lib';
import { hasArrayShape, hasNumericType } from '@h5web/shared/guards';
import {
  type ArrayValue,
  type Dataset,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

import {
  type DataContextValue,
  useDataContext,
} from '../../../providers/DataProvider';
import { hasAttribute } from '../../../utils';
import { type Packing, unpackNumArray } from '../../netcdf/utils';
import { toNumArray } from '../utils';
import {
  COORDINATES_ATTR,
  createGeometryContext,
  DIMENSION_LIST_ATTR,
  findGeometry,
  type Geometry,
  type GeometryKind,
  INTERPRETATION_ATTR,
} from './utils';

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function geometryQuery(dataset: Dataset, dataContext: DataContextValue) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'geometry', dataset.path] as const,
    queryFn: async (): Promise<Geometry | null> => {
      const geometry = await findGeometry(
        dataset,
        createGeometryContext(dataContext),
      );
      return geometry ?? null;
    },
  });
}

/** Resolve the geometry a dataset describes (or is defined on), cf. `CurvesAndSurfaces.mdx` (Storybook). */
export function useGeometry(dataset: Dataset): Geometry {
  const dataContext = useDataContext();
  const { data } = useSuspenseQuery(geometryQuery(dataset, dataContext));

  if (!data) {
    throw new Error('Expected dataset to describe a curve or a surface');
  }

  return data;
}

/** Unpack (NetCDF), convert to numbers and replace invalid values with `NaN` (e.g. fill values). */
export function toCoordinateArray(
  value: ArrayValue<NumericType>,
  packing: Packing | undefined,
  ignoreValue: IgnoreValue | undefined,
): NumArray {
  const arr = toNumArray(unpackNumArray(value, packing));
  return ignoreValue
    ? Float64Array.from(arr, (val) => (ignoreValue(val) ? Number.NaN : val))
    : arr;
}

/** Split an array of vertices `(N, dims)` into one array per coordinate. */
export function splitVertices(vertices: NumArray, dims: number): NumArray[] {
  const count = Math.floor(vertices.length / dims);
  return Array.from({ length: dims }, (_, d) =>
    Float64Array.from({ length: count }, (__, i) => vertices[i * dims + d]),
  );
}

/* Curves and surfaces with a scalar field, cf. `CurvesAndSurfaces.mdx` (Storybook)
 * (cheap checks first, to avoid fetching attributes of any other dataset).
 * Never rejects, so the visualization selector cannot break. */
export async function getGeometryKind(
  dataset: Dataset,
  dataContext: DataContextValue,
): Promise<GeometryKind | undefined> {
  if (
    !hasArrayShape(dataset) ||
    !hasNumericType(dataset) ||
    (!hasAttribute(dataset, COORDINATES_ATTR) &&
      !hasAttribute(dataset, DIMENSION_LIST_ATTR) &&
      !hasAttribute(dataset, INTERPRETATION_ATTR))
  ) {
    return undefined;
  }

  const query = geometryQuery(dataset, dataContext);
  try {
    const geometry = await dataContext.queryClient.query(query);
    return geometry?.kind;
  } catch {
    /* Transient error (e.g. network): the visualization selector must not break, so don't
     * offer the visualization this time - but don't cache the failure either, so detection
     * is attempted again next time the dataset is selected. */
    dataContext.queryClient.removeQueries({
      queryKey: query.queryKey,
      exact: true,
    });
    return undefined;
  }
}
