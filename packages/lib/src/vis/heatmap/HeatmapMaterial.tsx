import { type Domain } from '@h5web/shared/vis-models';
import { rgb, type RGBColor } from 'd3-color';
import { type NdArray } from 'ndarray';
import { memo, useMemo } from 'react';
import {
  DoubleSide,
  LinearFilter,
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
  Vector4,
} from 'three';

import { type VisScaleType } from '../models';
import { type VisMeshProps } from '../shared/VisMesh';
import { DEFAULT_DOMAIN, getUniforms, VERTEX_SHADER } from '../utils';
import { useDataTexture, useDisposeOnChange, usePixelsTexture } from './hooks';
import { type ColorMap, type TextureSafeTypedArray } from './models';
import {
  getColorMapTexture,
  getGlslPixels,
  getShaderScale,
  GLSL_IS_SUPPORTED,
  GLSL_SCALE,
  scaleDomain,
} from './utils';

interface Props extends VisMeshProps {
  values: NdArray<TextureSafeTypedArray>;
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap?: boolean;
  alphaValues?: NdArray<TextureSafeTypedArray>;
  alphaDomain?: Domain;
  badColor?: RGBColor | string;
  belowColor?: string; // values below the domain (default: colour of its lower end)
  aboveColor?: string;
  magFilter?: MagnificationTextureFilter;
  minFilter?: MinificationTextureFilter;
  mask?: NdArray<Uint8Array>;
  xPixels?: Float32Array; // relative pixels of non-uniform axes (cf. `getRelativePixels`)
  yPixels?: Float32Array;
}

const DEFAULT_BAD_COLOR = rgb(255, 255, 255, 0);

function toVector4(color: RGBColor): Vector4 {
  return new Vector4(
    color.r / 255,
    color.g / 255,
    color.b / 255,
    color.opacity,
  );
}

/* Colour as a uniform, and whether it is given (and valid) */
function getColorUniform(css: string | undefined): [Vector4, number] {
  const color = rgb(css ?? '');
  return Number.isFinite(color.r) ? [toVector4(color), 1] : [new Vector4(), 0];
}

function HeatmapMaterial(props: Props) {
  const {
    values,
    domain,
    scaleType: visScaleType,
    colorMap,
    invertColorMap = false,
    alphaValues,
    alphaDomain = DEFAULT_DOMAIN,
    badColor = DEFAULT_BAD_COLOR,
    belowColor,
    aboveColor,
    magFilter,
    minFilter,
    mask,
    xPixels,
    yPixels,
  } = props;

  const dataTexture = useDataTexture(values, magFilter, minFilter);
  const alphaTexture = useDataTexture(alphaValues);
  const maskTexture = useDataTexture(mask);
  const xPixelsTexture = usePixelsTexture(xPixels);
  const yPixelsTexture = usePixelsTexture(yPixels);
  const glslPixels = getGlslPixels(
    !!xPixels,
    !!yPixels,
    magFilter === LinearFilter || minFilter === LinearFilter, // interpolate between centres
  );

  const colorMapTexture = useMemo(
    () => getColorMapTexture(colorMap, invertColorMap),
    [colorMap, invertColorMap],
  );

  useDisposeOnChange(dataTexture);
  useDisposeOnChange(alphaTexture);
  useDisposeOnChange(maskTexture);
  useDisposeOnChange(xPixelsTexture);
  useDisposeOnChange(yPixelsTexture);
  useDisposeOnChange(colorMapTexture);

  const [scaleType, gammaExponent, symlogConstant] =
    getShaderScale(visScaleType);

  const scaledDomain = scaleDomain(domain, scaleType, symlogConstant);

  const badColorAsRgb = typeof badColor === 'string' ? rgb(badColor) : badColor;
  const [below, withBelow] = getColorUniform(belowColor);
  const [above, withAbove] = getColorUniform(aboveColor);

  const shader = {
    uniforms: getUniforms({
      data: dataTexture,
      mask: maskTexture,
      xPixels: xPixelsTexture,
      yPixels: yPixelsTexture,
      colorMap: colorMapTexture,
      min: scaledDomain[0],
      oneOverRange: 1 / (scaledDomain[1] - scaledDomain[0]),
      gammaExponent,
      symlogConstant,
      normRevertFactor: values.dtype === 'uint8' ? 255 : 1, // revert WebGL's automatic normalization of UNSIGNED_BYTE with RED format
      alpha: alphaTexture,
      withAlpha: alphaValues ? 1 : 0,
      alphaMin: alphaDomain[0],
      oneOverAlphaRange: 1 / (alphaDomain[1] - alphaDomain[0]),
      badColor: toVector4(badColorAsRgb),
      domainMin: domain[0],
      domainMax: domain[1],
      belowColor: below,
      withBelow,
      aboveColor: above,
      withAbove,
    }),
    vertexShader: VERTEX_SHADER,
    fragmentShader: `
      uniform sampler2D data;
      uniform sampler2D colorMap;

      uniform float min;
      uniform float oneOverRange;
      uniform float gammaExponent;
      uniform float symlogConstant;
      uniform float normRevertFactor;

      uniform sampler2D alpha;
      uniform float alphaMin;
      uniform float oneOverAlphaRange;
      uniform int withAlpha;
      uniform vec4 badColor;

      uniform float domainMin;
      uniform float domainMax;
      uniform vec4 belowColor;
      uniform int withBelow;
      uniform vec4 aboveColor;
      uniform int withAbove;

      uniform sampler2D mask;

      const float oneOverLog10 = 0.43429448190325176;

      varying vec2 coords;
      ${glslPixels.declarations}

      bool isSupported(float value) {
        return ${GLSL_IS_SUPPORTED[scaleType] || 'true'};
      }

      float scale(float value) {
        return ${GLSL_SCALE[scaleType] || 'value'};
      }

      void main() {
        ${glslPixels.remapping}
        float value = texture2D(data, coords).r * normRevertFactor;
        float maskValue = texture2D(mask, coords).r;

        if (isnan(value) || !isSupported(value) || maskValue == 1.) {
            gl_FragColor = badColor;
        } else if (withBelow == 1 && value < domainMin) {
          gl_FragColor = belowColor;
        } else if (withAbove == 1 && value > domainMax) {
          gl_FragColor = aboveColor;
        } else {
          float scaledValue = scale(value);
          float normalizedValue = clamp(oneOverRange * (scaledValue - min), 0., 1.);

          gl_FragColor = texture2D(colorMap, vec2(pow(normalizedValue, gammaExponent), 0.5));

          if (withAlpha == 1) {
            gl_FragColor.a = oneOverAlphaRange * (texture2D(alpha, coords).r - alphaMin);
          }
        }
      }
    `,
  };

  return <shaderMaterial args={[shader]} side={DoubleSide} />;
}

export default memo(HeatmapMaterial);
