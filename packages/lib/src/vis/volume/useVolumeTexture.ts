import { type NumArray } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { type NdArray } from 'ndarray';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { type Data3DTexture } from 'three';

import { type TextureSafeTypedArray } from '../heatmap/models';
import { toTextureSafeNdArray } from '../heatmap/utils';
import { convertToHalfFloats, getPreparedVolume } from './prepare/client';
import {
  getHalfFloatNormalization,
  type HalfFloatNormalization,
} from './prepare/utils';
import {
  canAllocateVolumeTexture,
  canUseHalfFloats,
  getGLErrors,
  getHalfFloatTexture,
  getVolumeTexture,
  toContiguousArray,
  toNormalizedHalfFloats,
  uploadHalfFloatChunks,
  withMemoryCheck,
} from './utils';

export interface VolumeTexture {
  texture: Data3DTexture;
  shape: number[]; // `[depth, rows, cols]`
  valueOffset: number; // values are `texel * valueScale + valueOffset`
  valueScale: number;
  isReady: boolean; // half-float textures are filled asynchronously
}

/**
 * 3D texture of a volume, uploaded eagerly to report GPU errors to error boundaries (thrown on
 * render). Too large for 32-bit floats, it falls back to normalized half floats, converted in
 * workers when possible. Shared by the ray marcher and the orthoslice planes.
 */
export function useVolumeTexture(dataArray: NdArray<NumArray>): VolumeTexture {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  // Errors detected outside of render (i.e. on upload) are re-thrown here for error boundaries to catch
  const [gpuError, setGpuError] = useState<Error>();
  if (gpuError) {
    throw gpuError;
  }

  const textureSafeValues = useMemo(
    () =>
      withMemoryCheck(() => toContiguousArray(toTextureSafeNdArray(dataArray))),
    [dataArray],
  );

  const max3DSize = useMemo(() => {
    const ctx = gl.getContext() as WebGL2RenderingContext;
    return ctx.getParameter(ctx.MAX_3D_TEXTURE_SIZE) as number;
  }, [gl]);

  if (textureSafeValues.shape.some((size) => size > max3DSize)) {
    throw new Error(
      `Volume too large for GPU (max ${max3DSize} voxels per dimension)`,
    );
  }

  const { values, halfFloatNormalization, shape, valueOffset, valueScale } =
    useMemo((): {
      values?: NdArray<TextureSafeTypedArray>;
      halfFloatNormalization?: HalfFloatNormalization; // to convert in workers (see below)
      shape: number[];
      valueOffset: number;
      valueScale: number;
    } => {
      const ctx = gl.getContext() as WebGL2RenderingContext;

      // Fall back to half floats if texture is too large (e.g. Chromium caps textures at 1 GiB)
      if (
        textureSafeValues.dtype === 'float32' &&
        canUseHalfFloats() &&
        !canAllocateVolumeTexture(ctx, textureSafeValues.shape, ctx.R32F)
      ) {
        // Convert in workers if bounds were computed there (cf. `useVolumeDomain`)
        const [, rows, cols] = textureSafeValues.shape;
        const prepared = getPreparedVolume(
          textureSafeValues.data as Float32Array,
          rows * cols,
        );
        if (prepared) {
          const normalization = getHalfFloatNormalization(prepared.bounds);
          return {
            shape: textureSafeValues.shape,
            halfFloatNormalization: normalization,
            valueOffset: normalization.offset,
            valueScale: normalization.scale,
          };
        }

        const normalized = withMemoryCheck(() =>
          toNormalizedHalfFloats(textureSafeValues as NdArray<Float32Array>),
        );
        return {
          values: normalized.values,
          shape: normalized.values.shape,
          valueOffset: normalized.offset,
          valueScale: normalized.scale,
        };
      }

      return {
        values: textureSafeValues,
        shape: textureSafeValues.shape,
        valueOffset: 0,
        // revert WebGL's automatic normalization of UNSIGNED_BYTE with RED format
        valueScale: textureSafeValues.dtype.startsWith('uint8') ? 255 : 1,
      };
    }, [textureSafeValues, gl]);

  const volumeTexture = useMemo(
    () =>
      values
        ? getVolumeTexture(
            values,
            values.dtype !== 'float32' ||
              gl.extensions.has('OES_texture_float_linear'),
          )
        : getHalfFloatTexture(shape), // filled once converted (see below)
    [values, shape, gl],
  );

  // Upload volume eagerly to detect out-of-memory errors, which WebGL does not otherwise report
  useLayoutEffect(() => {
    const ctx = gl.getContext();
    getGLErrors(ctx); // clear previous errors
    gl.initTexture(volumeTexture);

    const errors = getGLErrors(ctx);
    if (errors.length > 0) {
      setGpuError(
        new Error(
          errors.includes(ctx.OUT_OF_MEMORY)
            ? 'Not enough GPU memory to render volume'
            : 'Volume too large to be uploaded to the GPU', // e.g. larger than allowed even as half floats
        ),
      );
    }
  }, [gl, volumeTexture]);

  /* Convert to half floats in workers, then upload chunk by chunk. Chunks are only referenced
   * until uploaded; they are converted again if the texture needs to be filled again (e.g.
   * on remount). A lost WebGL context is reported as an error (see below), which unmounts
   * the mesh, so a restored context gets a new texture. */
  const [filledTexture, setFilledTexture] = useState<Data3DTexture>();
  useEffect(() => {
    if (!halfFloatNormalization) {
      return undefined;
    }

    const controller = new AbortController();
    const [, rows, cols] = shape;

    async function convertAndUpload(normalization: HalfFloatNormalization) {
      let chunks;
      try {
        chunks = await convertToHalfFloats(
          textureSafeValues.data as Float32Array,
          rows * cols,
          normalization,
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          setGpuError(
            error instanceof Error ? error : new Error('Conversion failed'),
          );
        }
        return;
      }

      if (controller.signal.aborted) {
        return;
      }

      const ctx = gl.getContext();
      getGLErrors(ctx); // clear previous errors
      gl.initTexture(volumeTexture); // no-op unless texture needs to be (re-)initialized
      uploadHalfFloatChunks(gl, volumeTexture, chunks);

      const errors = getGLErrors(ctx);
      if (errors.length > 0) {
        setGpuError(
          new Error(
            errors.includes(ctx.OUT_OF_MEMORY)
              ? 'Not enough GPU memory to render volume'
              : 'Volume too large to be uploaded to the GPU',
          ),
        );
        return;
      }

      setFilledTexture(volumeTexture);
      invalidate();
    }

    void convertAndUpload(halfFloatNormalization);

    return () => controller.abort();
  }, [
    gl,
    volumeTexture,
    halfFloatNormalization,
    shape,
    textureSafeValues,
    invalidate,
  ]);

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

  return {
    texture: volumeTexture,
    shape,
    valueOffset,
    valueScale,
    // Don't render half-float textures before they are filled
    isReady: !halfFloatNormalization || filledTexture === volumeTexture,
  };
}
