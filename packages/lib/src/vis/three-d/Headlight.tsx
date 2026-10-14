import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { type DirectionalLight, Vector3 } from 'three';

/* With a headlight, the ambient light of `R3FCanvas` alone (i.e. a share of 1/PI) gives
 * stronger contrast between faces, which helps perceive the shape of arbitrary geometry. */
const HEADLIGHT_INTENSITY = Math.PI - 1;

/* Directional light that follows the camera, from slightly above and to the left, so the faces
 * the user is looking at keep the colours of the colour map, whatever the view angle. */
function Headlight() {
  const lightRef = useRef<DirectionalLight>(null);
  const offset = useMemo(() => new Vector3(), []);

  useFrame(({ camera }) => {
    const light = lightRef.current;
    if (light) {
      // From above and to the left of the camera, in view space, ~35 degrees off the view axis
      const distance = camera.position.length();
      offset
        .set(-0.4 * distance, 0.55 * distance, 0)
        .applyQuaternion(camera.quaternion);
      light.position.copy(camera.position).add(offset);
      light.target.position.set(0, 0, 0);
      light.target.updateMatrixWorld();
    }
  });

  return <directionalLight ref={lightRef} intensity={HEADLIGHT_INTENSITY} />;
}

export default Headlight;
