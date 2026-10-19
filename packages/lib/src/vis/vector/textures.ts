import { type NumArray } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import {
  DataTexture,
  FloatType,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  type Texture,
} from 'three';

import { type VectorField2D } from './field';

export interface FieldTextures {
  fieldTex: Texture;
  xsTex: Texture;
  ysTex: Texture;
  fieldSize: [number, number];
}

function createTexture(
  data: Float32Array,
  width: number,
  height: number,
  isRgba: boolean,
): DataTexture {
  const texture = new DataTexture(
    data,
    width,
    height,
    isRgba ? RGBAFormat : RedFormat,
    FloatType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/* Every `stride`-th sample of an axis, the last one included */
function strided(n: number, stride: number): number[] {
  const indices = [];
  for (let i = 0; i < n; i += stride) {
    indices.push(i);
  }
  if (indices.at(-1) !== n - 1) {
    indices.push(n - 1);
  }
  return indices;
}

/* Field as textures for `GLSL_SAMPLE_FIELD`; axes longer than the GPU's maximum texture size are
 * subsampled */
export function getFieldTextures(
  field: VectorField2D,
  maxSize: number,
): FieldTextures {
  const { xs, ys, u, v } = field;
  const [nx, ny] = [xs.length, ys.length];
  const ii = strided(nx, Math.ceil(nx / maxSize));
  const jj = strided(ny, Math.ceil(ny / maxSize));

  const data = new Float32Array(ii.length * jj.length * 4);
  jj.forEach((j, row) => {
    ii.forEach((i, col) => {
      const [a, b] = [u[j * nx + i], v[j * nx + i]];
      const ok = Number.isFinite(a) && Number.isFinite(b);
      data.set(
        [ok ? a : 0, ok ? b : 0, ok ? 1 : 0, 0],
        (row * ii.length + col) * 4,
      );
    });
  });

  function axis(coords: NumArray, idx: number[]): DataTexture {
    return createTexture(
      Float32Array.from(idx, (i) => coords[i]),
      idx.length,
      1,
      false,
    );
  }

  return {
    fieldTex: createTexture(data, ii.length, jj.length, true),
    xsTex: axis(xs, ii),
    ysTex: axis(ys, jj),
    fieldSize: [ii.length, jj.length],
  };
}

export function useFieldTextures(field: VectorField2D): FieldTextures {
  const maxSize = useThree((state) => state.gl.capabilities.maxTextureSize);
  const textures = useMemo(
    () => getFieldTextures(field, maxSize),
    [field, maxSize],
  );
  useEffect(
    () => () => {
      textures.fieldTex.dispose();
      textures.xsTex.dispose();
      textures.ysTex.dispose();
    },
    [textures],
  );
  return textures;
}
