import {
  getNurbsError,
  getNurbsSurfaceError,
  type NurbsCurve,
  type NurbsSurface,
} from '@h5web/lib';
import {
  assertGroup,
  assertGroupWithChildren,
  hasArrayShape,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type ArrayValue,
  type GroupWithChildren,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAttrValue, useValues } from '../../hooks';
import { useDataContext } from '../../providers/DataProvider';
import { findSingleNumAttr } from '../../utils';
import { toNumArray } from '../core/utils';
import {
  FIELDS_GROUP,
  getNurbsDatasets,
  getNurbsFieldDatasets,
  getNurbsGeometry,
  getNurbsSurfaceDatasets,
  isNurbsMultiPatchGroup,
} from './utils';

/* `H5WEB_geometry = "bspline"` (of the multi-patch group of a lone patch): no weights */
function useIsBspline(group: GroupWithChildren): boolean {
  const dataContext = useDataContext();
  const { data: geometry } = useSuspenseQuery({
    queryKey: [dataContext.filepath, 'nurbsGeometry', group.path],
    queryFn: async () => (await getNurbsGeometry(group, dataContext)) ?? null,
  });
  return geometry?.toLowerCase() === 'bspline';
}

/* Fetch control points, weights, knots and degree of a NURBS group, and check them */
export function useNurbsCurve(group: GroupWithChildren): NurbsCurve {
  const { points, weights, knots } = getNurbsDatasets(
    group,
    useIsBspline(group),
  );
  const degreeAttr = findSingleNumAttr(group, 'degree');
  if (!degreeAttr) {
    throw new Error('Expected numeric "degree" attribute on group');
  }

  const degree = useAttrValue(group, degreeAttr);
  const values = useValues({
    points,
    knots,
    ...(weights && { weights }),
  });

  const curve = useMemo((): NurbsCurve => {
    const pointValues = toNumArray(values.points);
    return {
      degree: Number(typeof degree === 'object' ? degree[0] : degree),
      dims: points.shape.dims[1],
      points: pointValues,
      weights: values.weights
        ? toNumArray(values.weights)
        : new Float64Array(points.shape.dims[0]).fill(1),
      knots: toNumArray(values.knots),
    };
  }, [degree, points, values]);

  const error = getNurbsError(curve);
  if (error) {
    throw new Error(`Invalid NURBS curve: ${error}`);
  }
  return curve;
}

/* Data of each query, the same array as long as the data are the same (cf. `replaceEqualDeep`) */
function getData<T>(results: { data: T }[]): T[] {
  return results.map(({ data }) => data);
}

/* Patch groups of a multi-patch group (cf. `isNurbsMultiPatchGroup`), else the group itself,
 * and errors naming the patch, if any */
function useNurbsPatches(group: GroupWithChildren): {
  patches: GroupWithChildren[];
  getError: (patch: GroupWithChildren, message: string) => Error;
} {
  const { queries } = useDataContext();
  const isMultiPatch = isNurbsMultiPatchGroup(group);

  const patchEntities = useSuspenseQueries({
    queries: isMultiPatch
      ? group.children.filter(isGroup).map(({ path }) => queries.entity(path))
      : [],
    combine: getData,
  });
  const patches = useMemo(() => {
    if (!isMultiPatch) {
      return [group];
    }
    return patchEntities.map((patch) => {
      assertGroup(patch);
      assertGroupWithChildren(patch);
      return patch;
    });
  }, [group, isMultiPatch, patchEntities]);

  const getError = useCallback(
    (patch: GroupWithChildren, message: string) =>
      new Error(isMultiPatch ? `Patch ${patch.name}: ${message}` : message),
    [isMultiPatch],
  );
  return { patches, getError };
}

/*
 * Fetch control points, weights, knots and degrees of a NURBS surface group, or of each patch
 * group of a multi-patch group (cf. `isNurbsMultiPatchGroup`), and check them
 */
