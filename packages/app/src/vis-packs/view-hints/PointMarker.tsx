import { type Marker } from './models';

const MARKER_WIDTH = 2; // px, stroke of crosses and hollow circles
const HALO_WIDTH = 3; // px added around the strokes

interface Props {
  marker: Marker | undefined; // default: dot
  x: number;
  y: number;
  size: number; // radius
  color: string;
  ring?: string; // halo
  inner?: string; // inner outline of dots
}

/* Marker of a point, in SVG: dot, cross or hollow circle, with an optional halo */
function PointMarker(props: Props) {
  const { marker = 'dot', x, y, size, color, ring, inner } = props;
  if (marker === 'dot') {
    return (
      <>
        {ring && <circle cx={x} cy={y} r={size + 2.5} fill={ring} />}
        <circle
          cx={x}
          cy={y}
          r={size}
          fill={color}
          stroke={inner}
          strokeWidth={1.5}
        />
      </>
    );
  }

  const d = size * Math.SQRT1_2; // arms of the cross along the diagonals of the dot
  function draw(stroke: string, width: number) {
    return marker === 'x' ? (
      <path
        d={`M${x - d},${y - d}L${x + d},${y + d}M${x - d},${y + d}L${x + d},${y - d}`}
        stroke={stroke}
        strokeWidth={width}
        strokeLinecap="round"
      />
    ) : (
      <circle
        cx={x}
        cy={y}
        r={size}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
      />
    );
  }

  return (
    <>
      {ring && draw(ring, MARKER_WIDTH + HALO_WIDTH)}
      {draw(color, MARKER_WIDTH)}
    </>
  );
}

export default PointMarker;
