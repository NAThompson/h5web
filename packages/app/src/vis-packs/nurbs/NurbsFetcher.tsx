import {
  Curve3DVis,
  getKnotSpans,
  getSpanSteps,
  NurbsVis,
  sampleNurbs,
} from '@h5web/lib';
import { type GroupWithChildren } from '@h5web/shared/hdf5-models';
import { useMemo } from 'react';

import { useNurbsCurve } from './hooks';

const SEGMENTS_PER_SPAN_3D = 64; // 3D curves are sampled once, on the CPU

interface Props {
  group: GroupWithChildren;
  className: string;
  showControlPolygon: boolean;
  showGrid: boolean;
}

/* NURBS curve of a group: 2D, or 3D with `Curve3DVis` */
function NurbsFetcher(props: Props) {
  const { group, className, showControlPolygon, showGrid } = props;

  const curve = useNurbsCurve(group);

  const samples3D = useMemo(() => {
    if (curve.dims !== 3) {
      return undefined;
    }
    const spans = getKnotSpans(curve);
    const counts = new Uint32Array(spans.length).fill(SEGMENTS_PER_SPAN_3D);
    const samples = sampleNurbs(curve, spans, counts);
    return {
      coords: [0, 1, 2].map((d) => samples.filter((_, i) => i % 3 === d)),
      params: getSpanSteps(spans, counts).params, // coloured by `u`
    };
  }, [curve]);

  if (samples3D) {
    const [x, y, z] = samples3D.coords;
    return (
      <Curve3DVis
        className={className}
        title={group.name}
        x={x}
        y={y}
        z={z}
        values={samples3D.params}
        domain={[
          curve.knots[curve.degree],
          curve.knots[curve.knots.length - curve.degree - 1],
        ]}
        colorBarLabel="u"
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
