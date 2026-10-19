import {
  type Domain,
  type IgnoreValue,
  type NumArray,
} from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo } from 'react';
import {
  Color,
  DoubleSide,
  GLSL3,
  LinearSRGBColorSpace,
  ShaderMaterial,
} from 'three';

import { type ColorMap } from '../heatmap/models';
import {
  getMask,
  getShaderScale,
  GLSL_IS_SUPPORTED,
  GLSL_LOG1P,
  GLSL_SCALE,
} from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { getUniforms } from '../utils';
import { type OrthoPoint } from './models';
import { getLookupDefines, GLSL_TEX_COORDS } from './shaders';
import {
  getVolumeColorUniforms,
  useVolumeColorUniforms,
} from './useVolumeColorUniforms';
import { useVolumeTexture } from './useVolumeTexture';
import { getPlaneGeometries, getVolumeTexture, getVoxelCentre } from './utils';
import { type AxisLookups } from './VolumeMesh';

/* Outline colours of the planes, by normal axis (x, y, z): as the crosshair lines of the
 * orthoslice heatmaps that stand for them */
export const ORTHO_PLANE_COLORS = ['#ff6b6b', '#69db7c', '#4dabf7'] as const;

const PLANES_VERTEX_SHADER = /* glsl */ `
  out vec3 vBox;

  void main() {
    vBox = position + 0.5; // texture space
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  }
`;

function getPlanesFragmentShader(
  scaleType: ReturnType<typeof getShaderScale>[0],
  lookups: [boolean, boolean, boolean],
  withMask: boolean,
): string {
  return /* glsl */ `
    precision highp float;
    precision highp sampler3D;

    ${getLookupDefines(lookups)}
    ${withMask ? '#define WITH_MASK' : ''}

    uniform sampler3D volume;
    uniform sampler3D mask; // ignored values (e.g. fill values), cf. \`getMask\`
    uniform sampler2D colorMap;
    uniform float domainMin;
    uniform float oneOverRange;
    uniform float gammaExponent;
    uniform float symlogConstant;
    uniform float normRevertFactor;
    uniform float valueOffset;
    uniform vec3 nanColor;
    uniform bool withBelowColor;
    uniform vec3 belowColor;
    uniform bool withAboveColor;
    uniform vec3 aboveColor;

    in vec3 vBox;
    out vec4 fragColor;

    const float oneOverLog10 = 0.43429448190325176;

    bool isSupported(float value) {
      return ${GLSL_IS_SUPPORTED[scaleType] || 'true'};
    }

    ${GLSL_LOG1P}

    float scale(float value) {
      return ${GLSL_SCALE[scaleType] || 'value'};
    }

    ${GLSL_TEX_COORDS}

    void main() {
      // Centre of the voxel under the fragment: nearest neighbour, as the heatmaps of the slices
      vec3 voxel = min(floor(toTexCoords(vBox) * dims), dims - 1.);
      vec3 texCoords = (voxel + 0.5) / dims;

      #ifdef WITH_MASK
        if (texture(mask, texCoords).r > 0.) {
          fragColor = vec4(nanColor, 1.);
          return;
        }
      #endif

      float value = texture(volume, texCoords).r * normRevertFactor + valueOffset;
      if (isnan(value) || !isSupported(value)) {
        fragColor = vec4(nanColor, 1.);
        return;
      }

      float scaledValue = scale(value);
      if (oneOverRange == 0.) {
        // Empty domain, as \`VolumeMesh\`
        float t = scaledValue >= domainMin ? 1. : 0.;
        fragColor = vec4(texture(colorMap, vec2(t, 0.5)).rgb, 1.);
        return;
      }

      float t = oneOverRange * (scaledValue - domainMin);
      if (t < 0. && withBelowColor) {
        fragColor = vec4(belowColor, 1.);
      } else if (t > 1. && withAboveColor) {
        fragColor = vec4(aboveColor, 1.);
      } else {
        float colorT = pow(clamp(t, 0., 1.), gammaExponent);
        fragColor = vec4(texture(colorMap, vec2(colorT, 0.5)).rgb, 1.);
      }
    }
  `;
}

