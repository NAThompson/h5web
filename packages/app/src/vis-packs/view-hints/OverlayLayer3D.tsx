import { SurfaceOverlay } from '@h5web/lib';

import { type OverlayShapes } from './overlays';

interface Props {
  shapes: OverlayShapes;
}

/* Overlays on a 3D surface: points at the height of their value, or on the surface.
 * TODO: parametric surfaces (CF `coordinates = "x y z"`) - map overlay rows given along the
 * field's dimension scales (e.g. [alpha, theta]) to x, y, z by bilinear interpolation of the
 * coordinate grids, and draw them as children of `ParamSurfaceVis`. */
function OverlayLayer3D(props: Props) {
  const { shapes } = props;

  return (
    <>
      {shapes.lines.map(({ x, y, stroke, width }, i) => (
        <SurfaceOverlay
          // eslint-disable-next-line react/no-array-index-key
          key={`line${i}`}
          x={x}
          y={y}
          color={stroke}
          lineWidth={width}
        />
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
