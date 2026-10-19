import {
  type ColorMap,
  getNurbsSurfaceError,
  type NurbsSurface,
  NurbsSurfaceVis,
} from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useAttrValue, useValues } from '../../hooks';
import { findSingleNumAttr } from '../../utils';
import { toNumArray } from '../core/utils';
import { getNurbsSurfaceDatasets } from './utils';

interface Props {
  group: GroupWithChildren;
  className: string;
  colorMap: ColorMap;
  invertColorMap: boolean;
  showControlNet: boolean;
  showKnotLines: boolean;
  showAxes: boolean;
  showGrid: boolean;
}

/* Fetch control points, weights, knots and degrees of a NURBS surface group, and check them */
function NurbsSurfaceFetcher(props: Props) {
  const { group, ...visProps } = props;

  const { points, weights, knotsU, knotsV } = getNurbsSurfaceDatasets(group);

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

  return <NurbsSurfaceVis surface={surface} title={group.name} {...visProps} />;
}

export default NurbsSurfaceFetcher;
