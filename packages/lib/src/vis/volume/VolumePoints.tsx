import { type Domain } from '@h5web/shared/vis-models';
import { useMemo } from 'react';
import { Layers } from 'three';

import { type ColorMap } from '../heatmap/models';
import { type VisScaleType } from '../models';
import { usePointStyle } from '../scatter/hooks';
import PointCloud from '../scatter/PointCloud';
import { type AxisValues, type VolumePointSet } from './models';
import { POINT_DEPTH_LAYER } from './SurfaceDepthPass';
import { getCoordToUnit } from './utils';

interface Props {
  points: VolumePointSet[] | undefined;
  shape: number[];
  boxSize: [number, number, number];
  axisValues: AxisValues;
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
}

// Default layer, and depth pass (cf. `SurfaceDepthPass`)
const LAYERS = new Layers();
LAYERS.enable(POINT_DEPTH_LAYER);

type PointSetProps = Omit<Props, 'points'> & { points: VolumePointSet };

function PointSet(props: PointSetProps) {
  const { points, shape, boxSize, axisValues, ...colorParams } = props;
  const { x, y, z, values, color = 'white', size = 8 } = points;

  const [depth, rows, cols] = shape;
  const positions = useMemo(() => {
    const toUnit = [cols, rows, depth].map((count, axis) =>
      getCoordToUnit(axisValues[axis], count),
    );
    const coords = [x, y, z];
    const count = Math.min(x.length, y.length, z.length);
    return Float32Array.from({ length: count * 3 }, (_, i) =>
      toUnit[i % 3](coords[i % 3][Math.floor(i / 3)]),
    );
  }, [x, y, z, axisValues, cols, rows, depth]);

  const { colors, sizes } = usePointStyle(positions, {
    ...colorParams,
    values,
    color,
    pointSize: size,
  });

  // `PointCloud` spans z from 0 to the depth of the box, which is centred on the origin
  return (
    <group position={[0, 0, -boxSize[2] / 2]}>
      <PointCloud
        positions={positions}
        colors={colors}
        sizes={sizes}
        boxSize={boxSize}
        layers={LAYERS}
        sphereDepth // not cut by planes nor surfaces through their centre
      />
    </group>
  );
}

/* Opaque points in the volume's bounding box, at their coordinates along its axes. They also
 * stop the volume's rays (cf. `SurfaceDepthPass`): translucent points couldn't be composited with
 * a single depth texture. */
function VolumePoints(props: Props) {
  const { points = [], ...pointSetProps } = props;
  return points.map((pointSet, i) => (
    // eslint-disable-next-line react/no-array-index-key
    <PointSet key={i} points={pointSet} {...pointSetProps} />
  ));
}

export default VolumePoints;
