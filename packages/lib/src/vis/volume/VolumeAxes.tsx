import { useMemo } from 'react';
import { Color, type Vector3Tuple } from 'three';

import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import { type AxisValues } from './models';
import { getAxisDomain } from './utils';

interface Props {
  labels: [x?: string, y?: string, z?: string] | undefined;
  visible: boolean;
  shape: number[]; // `[depth, rows, cols]`
  boxSize: Vector3Tuple;
  axisValues: AxisValues;
  background: string; // of the canvas
}

const ON_DARK = { tickLabels: 'white', axisLabels: 'white', ticks: '#999' };

/* White text on a dark canvas; else the page's theme */
function getColors(background: string): typeof ON_DARK | undefined {
  const { r, g, b } = new Color(background);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? ON_DARK : undefined;
}

/* Ticks and titles on the edges of the volume's box, in its axes' coordinates, when it has labels */
function VolumeAxes(props: Props) {
  const { labels, visible, shape, boxSize, axisValues, background } = props;
  const [depth, rows, cols] = shape;

  const configs = useMemo(
    (): Axis3DConfig[] | undefined =>
      labels?.some((label) => label !== undefined)
        ? [cols, rows, depth].map((count, axis) => ({
            domain: getAxisDomain(axisValues[axis], count),
            isIndexAxis: axisValues[axis] === undefined,
            label: labels[axis],
          }))
        : undefined,
    [labels, axisValues, cols, rows, depth],
  );

  if (!configs || !visible) {
    return null;
  }

  // `Axes3D` spans z from 0 to the depth of the box, which is centred on the origin
  return (
    <group position={[0, 0, -boxSize[2] / 2]}>
      <Axes3D
        boxSize={boxSize}
        xConfig={configs[0]}
        yConfig={configs[1]}
        zConfig={configs[2]}
        showGrid={false}
        colors={getColors(background)}
      />
    </group>
  );
}

export default VolumeAxes;
