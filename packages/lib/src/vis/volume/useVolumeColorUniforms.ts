import { type Domain } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { type ShaderMaterial, Vector3 } from 'three';

import { getCategoryTexture } from '../categorical/utils';
import { type ColorMap } from '../heatmap/models';
import {
  getColorMapTexture,
  getShaderScale,
  scaleDomain,
} from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { type VolumeTexture } from './useVolumeTexture';
import { getLookupTexture } from './utils';
import { type AxisLookups } from './VolumeMesh';

/* Initial uniforms of shaders that colour samples of a volume texture at positions in its box
 * (cf. `GLSL_TEX_COORDS`), set by `useVolumeColorUniforms` */
export function getVolumeColorUniforms(): Record<string, unknown> {
  return {
    volume: null,
    colorMap: null,
    xLookup: null,
    yLookup: null,
    zLookup: null,
    dims: new Vector3(),
    domainMin: 0,
    oneOverRange: 1,
    gammaExponent: 1,
    symlogConstant: 1,
    normRevertFactor: 1,
    valueOffset: 0,
  };
}

interface ColorOpts {
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap: boolean;
  axisLookups: AxisLookups; // non-uniform axes (cf. `getAxisLookup`)
  categoryColors?: string[]; // values are category indices: colors looked up, not interpolated
}

/* Volume texture, colour map and lookup tables of non-uniform axes, and the colour scale, as
 * uniforms of a shader material (cf. `getVolumeColorUniforms`); textures it creates are disposed */
export function useVolumeColorUniforms(
  material: ShaderMaterial,
  volume: VolumeTexture,
  opts: ColorOpts,
): void {
  const { uniforms } = material;
  const { domain, scaleType: visScaleType, colorMap, invertColorMap } = opts;
  const { axisLookups, categoryColors } = opts;
  const { texture, shape, valueScale, valueOffset } = volume;
  const invalidate = useThree((state) => state.invalidate);

  const colorMapTexture = useMemo(
    () =>
      categoryColors
        ? getCategoryTexture(categoryColors)
        : getColorMapTexture(colorMap, invertColorMap),
    [colorMap, invertColorMap, categoryColors],
  );
  useEffect(() => () => colorMapTexture.dispose(), [colorMapTexture]);

  const lookupTextures = useMemo(
    () => axisLookups.map((table) => table && getLookupTexture(table)),
    [axisLookups],
  );
  useEffect(
    () => () => {
      lookupTextures.forEach((lookup) => {
        lookup?.dispose();
      });
    },
    [lookupTextures],
  );

  const [scaleType, gammaExponent, symlogConstant] =
    getShaderScale(visScaleType);
  const [min, max] = scaleDomain(domain, scaleType, symlogConstant);
  const [depth, rows, cols] = shape;

  useEffect(() => {
    uniforms.volume.value = texture;
    uniforms.colorMap.value = colorMapTexture;
    [uniforms.xLookup.value, uniforms.yLookup.value, uniforms.zLookup.value] =
      lookupTextures;
    (uniforms.dims.value as Vector3).set(cols, rows, depth);
    uniforms.domainMin.value = min;
    // Empty domain (or range too small for float32) is flagged with 0 in the shader
    const oneOverRange = Math.fround(1 / (max - min));
    uniforms.oneOverRange.value = Number.isFinite(oneOverRange)
      ? oneOverRange
      : 0;
    uniforms.gammaExponent.value = gammaExponent;
    uniforms.symlogConstant.value = symlogConstant;
    uniforms.normRevertFactor.value = valueScale;
    uniforms.valueOffset.value = valueOffset;
    invalidate();
  }, [
    uniforms,
    texture,
    colorMapTexture,
    lookupTextures,
    cols,
    rows,
    depth,
    min,
    max,
    gammaExponent,
    symlogConstant,
    valueScale,
    valueOffset,
    invalidate,
  ]);
}
