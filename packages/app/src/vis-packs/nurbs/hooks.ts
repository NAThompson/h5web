import {
  getNurbsError,
  getNurbsSurfaceError,
  type NurbsCurve,
  type NurbsSurface,
} from '@h5web/lib';
import {
  assertGroup,
  assertGroupWithChildren,
  isGroup,
} from '@h5web/shared/guards';
import {
  type ArrayValue,
  type GroupWithChildren,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { useSuspenseQueries } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { useAttrValue, useValues } from '../../hooks';
import { useDataContext } from '../../providers/DataProvider';
import { findScalarStrAttr, findSingleNumAttr } from '../../utils';
import { toNumArray } from '../core/utils';
import {
  getNurbsDatasets,
  getNurbsSurfaceDatasets,
  isNurbsMultiPatchGroup,
} from './utils';

/* `H5WEB_geometry = "bspline"`: no weights */
function useIsBspline(group: GroupWithChildren): boolean {
  const attr = findScalarStrAttr(group, 'H5WEB_geometry');
  return useAttrValue(group, attr)?.toLowerCase() === 'bspline';
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

/*
 * Fetch control points, weights, knots and degrees of a NURBS surface group, or of each patch
 * group of a multi-patch group (cf. `isNurbsMultiPatchGroup`), and check them
 */
export function useNurbsSurfaces(group: GroupWithChildren): NurbsSurface[] {
  const { queries } = useDataContext();
  const isBspline = useIsBspline(group);
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

  // Errors name the patch, if any
  const getError = useCallback(
    (patch: GroupWithChildren, message: string) =>
      new Error(isMultiPatch ? `Patch ${patch.name}: ${message}` : message),
    [isMultiPatch],
  );

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
