import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Color, SRGBColorSpace } from 'three';

import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import { REDRAW } from '../snapshot/utils';
import { getSegmentCounts } from './nurbs';
import styles from './NurbsVis.module.css';
import { getCached, getPixelsPerUnit, type NurbsLineProps } from './utils';
import { type GpuView, NurbsGpuRenderer } from './webgpuLine';

interface Props extends NurbsLineProps {
  device: GPUDevice;
  origin: [number, number]; // e.g. centre of control points, to keep precision in `f32`
}

/* Evaluated and drawn with WebGPU, in a canvas over the WebGL one */
function NurbsGpuLine(props: Props) {
  const { device, curve, spans, origin, color, width } = props;
  const { canvasArea, abscissaScale, ordinateScale } = useVisCanvasContext();
  const invalidate = useThree((state) => state.invalidate);

  // Above the grid, below the SVG overlay (cf. `VisCanvas.module.css`)
  const [canvas] = useState(() => {
    const elem = document.createElement('canvas');
    elem.className = styles.gpuCanvas;
    return elem;
  });

  useLayoutEffect(() => {
    canvasArea.append(canvas);
    return () => canvas.remove();
  }, [canvasArea, canvas]);

  const rendererRef = useRef<NurbsGpuRenderer>(undefined);
  const countsRef = useRef<{ key: number[]; value: Uint32Array }>(undefined);
  useEffect(() => {
    const renderer = new NurbsGpuRenderer(device, canvas, curve, spans, origin);
    rendererRef.current = renderer;
    countsRef.current = undefined;
    Object.assign(canvas, { [REDRAW]: () => renderer.redraw() }); // for snapshots
    invalidate();

    return () => {
      rendererRef.current = undefined;
      renderer.dispose();
    };
  }, [device, canvas, curve, spans, origin, invalidate]);

  const rgba = useMemo(() => {
    if (color === 'transparent') {
      return undefined; // before CSS colours are read
    }
    const { r, g, b } = new Color(color).getRGB(new Color(), SRGBColorSpace);
    const opaque: GpuView['color'] = [r, g, b, 1];
    return opaque;
  }, [color]);

  useEffect(() => invalidate(), [rgba, width, invalidate]);

  // Drawn with each frame of the WebGL canvas, so as to follow zoom and pan in sync
  useFrame(({ camera, size, viewport }) => {
    const renderer = rendererRef.current;
    const { dpr } = viewport;
    const [w, h] = [size.width, size.height].map((px) => Math.round(px * dpr));
    if (!renderer || !rgba || w === 0 || h === 0) {
      return;
    }

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const pixelsPerUnit = getPixelsPerUnit(
      camera,
      abscissaScale,
      ordinateScale,
      dpr,
    );
    renderer.setSegmentCounts(
      getCached(countsRef, pixelsPerUnit, () =>
        getSegmentCounts(curve, spans, pixelsPerUnit),
      ),
    );

    void renderer.draw({
      scale: pixelsPerUnit,
      offset: [
        ((abscissaScale(origin[0]) - camera.position.x) / camera.scale.x) * dpr,
        ((ordinateScale(origin[1]) - camera.position.y) / camera.scale.y) * dpr,
      ],
      size: [w, h],
      width: width * dpr,
      color: rgba,
    });
  });

  return null;
}

export default NurbsGpuLine;
