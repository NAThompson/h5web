import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, Vector3 } from 'three';

import { REDRAW } from '../snapshot/utils';
import { AMBIENT_SHARE, LIGHT_POSITION } from '../three-d/Vis3DLayout';
import {
  getSurfaceSampleCounts,
  type KnotSpan,
  type NurbsSurface,
} from './nurbs';
import styles from './NurbsVis.module.css';
import { projectControlPoints } from './utils';
import { NurbsSurfaceGpuRenderer, type SurfaceGpuView } from './webgpuSurface';

const KNOT_LINE_WIDTH = 1.5; // CSS pixels
const { x, y, z } = new Vector3(...LIGHT_POSITION).normalize();
const LIGHT: SurfaceGpuView['light'] = [x, y, z, AMBIENT_SHARE]; // as `Vis3DLayout`

interface Props {
  device: GPUDevice;
  surface: NurbsSurface; // in world coordinates
  spans: [KnotSpan[], KnotSpan[]];
  colorLut: Float32Array; // cf. `getLinearColorLut`
  zRange: [number, number]; // world heights of the ends of the colour map
  showKnotLines: boolean;
}

/*
 * Evaluated and drawn with WebGPU, in a canvas under the WebGL one (transparent but for axes,
 * control net, etc.), with the WebGL camera. Content of the WebGL canvas is hidden behind the
 * surface by a coarse copy of it that only writes depth (cf. `NurbsSurfaceVis`).
 */
function NurbsGpuSurface(props: Props) {
  const { device, surface, spans, colorLut, zRange, showKnotLines } = props;
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const [canvas] = useState(() => {
    const elem = document.createElement('canvas');
    elem.className = styles.gpuSurfaceCanvas;
    return elem;
  });

  useLayoutEffect(() => {
    const webgl = gl.domElement;
    const { position } = webgl.style;
    webgl.before(canvas);
    webgl.style.position = 'relative'; // positioned too, so drawn over the WebGPU canvas
    return () => {
      canvas.remove();
      webgl.style.position = position;
    };
  }, [gl, canvas]);

  const lutRef = useRef(colorLut);
  lutRef.current = colorLut;

  const rendererRef = useRef<NurbsSurfaceGpuRenderer>(undefined);
  useEffect(() => {
    const renderer = new NurbsSurfaceGpuRenderer(
      device,
      canvas,
      surface,
      spans,
    );
    renderer.setColorLut(lutRef.current);
    rendererRef.current = renderer;
    Object.assign(canvas, { [REDRAW]: () => renderer.redraw() }); // for snapshots
    invalidate();

    return () => {
      rendererRef.current = undefined;
      renderer.dispose();
    };
  }, [device, canvas, surface, spans, invalidate]);

  useEffect(() => {
    rendererRef.current?.setColorLut(colorLut);
    invalidate();
  }, [colorLut, invalidate]);

  useEffect(() => invalidate(), [zRange, showKnotLines, invalidate]);

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

    // Steps per knot span from the size of the surface on screen
    const near = 'near' in camera ? camera.near : 1e-3;
    const { points, weights } = projectControlPoints(
      surface,
      viewProjection,
      [w, h],
      near,
    );
    renderer.setSampleCounts(
      getSurfaceSampleCounts(surface, spans, points, weights, 2),
    );

    void renderer.draw({
      viewProjection: viewProjection.elements,
      camera: camera.position.toArray(),
      light: LIGHT,
      zRange,
      knotLines: showKnotLines ? KNOT_LINE_WIDTH * dpr : 0,
      size: [w, h],
    });
  });

  return null;
}

export default NurbsGpuSurface;
