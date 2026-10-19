import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';

/* Writes the depth of the surface alone, first: hides what's behind the WebGPU surface */
interface Props {
  positions: Float32Array; // cf. `buildParamSurfaceBuffers`
  index: Uint32Array;
}

function NurbsDepthMesh(props: Props) {
  const { positions, index } = props;
  const geometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    geom.setIndex(new BufferAttribute(index, 1));
    return geom;
  }, [positions, index]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} renderOrder={-1}>
      <meshBasicMaterial
        colorWrite={false}
        side={DoubleSide}
        polygonOffset // keep lines on the surface visible
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

export default NurbsDepthMesh;
