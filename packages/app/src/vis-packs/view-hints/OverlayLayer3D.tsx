import { SurfaceOverlay } from '@h5web/lib';

import { type OverlayShapes } from './overlays';

interface Props {
  shapes: OverlayShapes;
}

/* Overlays on a 3D surface: points at the height of their value, or on the surface */
function OverlayLayer3D(props: Props) {
  const { shapes } = props;

  return (
    <>
      {shapes.lines.map(({ x, y, stroke }, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <SurfaceOverlay key={`line${i}`} x={x} y={y} color={stroke} />
      ))}
      {shapes.points.map(({ x, y, z, values, fill, size }, i) => (
        <SurfaceOverlay
          // eslint-disable-next-line react/no-array-index-key
          key={`points${i}`}
          x={x}
          y={y}
          z={z}
          values={values}
          color={fill}
          showLine={false}
          showPoints
          pointSize={2 * size + 3}
        />
      ))}
    </>
  );
}

export default OverlayLayer3D;
