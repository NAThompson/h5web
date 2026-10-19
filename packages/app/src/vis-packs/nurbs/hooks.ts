import {
  getNurbsError,
  getNurbsSurfaceError,
  type NurbsCurve,
  type NurbsSurface,
} from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useAttrValue, useValues } from '../../hooks';
import { findScalarStrAttr, findSingleNumAttr } from '../../utils';
import { toNumArray } from '../core/utils';
import { getNurbsDatasets, getNurbsSurfaceDatasets } from './utils';

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

/* Fetch control points, weights, knots and degrees of a NURBS surface group, and check them */
export function useNurbsSurface(group: GroupWithChildren): NurbsSurface {
  const { points, weights, knotsU, knotsV } = getNurbsSurfaceDatasets(
    group,
    useIsBspline(group),
  );

  // `degree_u` and `degree_v`, or `degree` for both
  const degreeAttr = findSingleNumAttr(group, 'degree');
  const degreeU = useAttrValue(
    group,
    findSingleNumAttr(group, 'degree_u') ?? degreeAttr,
  );
  const degreeV = useAttrValue(
    group,
    findSingleNumAttr(group, 'degree_v') ?? degreeAttr,
  );
  if (degreeU === undefined || degreeV === undefined) {
    throw new Error(
      'Expected numeric "degree_u" and "degree_v" (or "degree") attributes on group',
    );
  }

  const values = useValues({
    points,
    knotsU,
    knotsV,
    ...(weights && { weights }),
  });

  const surface = useMemo((): NurbsSurface => {
    const [nu, nv] = points.shape.dims;
    return {
      degrees: [degreeU, degreeV].map((val) =>
        Number(typeof val === 'object' ? val[0] : val),
      ) as [number, number],
      shape: [nu, nv],
      points: toNumArray(values.points),
      weights: values.weights
        ? toNumArray(values.weights)
        : new Float64Array(nu * nv).fill(1),
      knots: [toNumArray(values.knotsU), toNumArray(values.knotsV)],
    };
  }, [degreeU, degreeV, points, values]);

  const error = getNurbsSurfaceError(surface);
  if (error) {
    throw new Error(`Invalid NURBS surface: ${error}`);
  }
  return surface;
}
