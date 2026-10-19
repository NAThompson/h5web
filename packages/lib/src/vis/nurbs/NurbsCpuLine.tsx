import { useThree } from '@react-three/fiber';
import { useMemo } from 'react';

import { useCameraState } from '../hooks';
import Line from '../line/Line';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { getSegmentCounts, sampleNurbs } from './nurbs';
import { getPixelsPerUnit, type NurbsLineProps } from './utils';

/* Evaluated on the CPU, finely enough for the current zoom level */
function NurbsCpuLine(props: NurbsLineProps) {
  const { curve, spans, color, width } = props;
  const { abscissaScale, ordinateScale } = useVisCanvasContext();
  const dpr = useThree((state) => state.viewport.dpr);

  const counts = useCameraState(
    (camera) =>
      getSegmentCounts(
        curve,
        spans,
        getPixelsPerUnit(camera, abscissaScale, ordinateScale, dpr),
      ),
    [curve, spans, abscissaScale, ordinateScale, dpr],
    (prev, next) => prev.every((n, i) => n === next[i]),
  );

  const [abscissas, ordinates] = useMemo(() => {
    const samples = sampleNurbs(curve, spans, counts);
    return [0, 1].map((d) => samples.filter((_, i) => i % 2 === d));
  }, [curve, spans, counts]);

  return (
    <Line
      abscissas={abscissas}
      ordinates={ordinates}
      color={color}
      width={width}
    />
  );
}

export default NurbsCpuLine;
