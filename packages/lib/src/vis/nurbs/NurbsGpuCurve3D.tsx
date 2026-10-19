import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Matrix4 } from 'three';

import { REDRAW } from '../snapshot/utils';
import { getSegmentCounts, type KnotSpan, type NurbsCurve } from './nurbs';
import styles from './NurbsVis.module.css';
import { getCached, projectControlPoints } from './utils';
import { NurbsCurve3DGpuRenderer } from './webgpuCurve3D';

interface Props {
  device: GPUDevice;
  curve: NurbsCurve; // in world coordinates
  spans: KnotSpan[];
  colorLut: Float32Array; // cf. `getLinearColorLut`
  uRange: [number, number]; // parameters at the ends of the colour map
  width: number; // CSS pixels
}

/*
 * Evaluated and drawn with WebGPU, in a canvas over the WebGL one (axes, control polygon),
 * with the WebGL camera (cf. `NurbsGpuSurface`).
 */
function NurbsGpuCurve3D(props: Props) {
  const { device, curve, spans, colorLut, uRange, width } = props;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const [canvas] = useState(() => {
    const elem = document.createElement('canvas');
    elem.className = styles.gpuSurfaceCanvas;
    return elem;
  });

  useLayoutEffect(() => {
    gl.domElement.after(canvas); // positioned, so drawn over the WebGL canvas
    return () => canvas.remove();
  }, [gl, canvas]);

  const lutRef = useRef(colorLut);
  lutRef.current = colorLut;

  const rendererRef = useRef<NurbsCurve3DGpuRenderer>(undefined);
  const countsRef = useRef<{ key: number[]; value: Uint32Array }>(undefined);
  useEffect(() => {
    const renderer = new NurbsCurve3DGpuRenderer(device, canvas, curve, spans);
    renderer.setColorLut(lutRef.current);
    rendererRef.current = renderer;
    countsRef.current = undefined;
    Object.assign(canvas, { [REDRAW]: () => renderer.redraw() }); // for snapshots
    invalidate();

    return () => {
      rendererRef.current = undefined;
      renderer.dispose();
    };
  }, [device, canvas, curve, spans, invalidate]);

  useEffect(() => {
    rendererRef.current?.setColorLut(colorLut);
    invalidate();
  }, [colorLut, invalidate]);

  useEffect(() => invalidate(), [uRange, width, invalidate]);

  const viewProjection = useMemo(() => new Matrix4(), []);

  // Drawn with each frame of the WebGL canvas, so as to follow the orbit controls in sync
  useFrame(({ camera, size, viewport }) => {
    const renderer = rendererRef.current;
    const { dpr } = viewport;
    const [w, h] = [size.width, size.height].map((px) => Math.round(px * dpr));
    if (!renderer || w === 0 || h === 0) {
      return;
    }

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    camera.updateMatrixWorld();
    viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );

    // Segments per knot span from the length and turning of the curve on screen (if changed)
    const near = 'near' in camera ? camera.near : 1e-3;
    renderer.setSegmentCounts(
      getCached(countsRef, [...viewProjection.elements, w, h], () => {
        const { points, weights } = projectControlPoints(
          curve,
          viewProjection,
          [w, h],
          near,
        );
        return getSegmentCounts(
          { ...curve, dims: 2, points, weights },
          spans,
          [1, 1],
        );
      }),
    );

    void renderer.draw({
      viewProjection: viewProjection.elements,
      uRange,
      width: width * dpr,
      size: [w, h],
    });
  });

  return null;
}

export default NurbsGpuCurve3D;
