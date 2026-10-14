import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { type DirectionalLight, Vector3 } from 'three';

const OFFSET = new Vector3(-0.6, 0.8, 1); // above and to the left of the camera, in camera space

/* Directional light that follows the camera, so surfaces are lit from wherever they are seen */
function Headlight(props: { intensity?: number }) {
  const { intensity = 2.4 } = props;
  const lightRef = useRef<DirectionalLight>(null);

  useFrame(({ camera }) => {
    lightRef.current?.position.copy(OFFSET).applyMatrix4(camera.matrixWorld);
  });

  return <directionalLight ref={lightRef} intensity={intensity} />;
}

export default Headlight;
