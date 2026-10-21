import { type Domain, type NumArray } from '@h5web/shared/vis-models';
import { useFrame, useThree } from '@react-three/fiber';
import ndarray, { type NdArray } from 'ndarray';
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
  LinearFilter,
  Matrix4,
  type Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import { getShaderScale } from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { getUniforms } from '../utils';
import { type VolumeQuality, type VolumeRenderMode } from './models';
import { getVolumeFragmentShader, VOLUME_VERTEX_SHADER } from './shaders';
import SurfaceDepthPass from './SurfaceDepthPass';
import {
  getVolumeColorUniforms,
  useVolumeColorUniforms,
} from './useVolumeColorUniforms';
import { useVolumeTexture } from './useVolumeTexture';
import {
  getBoxSize,
  getStepCount,
  getVolumeTexture,
  initTextureEagerly,
  SAMPLES_PER_VOXEL,
} from './utils';

export type AxisLookups = [
  x: Float32Array | undefined,
  y: Float32Array | undefined,
  z: Float32Array | undefined,
];
const NO_LOOKUPS: AxisLookups = [undefined, undefined, undefined];

interface Props {
  dataArray: NdArray<NumArray>;
  coverage?: Uint8Array; // cf. `VolumeVis`
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
  /* Lookup tables of non-uniform axes x, y and z (cf. `getAxisLookup`) */
  axisLookups?: AxisLookups;
  /* Stop rays at opaque isosurfaces (rendered in `SURFACE_DEPTH_LAYER`) */
  withSurfaceDepth?: boolean;
  /* Stop rays at opaque points too (rendered in `POINT_DEPTH_LAYER`) */
  withPointDepth?: boolean;
}

function VolumeMesh(props: Props) {
  const {
    dataArray,
    coverage,
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
    axisLookups = NO_LOOKUPS,
    withSurfaceDepth = false,
    withPointDepth = false,
  } = props;

  const meshRef = useRef<Mesh>(null);

  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const volume = useVolumeTexture(dataArray);
  const { shape, isReady: isVolumeReady } = volume;

  if (coverage && coverage.length !== dataArray.size) {
    throw new Error('Expected coverage of every voxel');
  }

  // Ignored with nearest filtering of values (i.e. no linear filtering of float textures)
  const isLinear = volume.texture.magFilter === LinearFilter;
  const coverageTexture = useMemo(
    () =>
      coverage && isLinear
        ? getVolumeTexture(ndarray(coverage, shape), true)
        : undefined,
    [coverage, isLinear, shape],
  );

  const [coverageError, setCoverageError] = useState<Error>();
  if (coverageError) {
    throw coverageError;
  }
  useLayoutEffect(() => {
    if (coverageTexture) {
      setCoverageError(initTextureEagerly(gl, coverageTexture));
    }
  }, [gl, coverageTexture]);
  useEffect(() => () => coverageTexture?.dispose(), [coverageTexture]);
  const hasCoverage = !!coverageTexture;

  const [hasX, hasY, hasZ] = axisLookups.map((table) => !!table);
  const [scaleType] = getShaderScale(visScaleType);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VOLUME_VERTEX_SHADER,
        fragmentShader: getVolumeFragmentShader(
          mode,
          scaleType,
          [hasX, hasY, hasZ],
          hasCoverage,
        ),
        uniforms: getUniforms({
          ...getVolumeColorUniforms(),
          stepDims: new Vector3(),
          coverage: null,
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
    [mode, scaleType, hasX, hasY, hasZ, hasCoverage],
  );

  useEffect(() => () => material.dispose(), [material]);

  const { uniforms } = material;
  useVolumeColorUniforms(material, volume, {
    domain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap,
    axisLookups,
  });

  useEffect(() => {
    (uniforms.stepDims.value as Vector3).set(
      getStepCount(axisLookups[0], shape[2]),
      getStepCount(axisLookups[1], shape[1]),
      getStepCount(axisLookups[2], shape[0]),
    );
    uniforms.coverage.value = coverageTexture;
    uniforms.opacity.value = opacity;
    uniforms.threshold.value = threshold;
    invalidate();
  }, [
    uniforms,
    axisLookups,
    shape,
    coverageTexture,
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
        visible={isVolumeReady}
      >
        <boxGeometry />
      </mesh>
      {(withSurfaceDepth || withPointDepth) && (
        <SurfaceDepthPass
          volumeRef={meshRef}
          material={material}
          withPoints={withPointDepth}
        />
      )}
    </>
  );
}

export default VolumeMesh;
