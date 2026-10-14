import {
  type Domain,
  type NumArray,
  type ScaleType,
} from '@h5web/shared/vis-models';
import { useFrame, useThree } from '@react-three/fiber';
import { type NdArray } from 'ndarray';
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BackSide,
  GLSL3,
  Matrix4,
  type Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import {
  getColorMapTexture,
  scaleDomain,
  toTextureSafeNdArray,
} from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { getUniforms } from '../utils';
import { type VolumeQuality, type VolumeRenderMode } from './models';
import { getVolumeFragmentShader, VOLUME_VERTEX_SHADER } from './shaders';
import SurfaceDepthPass from './SurfaceDepthPass';
import {
  getBoxSize,
  getGLErrors,
  getVolumeTexture,
  SAMPLES_PER_VOXEL,
  toContiguousArray,
  withMemoryCheck,
} from './utils';

interface Props {
  dataArray: NdArray<NumArray>;
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  mode: VolumeRenderMode;
  opacity: number;
  threshold: number;
  quality: VolumeQuality;
  interactingRef: RefObject<boolean>;
  boxSize?: [number, number, number];
  /* Stop rays at opaque isosurfaces (rendered in `SURFACE_DEPTH_LAYER`) */
  withSurfaceDepth?: boolean;
}

function VolumeMesh(props: Props) {
  const {
    dataArray,
    domain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap,
    mode,
    opacity,
    threshold,
    quality,
    interactingRef,
    boxSize,
    withSurfaceDepth = false,
  } = props;

  const meshRef = useRef<Mesh>(null);

  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // Errors detected outside of render (i.e. on upload) are re-thrown here for error boundaries to catch
  const [gpuError, setGpuError] = useState<Error>();
  if (gpuError) {
    throw gpuError;
  }

  const values = useMemo(
    () =>
      withMemoryCheck(() => toContiguousArray(toTextureSafeNdArray(dataArray))),
    [dataArray],
  );
  const { shape } = values;

  const max3DSize = useMemo(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    return ctx.getParameter(ctx.MAX_3D_TEXTURE_SIZE) as number;
  }, [gl]);

  if (shape.some((size) => size > max3DSize)) {
    throw new Error(
      `Volume too large for GPU (max ${max3DSize} voxels per dimension)`,
    );
  }

  const volumeTexture = useMemo(
    () =>
      getVolumeTexture(
        values,
        values.dtype !== 'float32' ||
          gl.extensions.has('OES_texture_float_linear'),
      ),
    [values, gl],
  );

  const colorMapTexture = useMemo(
    () => getColorMapTexture(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  // Upload volume eagerly to detect out-of-memory errors, which WebGL does not otherwise report
  useLayoutEffect(() => {
    const ctx = gl.getContext();
    getGLErrors(ctx); // clear previous errors
    gl.initTexture(volumeTexture);

    if (getGLErrors(ctx).includes(ctx.OUT_OF_MEMORY)) {
      setGpuError(new Error('Not enough GPU memory to render volume'));
    }
  }, [gl, volumeTexture]);

  // Some browsers lose the WebGL context instead of reporting OUT_OF_MEMORY
  useEffect(() => {
    const canvas = gl.domElement;
    function handleContextLost() {
      setGpuError(new Error('WebGL context lost (likely out of GPU memory)'));
    }

    canvas.addEventListener('webglcontextlost', handleContextLost);
    return () =>
      canvas.removeEventListener('webglcontextlost', handleContextLost);
  }, [gl]);

  useEffect(() => () => volumeTexture.dispose(), [volumeTexture]);
  useEffect(() => () => colorMapTexture.dispose(), [colorMapTexture]);

  const [scaleType, gammaExponent] = Array.isArray(visScaleType)
    ? visScaleType
    : [visScaleType as ScaleType, 1];

  const material = useMemo(
    () =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VOLUME_VERTEX_SHADER,
        fragmentShader: getVolumeFragmentShader(mode, scaleType),
        uniforms: getUniforms({
          volume: null,
          colorMap: null,
          dims: new Vector3(),
          domainMin: 0,
          oneOverRange: 1,
          gammaExponent: 1,
          normRevertFactor: 1,
          samplesPerVoxel: 1,
          opacity: 1,
          threshold: 0,
          hasSurfaceDepth: false,
          surfaceDepth: null,
          depthTexelSize: new Vector2(),
          depthToBox: new Matrix4(),
        }),
        side: BackSide,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false, // rays are stopped at opaque surfaces in the shader instead
      }),
    [mode, scaleType],
  );

  useEffect(() => () => material.dispose(), [material]);

  const [min, max] = scaleDomain(domain, scaleType);
  const { uniforms } = material;

  useEffect(() => {
    uniforms.volume.value = volumeTexture;
    uniforms.colorMap.value = colorMapTexture;
    (uniforms.dims.value as Vector3).set(shape[2], shape[1], shape[0]);
    uniforms.domainMin.value = min;
    // Empty domain (or range too small for float32) is flagged with 0 in the shader
    const oneOverRange = Math.fround(1 / (max - min));
    uniforms.oneOverRange.value = Number.isFinite(oneOverRange)
      ? oneOverRange
      : 0;
    uniforms.gammaExponent.value = gammaExponent;
    uniforms.normRevertFactor.value = values.dtype.startsWith('uint8')
      ? 255
      : 1; // revert WebGL's automatic normalization of UNSIGNED_BYTE with RED format
    uniforms.opacity.value = opacity;
    uniforms.threshold.value = threshold;
    invalidate();
  }, [
    uniforms,
    volumeTexture,
    colorMapTexture,
    shape,
    min,
    max,
    gammaExponent,
    values.dtype,
    opacity,
    threshold,
    invalidate,
  ]);

  // Lower sampling rate while the camera moves to keep interactions smooth
  useFrame(() => {
    const samples = SAMPLES_PER_VOXEL[quality];
    uniforms.samplesPerVoxel.value = interactingRef.current
      ? samples / 2
      : samples;
  });

  return (
    <>
      <mesh
        ref={meshRef}
        scale={boxSize ?? getBoxSize(shape)}
        material={material}
      >
        <boxGeometry />
      </mesh>
      {withSurfaceDepth && (
        <SurfaceDepthPass volumeRef={meshRef} material={material} />
      )}
    </>
  );
}

export default VolumeMesh;
