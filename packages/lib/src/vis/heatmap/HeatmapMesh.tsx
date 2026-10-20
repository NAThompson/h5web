import { type Domain, type NumArray } from '@h5web/shared/vis-models';
import { type ThreeElements, useThree } from '@react-three/fiber';
import { type RGBColor } from 'd3-color';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo } from 'react';
import {
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
} from 'three';

import { type VisScaleType } from '../models';
import { useVisCanvasContext } from '../shared/VisCanvasProvider';
import VisMesh, { type VisMeshProps } from '../shared/VisMesh';
import HeatmapMaterial from './HeatmapMaterial';
import { type ColorMap, type TextureSafeTypedArray } from './models';
import {
  getChunkBounds,
  getChunkGeometry,
  getRelativePixels,
  getTextureChunks,
  sliceRelativePixels,
  sliceTextureChunk,
} from './utils';

interface Props extends VisMeshProps {
  values: NdArray<TextureSafeTypedArray>;
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  invertColorMap?: boolean;
  alphaValues?: NdArray<TextureSafeTypedArray>;
  alphaDomain?: Domain;
  alphaLog?: boolean;
  alphaGamma?: number;
  badColor?: RGBColor | string;
  belowColor?: string;
  aboveColor?: string;
  magFilter?: MagnificationTextureFilter;
  minFilter?: MinificationTextureFilter;
  mask?: NdArray<Uint8Array>;
  /* Pixel edges along non-uniform axes (pixels are evenly spaced along an axis without edges) */
  xEdges?: NumArray;
  yEdges?: NumArray;
  /* Pixel centres along non-uniform axes (default: mid-points of the edges) */
  xCentres?: NumArray;
  yCentres?: NumArray;
}

function HeatmapMesh(props: Props) {
  const {
    values,
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    alphaValues,
    alphaDomain,
    alphaLog,
    alphaGamma,
    badColor,
    belowColor,
    aboveColor,
    magFilter,
    minFilter,
    mask,
    xEdges,
    yEdges,
    xCentres,
    yCentres,
    size,
    ...meshProps
  } = props;

  const { visSize } = useVisCanvasContext();
  const maxTextureSize = useThree(
    (state) => state.gl.capabilities.maxTextureSize,
  );

  // Split arrays that exceed the GPU's max texture size into multiple textures/meshes
  const [rows, cols] = values.shape;
  const chunks = useMemo(
    () =>
      rows > maxTextureSize || cols > maxTextureSize
        ? getTextureChunks([rows, cols], maxTextureSize)
        : undefined,
    [rows, cols, maxTextureSize],
  );

  const valuesChunks = useMemo(
    () => chunks?.map((chunk) => sliceTextureChunk(values, chunk)),
    [values, chunks],
  );
  const alphaChunks = useMemo(
    () => alphaValues && chunks?.map((c) => sliceTextureChunk(alphaValues, c)),
    [alphaValues, chunks],
  );
  const maskChunks = useMemo(
    () => mask && chunks?.map((chunk) => sliceTextureChunk(mask, chunk)),
    [mask, chunks],
  );

  const relX = useMemo(
    () => xEdges && getRelativePixels(xEdges, xCentres),
    [xEdges, xCentres],
  );
  const relY = useMemo(
    () => yEdges && getRelativePixels(yEdges, yCentres),
    [yEdges, yCentres],
  );

  const { width, height } = size ?? visSize;
  const geometries = useMemo(
    () =>
      chunks?.map((chunk) =>
        getChunkGeometry(
          getChunkBounds(chunk, [rows, cols], { width, height }, relX, relY),
        ),
      ),
    [chunks, rows, cols, width, height, relX, relY],
  );

  // Each chunk's texture spans its own pixels (including overlapping texels)
  const pixelsChunks = useMemo(
    () =>
      chunks?.map(({ rows: r, cols: c }) => ({
        x: relX && sliceRelativePixels(relX, c.texStart, c.texEnd),
        y: relY && sliceRelativePixels(relY, r.texStart, r.texEnd),
      })),
    [chunks, relX, relY],
  );

  useEffect(
    () => () => {
      geometries?.forEach((geometry) => {
        geometry.dispose();
      });
    },
    [geometries],
  );

  const materialProps = {
    domain,
    scaleType,
    colorMap,
    invertColorMap,
    alphaDomain,
    alphaLog,
    alphaGamma,
    badColor,
    belowColor,
    aboveColor,
    magFilter,
    minFilter,
  };

  if (!chunks || !geometries || !valuesChunks) {
    return (
      <VisMesh size={size} {...meshProps}>
        <HeatmapMaterial
          values={values}
          alphaValues={alphaValues}
          mask={mask}
          xPixels={relX}
          yPixels={relY}
          {...materialProps}
        />
      </VisMesh>
    );
  }

  return (
    <group {...(meshProps as ThreeElements['group'])}>
      {chunks.map(({ rows: r, cols: c }, i) => (
        <mesh key={`${r.start},${c.start}`} geometry={geometries[i]}>
          <HeatmapMaterial
            values={valuesChunks[i]}
            alphaValues={alphaChunks?.[i]}
            mask={maskChunks?.[i]}
            xPixels={pixelsChunks?.[i].x}
            yPixels={pixelsChunks?.[i].y}
            {...materialProps}
          />
        </mesh>
      ))}
    </group>
  );
}

export type { Props as HeatmapMeshProps };
export default HeatmapMesh;
