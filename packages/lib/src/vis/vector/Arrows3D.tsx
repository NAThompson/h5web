import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  type InstancedMesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Props {
  matrices: Float32Array; // instance matrices of the unit arrow
  colors: Float32Array; // linear RGB of each arrow
  count: number;
}

/* Unit arrow along +y, from y = -0.5 to 0.5 */
function createArrowGeometry(): BufferGeometry {
  const shaft = new CylinderGeometry(0.035, 0.035, 0.7, 8).translate(
    0,
    -0.15,
    0,
  );
  const head = new ConeGeometry(0.11, 0.3, 12).translate(0, 0.35, 0);
  const merged = mergeGeometries([shaft, head]);
  shaft.dispose();
  head.dispose();
  return merged;
}

/* Instanced 3D arrows (shaft and cone), lit */
function Arrows3D(props: Props) {
  const { matrices, colors, count } = props;
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const geometry = useMemo(createArrowGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    mesh.instanceMatrix.array.set(matrices);
    mesh.instanceMatrix.needsUpdate = true;
    const color = new Color();
    for (let i = 0; i < count; i += 1) {
      mesh.setColorAt(i, color.fromArray(colors, i * 3));
    }
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
    invalidate();
  }, [matrices, colors, count, invalidate]);

  return (
    <instancedMesh
      key={count} // instance count is fixed at creation
      ref={ref}
      args={[geometry, undefined, count]}
    >
      <meshLambertMaterial />
    </instancedMesh>
  );
}

export default Arrows3D;
