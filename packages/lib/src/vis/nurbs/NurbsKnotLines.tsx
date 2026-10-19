import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

/* Rows and columns of the sampled grid at the knots */
interface Props {
  positions: Float32Array; // of the grid (cf. `sampleNurbsSurface`)
  counts: [Uint32Array, Uint32Array]; // steps of each span along `u` and `v`
}

function NurbsKnotLines(props: Props) {
  const { positions, counts } = props;
  const geometry = useMemo(() => {
    const [knotRows, knotCols] = counts.map((arr) => {
      const steps = [0];
      for (const n of arr) {
        steps.push(steps[steps.length - 1] + n);
      }
      return steps;
    });
    const rows = knotRows[knotRows.length - 1] + 1;
    const cols = knotCols[knotCols.length - 1] + 1;

    const ends: number[] = [];
    for (const r of knotRows) {
      for (let c = 0; c + 1 < cols; c += 1) {
        ends.push(r * cols + c, r * cols + c + 1);
      }
    }
    for (const c of knotCols) {
      for (let r = 0; r + 1 < rows; r += 1) {
        ends.push(r * cols + c, (r + 1) * cols + c);
      }
    }

    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(ends);
    return geom;
  }, [positions, counts]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="black" transparent opacity={0.85} />
    </lineSegments>
  );
}

export default NurbsKnotLines;