/* CSS colour as is (like the colour map's texels): output colours are not converted */
function setColor(uniform: { value: unknown }, color: string): void {
  (uniform.value as Color).setStyle(color, LinearSRGBColorSpace);
}

interface Props {
  dataArray: NdArray<NumArray>;
  point: OrthoPoint; // voxel through which the planes go
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  axisLookups: AxisLookups;
  ignoreValue?: IgnoreValue; // drawn in `nanColor`, as NaN
  nanColor?: string;
  belowColor?: string; // CSS colour of values below the domain (default: colour of its lower end)
  aboveColor?: string;
}

/* Three orthogonal planes through a voxel of a volume, coloured by sampling its 3D texture (cf.
 * `useVolumeTexture`), in the unit box (to be scaled to the volume's box) */
function OrthoPlanes(props: Props) {
  const {
    dataArray,
    point,
    domain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap,
    axisLookups,
    ignoreValue,
    nanColor = '#404040',
    belowColor,
    aboveColor,
  } = props;

  const invalidate = useThree((state) => state.invalidate);
  const volume = useVolumeTexture(dataArray);
  const [depth, rows, cols] = volume.shape;

  // Ignored values as a separate mask (1 byte per voxel, only if any can be ignored), so that
  // the volume keeps its texture type (e.g. 8-bit integers, or half floats prepared in workers)
  const maskTexture = useMemo(() => {
    const mask = getMask(dataArray, ignoreValue);
    return mask && getVolumeTexture(mask, false);
  }, [dataArray, ignoreValue]);
  useEffect(() => () => maskTexture?.dispose(), [maskTexture]);

  const [hasX, hasY, hasZ] = axisLookups.map((table) => !!table);
  const [scaleType] = getShaderScale(visScaleType);
  const withMask = !!maskTexture;

  const material = useMemo(
    () =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: PLANES_VERTEX_SHADER,
        fragmentShader: getPlanesFragmentShader(
          scaleType,
          [hasX, hasY, hasZ],
          withMask,
        ),
        uniforms: getUniforms({
          ...getVolumeColorUniforms(),
          mask: null,
          nanColor: new Color(),
          withBelowColor: false,
          belowColor: new Color(),
          withAboveColor: false,
          aboveColor: new Color(),
        }),
        side: DoubleSide,
      }),
    [scaleType, hasX, hasY, hasZ, withMask],
  );
  useEffect(() => () => material.dispose(), [material]);

  useVolumeColorUniforms(material, volume, {
    domain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap,
    axisLookups,
  });

  const { uniforms } = material;
  useEffect(() => {
    uniforms.mask.value = maskTexture;
    setColor(uniforms.nanColor, nanColor);
    uniforms.withBelowColor.value = !!belowColor;
    setColor(uniforms.belowColor, belowColor ?? 'black');
    uniforms.withAboveColor.value = !!aboveColor;
    setColor(uniforms.aboveColor, aboveColor ?? 'black');
    invalidate();
  }, [uniforms, maskTexture, nanColor, belowColor, aboveColor, invalidate]);

  // Planes normal to x, y and z, at the centres of the voxel's column, row and layer
  const sizes = [cols, rows, depth];
  const [ox, oy, oz] = point.map((index, axis) =>
    getVoxelCentre(axisLookups[axis], index, sizes[axis]),
  );
  const geometries = useMemo(
    () => [ox, oy, oz].map((offset, axis) => getPlaneGeometries(axis, offset)),
    [ox, oy, oz],
  );
  useEffect(
    () => () => {
      geometries.forEach(({ plane, outline }) => {
        plane.dispose();
        outline.dispose();
      });
    },
    [geometries],
  );
  useEffect(() => invalidate(), [geometries, invalidate]);

  return (
    <>
      {geometries.map(({ plane, outline }, axis) => (
        // eslint-disable-next-line react/no-array-index-key
        <group key={axis}>
          <mesh geometry={plane} material={material} visible={volume.isReady} />
          <lineLoop geometry={outline} renderOrder={1}>
            <lineBasicMaterial
              color={ORTHO_PLANE_COLORS[axis]}
              depthTest={false}
            />
          </lineLoop>
        </group>
      ))}
    </>
  );
}

export default OrthoPlanes;
