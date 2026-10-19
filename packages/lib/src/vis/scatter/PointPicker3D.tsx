import { useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Matrix4, type Vector3Tuple } from 'three';

import { findProjectedPoint } from './utils';

const MIN_PICK_RADIUS = 4; // CSS pixels

export interface PickedPoint {
  index: number;
  left: number; // CSS pixels in the canvas
  top: number;
}

interface Props {
  positions: Float32Array; // in the unit cube
  sizes: Float32Array;
  sizeScale: number;
  boxSize: Vector3Tuple;
  onPick: (picked: PickedPoint | undefined) => void;
}

/**
 * Report the frontmost point under the cursor, projecting the points at most once per animation
 * frame while the pointer moves over the canvas (not while dragging the view).
 */
function PointPicker3D(props: Props) {
  const { positions, sizes, sizeScale, boxSize, onPick } = props;
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);

  const paramsRef = useRef({ positions, sizes, sizeScale, boxSize, onPick });
  paramsRef.current = { positions, sizes, sizeScale, boxSize, onPick };

  useEffect(() => {
    let frame: number | undefined;
    let last: PointerEvent | undefined;

    function pick() {
      frame = undefined;
      const evt = last;
      if (!evt) {
        return;
      }
      const params = paramsRef.current;
      const [w, h, d] = params.boxSize;
      const mvp = new Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(
          new Matrix4()
            .makeScale(Math.max(w, 1e-6), Math.max(h, 1e-6), Math.max(d, 1e-6))
            .setPosition(-w / 2, -h / 2, 0),
        );
      const index = findProjectedPoint(
        params.positions,
        mvp.elements,
        [evt.offsetX, evt.offsetY],
        [canvas.clientWidth, canvas.clientHeight],
        { ...params, minRadius: MIN_PICK_RADIUS },
      );
      params.onPick(
        index === undefined
          ? undefined
          : { index, left: evt.offsetX, top: evt.offsetY },
      );
    }

    function handleMove(evt: PointerEvent) {
      if (evt.buttons !== 0) {
        last = undefined;
        paramsRef.current.onPick(undefined);
        return;
      }
      last = evt;
      if (frame === undefined) {
        frame = requestAnimationFrame(pick);
      }
    }

    function handleLeave() {
      last = undefined;
      paramsRef.current.onPick(undefined);
    }

    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('pointerleave', handleLeave);
    canvas.addEventListener('wheel', handleLeave, { passive: true });
    return () => {
      canvas.removeEventListener('pointermove', handleMove);
      canvas.removeEventListener('pointerleave', handleLeave);
      canvas.removeEventListener('wheel', handleLeave);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, [camera, canvas]);

  return null;
}

export default PointPicker3D;