export function useNurbsSurfaces(group: GroupWithChildren): NurbsSurface[] {
  const { queries } = useDataContext();
  const isBspline = useIsBspline(group);
  const isMultiPatch = isNurbsMultiPatchGroup(group);
  const { patches, getError } = useNurbsPatches(group);

  const attrValues = useSuspenseQueries({
    queries: patches.map((patch) => queries.attrValues(patch)),
    combine: getData,
  });
  const datasets = useMemo(
    () =>
      patches.map((patch) => {
        try {
          return getNurbsSurfaceDatasets(patch, isBspline);
        } catch (error) {
          throw error instanceof Error ? getError(patch, error.message) : error;
        }
      }),
    [patches, isBspline, getError],
  );

  const values = useSuspenseQueries({
    queries: datasets.flatMap(({ points, weights, knotsU, knotsV }) =>
      [points, knotsU, knotsV, ...(weights ? [weights] : [])].map((dataset) =>
        queries.value(dataset),
      ),
    ),
    combine: getData,
  });

  return useMemo(() => {
    let offset = 0;
    return patches.map((patch, i) => {
      const { points, weights } = datasets[i];
      const count = weights ? 4 : 3;
      const [pointValues, knotsU, knotsV, weightValues] = values
        .slice(offset, offset + count)
        .map((val) => toNumArray(val as ArrayValue<NumericType>));
      offset += count;

      // `degree_u` and `degree_v`, or `degree` for both
      const degreeAttr = findSingleNumAttr(patch, 'degree');
      const degrees = ['degree_u', 'degree_v'].map((name) => {
        const attr = findSingleNumAttr(patch, name) ?? degreeAttr;
        const val: unknown = attr && attrValues[i][attr.name];
        const isArray = Array.isArray(val) || ArrayBuffer.isView(val);
        return val === undefined
          ? undefined
          : Number(isArray ? (val as ArrayLike<unknown>)[0] : val);
      });
      const [degreeU, degreeV] = degrees;
      if (degreeU === undefined || degreeV === undefined) {
        throw getError(
          patch,
          'Expected numeric "degree_u" and "degree_v" (or "degree") attributes on group',
        );
      }

      const [nu, nv] = points.shape.dims;
      const surface: NurbsSurface = {
        degrees: [degreeU, degreeV],
        shape: [nu, nv],
        points: pointValues,
        weights: weights ? weightValues : new Float64Array(nu * nv).fill(1),
        knots: [knotsU, knotsV],
      };

      const error = getNurbsSurfaceError(surface);
      if (error) {
        throw getError(
          patch,
          isMultiPatch ? error : `Invalid NURBS surface: ${error}`,
        );
      }
      return surface;
    });
  }, [patches, datasets, values, attrValues, isMultiPatch, getError]);
}

export interface NurbsFieldInfo {
  name: string; // of the datasets
  label: string; // `long_name`, else name
  unit?: string; // `units`
}

/*
 * Fetch the scalar fields of a NURBS surface: datasets of its `fields` group (or of each patch's,
 * cf. `getNurbsFieldDatasets`), which every patch must have; their control values, patch after
 * patch, in the order of `fields`.
 */
export function useNurbsFields(group: GroupWithChildren): {
  fields: NurbsFieldInfo[];
  values: NumArray[][];
} {
  const { queries } = useDataContext();
  const { patches, getError } = useNurbsPatches(group);

  const fieldGroups = useSuspenseQueries({
    queries: patches.flatMap(({ children }) =>
      children
        .filter((child) => child.name === FIELDS_GROUP && isGroup(child))
        .map(({ path }) => queries.entity(path)),
    ),
    combine: getData,
  });

  const datasets = useMemo(() => {
    const perPatch = patches.map((patch) => {
      const fieldsGroup = fieldGroups.find(
        ({ path }) => path === `${patch.path}/${FIELDS_GROUP}`,
      );
      const points = patch.children.find(
        ({ name }) => name === 'control_points',
      );
      const dims =
        points && isDataset(points) && hasArrayShape(points)
          ? points.shape.dims
          : [];
      try {
        return getNurbsFieldDatasets(fieldsGroup, [dims[0], dims[1]]);
      } catch (error) {
        throw error instanceof Error ? getError(patch, error.message) : error;
      }
    });

    const names = [
      ...new Set(perPatch.flatMap((arr) => arr.map(({ name }) => name))),
    ];
    return perPatch.map((arr, p) =>
      names.map((name) => {
        const dataset = arr.find((d) => d.name === name);
        if (!dataset) {
          throw getError(
            patches[p],
            `Expected field "${name}" in "${FIELDS_GROUP}" group`,
          );
        }
        return dataset;
      }),
    );
  }, [patches, fieldGroups, getError]);

  const attrValues = useSuspenseQueries({
    queries: (datasets[0] ?? []).map((dataset) => queries.attrValues(dataset)),
    combine: getData,
  });
  const values = useSuspenseQueries({
    queries: datasets.flat().map((dataset) => queries.value(dataset)),
    combine: getData,
  });

  return useMemo(() => {
    const fields = (datasets[0] ?? []).map(({ name }, f): NurbsFieldInfo => {
      const { long_name: longName, units } = attrValues[f];
      return {
        name,
        label: typeof longName === 'string' && longName ? longName : name,
        unit: typeof units === 'string' && units ? units : undefined,
      };
    });
    const count = fields.length;
    return {
      fields,
      values: patches.map((_, p) =>
        values
          .slice(p * count, (p + 1) * count)
          .map((val) => toNumArray(val as ArrayValue<NumericType>)),
      ),
    };
  }, [datasets, attrValues, values, patches]);
}
