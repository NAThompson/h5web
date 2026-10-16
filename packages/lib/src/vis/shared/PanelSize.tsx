import { useThree } from '@react-three/fiber';
import { useLayoutEffect } from 'react';
import { type OrthographicCamera } from 'three';

interface Props {
  width: number;
  height: number;
  camera: OrthographicCamera;
}

/* Keep the size of a panel's R3F state and its camera's frustum in sync with its element (as R3F
 * does for its canvas) */
function PanelSize(props: Props) {
  const { width, height, camera } = props;
  const set = useThree((state) => state.set);
  const invalidate = useThree((state) => state.invalidate);

  useLayoutEffect(() => {
    Object.assign(camera, {
      left: width / -2,
      right: width / 2,
      top: height / 2,
      bottom: height / -2,
    });
    camera.updateProjectionMatrix();
    set({ size: { width, height, top: 0, left: 0 } });
    invalidate();
  }, [camera, width, height, set, invalidate]);

  return null;
}

export default PanelSize;
