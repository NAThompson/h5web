import { type Domain } from '@h5web/shared/vis-models';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, Vector3 } from 'three';

import { REDRAW } from '../snapshot/utils';
import { AMBIENT_SHARE, LIGHT_POSITION } from '../three-d/Vis3DLayout';
import { NurbsColorBy } from './analysis';
import {
  getSurfaceSampleCounts,
  type KnotSpan,
  type NurbsSurface,
} from './nurbs';
import styles from './NurbsVis.module.css';
import { projectControlPoints } from './utils';
import {
  NurbsSurfaceGpuRenderer,
  type SurfaceGpuView,
  type SurfaceTransform,
} from './webgpuSurface';

const KNOT_LINE_WIDTH = 1.5; // CSS pixels
const { x, y, z } = new Vector3(...LIGHT_POSITION).normalize();
const LIGHT: SurfaceGpuView['light'] = [x, y, z, AMBIENT_SHARE]; // as `Vis3DLayout`

interface Props {
  device: GPUDevice;
  surfaces: NurbsSurface[]; // patches, in data coordinates
  spans: [KnotSpan[], KnotSpan[]][]; // of each patch
  transform: SurfaceTransform; // to world coordinates
  colorLut: Float32Array; // cf. `getLinearColorLut`
  colorBy: NurbsColorBy;
  colorField: number; // index in `fields` of the patches
  valueRange: Domain; // values at the ends of the colour map
  showKnotLines: boolean;
  readCounts: [Uint32Array, Uint32Array][]; // steps per knot span of values read back
  onValues: (
    values: Float64Array,
    areas: Float64Array,
    colorBy: NurbsColorBy,
  ) => void; // not heights
}

/*
 * Evaluated and drawn with WebGPU, in a canvas under the WebGL one (transparent but for axes,
 * control net, etc.), with the WebGL camera. Content of the WebGL canvas is hidden behind the
 * surface by a coarse copy of it that only writes depth (cf. `NurbsSurfaceVis`).
 */
function NurbsGpuSurface(props: Props) {
  const { device, surfaces, spans, transform, colorLut, colorBy, colorField } =
    props;
  const { valueRange, showKnotLines, readCounts, onValues } = props;
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
  const [renderer, setRenderer] = useState<NurbsSurfaceGpuRenderer>();
  useEffect(() => {
    const instance = new NurbsSurfaceGpuRenderer(
      device,
      canvas,
      surfaces,
      spans,
      transform,
    );
    instance.setColorLut(lutRef.current);
    rendererRef.current = instance;
    setRenderer(instance);
    Object.assign(canvas, { [REDRAW]: () => instance.redraw() }); // for snapshots

    return () => {
      rendererRef.current = undefined;
      instance.dispose();
    };
  }, [device, canvas, surfaces, spans, transform]);

  // Evaluated again with the next frame; values but heights read back (e.g. for the domain)
  useEffect(() => {
    if (!renderer) {
      return undefined;
    }
    renderer.setColorBy(colorBy, colorField);
    invalidate();

    const controller = new AbortController();
    if (colorBy !== NurbsColorBy.Height) {
      void (async () => {
        try {
          const { values, areas } = await renderer.readValues(readCounts);
          if (!controller.signal.aborted) {
            onValues(values, areas, colorBy);
          }
        } catch {
          // e.g. device lost
        }
      })();
    }
    return () => controller.abort();
  }, [renderer, colorBy, colorField, readCounts, onValues, invalidate]);

  useEffect(() => {
    rendererRef.current?.setColorLut(colorLut);
    invalidate();
  }, [colorLut, invalidate]);

  useEffect(() => invalidate(), [valueRange, showKnotLines, invalidate]);

  const viewProjection = useMemo(() => new Matrix4(), []);
  const modelViewProjection = useMemo(() => new Matrix4(), []);
  const model = useMemo(() => {
    const { origin, scale, offset } = transform;
    return new Matrix4()
      .makeTranslation(...offset)
      .multiply(new Matrix4().makeScale(...scale))
      .multiply(
        new Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]),
      );
  }, [transform]);

  // Drawn with each frame of the WebGL canvas, so as to follow the orbit controls in sync
  useFrame(({ camera, size, viewport }) => {
    const gpu = rendererRef.current;
    const { dpr } = viewport;
    const [w, h] = [size.width, size.height].map((px) => Math.round(px * dpr));
    if (!gpu || w === 0 || h === 0) {
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

    // Steps per knot span from the size of each patch on screen
    modelViewProjection.multiplyMatrices(viewProjection, model);
    const near = 'near' in camera ? camera.near : 1e-3;
    gpu.setSampleCounts(
      surfaces.map((surface, p) => {
        const { points, weights } = projectControlPoints(
          surface,
          modelViewProjection,
          [w, h],
          near,
        );
        return getSurfaceSampleCounts(surface, spans[p], points, weights, 2);
      }),
    );

    void gpu.draw({
      viewProjection: viewProjection.elements,
      camera: camera.position.toArray(),
      light: LIGHT,
      valueRange,
      knotLines: showKnotLines ? KNOT_LINE_WIDTH * dpr : 0,
      size: [w, h],
    });
  });

  return null;
}

export default NurbsGpuSurface;
