import {
  Curve3DVis,
  getKnotSpans,
  getNurbsError,
  type NurbsCurve,
  NurbsVis,
  sampleNurbs,
} from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useAttrValue, useValues } from '../../hooks';
import { findSingleNumAttr } from '../../utils';
import { toNumArray } from '../core/utils';
import { getNurbsDatasets } from './utils';

const SEGMENTS_PER_SPAN_3D = 64; // 3D curves are sampled once, on the CPU

interface Props {
  group: GroupWithChildren;
  className: string;
  showControlPolygon: boolean;
  showGrid: boolean;
}

/* Fetch control points, weights, knots and degree of a NURBS group, and check them */
function NurbsFetcher(props: Props) {
  const { group, className, showControlPolygon, showGrid } = props;

  const { points, weights, knots } = getNurbsDatasets(group);
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

  const samples3D = useMemo(() => {
    if (curve.dims !== 3) {
      return undefined;
    }
    const spans = getKnotSpans(curve);
    const samples = sampleNurbs(
      curve,
      spans,
      new Uint32Array(spans.length).fill(SEGMENTS_PER_SPAN_3D),
    );
    return [0, 1, 2].map((d) => samples.filter((_, i) => i % 3 === d));
  }, [curve]);

  if (samples3D) {
    const [x, y, z] = samples3D;
    return (
      <Curve3DVis
        className={className}
        title={group.name}
        x={x}
        y={y}
        z={z}
        xLabel="x"
        yLabel="y"
        showGrid={showGrid}
      />
    );
  }

  return (
    <NurbsVis
      className={className}
      curve={curve}
      title={group.name}
      abscissaLabel="x"
      ordinateLabel="y"
      showGrid={showGrid}
      showControlPolygon={showControlPolygon}
    />
  );
}

export default NurbsFetcher;
