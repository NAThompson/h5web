import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry } from 'three';

import { type NurbsSurface } from './nurbs';

const DASH_SIZE = 0.015; // world units (longest side of box: 1)
const GAP_SIZE = 0.01;
const POINT_SIZE = 5; // CSS pixels

interface Props {
  surface: Pick<NurbsSurface, 'shape' | 'points'>; // in world coordinates; curve: `[n, 1]`
  color: string;
}

/* Control points, joined by dashed lines along `u` and `v` */
function NurbsControlNet(props: Props) {
  const { surface, color } = props;
  const { shape, points } = surface;

  const [lineGeometry, pointGeometry] = useMemo(() => {
    const [nu, nv] = shape;
    const ends: number[] = [];
    for (let i = 0; i < nu; i += 1) {
      for (let j = 0; j < nv; j += 1) {
        const index = i * nv + j;
        if (i + 1 < nu) {
          ends.push(index, index + nv);
        }
        if (j + 1 < nv) {
          ends.push(index, index + 1);
        }
      }
    }

    // Separate segments, each dashed from its start
    const positions = new Float32Array(ends.length * 3);
    const distances = new Float32Array(ends.length);
    ends.forEach((index, k) => {
      positions.set(
        [0, 1, 2].map((d) => points[index * 3 + d]),
        k * 3,
      );
      if (k % 2 === 1) {
        distances[k] = Math.hypot(
          ...[0, 1, 2].map(
            (d) => positions[k * 3 + d] - positions[k * 3 + d - 3],
          ),
        );
      }
    });

    const lines = new BufferGeometry();
    lines.setAttribute('position', new BufferAttribute(positions, 3));
    lines.setAttribute('lineDistance', new BufferAttribute(distances, 1));

    const dots = new BufferGeometry();
    dots.setAttribute(
      'position',
      new BufferAttribute(Float32Array.from(points), 3),
    );
    return [lines, dots];
  }, [shape, points]);

  useEffect(
    () => () => {
      lineGeometry.dispose();
      pointGeometry.dispose();
    },
    [lineGeometry, pointGeometry],
  );

  return (
    <>
      <lineSegments geometry={lineGeometry}>
        <lineDashedMaterial
          color={color}
          dashSize={DASH_SIZE}
          gapSize={GAP_SIZE}
        />
      </lineSegments>
      <points geometry={pointGeometry}>
        <pointsMaterial
          color={color}
          size={POINT_SIZE}
          sizeAttenuation={false}
        />
      </points>
    </>
  );
}

export default NurbsControlNet;
