import { type NumArray } from '@h5web/shared/vis-models';
import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  SRGBColorSpace,
} from 'three';

import CurveMesh from '../curve/CurveMesh';
import { buildCurveBuffers, gatherColors } from '../curve/utils';
import {
  getColorParams,
  getLinearColorLut,
  getVertexColors,
} from '../three-d/utils';
import { useSurfaceContext } from './context';

interface Props {
  x: NumArray;
  y: NumArray;
  z?: NumArray; // height of each point, as values of the surface; on the surface if not provided
  values?: NumArray; // colour each point with the surface's colour map, scale and domain...
  color?: string; // ... or with a CSS colour
  showLine?: boolean; // join consecutive points
  lineWidth?: number; // CSS pixels
  showPoints?: boolean; // as discs with a dark outline
  pointSize?: number; // CSS pixels
}

const MAX_STEPS_PER_SEGMENT = 256;

/* Insert points along each segment, about one per cell of the surface's grid */
export function densifyPath(
  x: NumArray,
  y: NumArray,
  [dx, dy]: [number, number],
): { x: number[]; y: number[] } {
  const count = Math.min(x.length, y.length);
  const outX: number[] = [];
  const outY: number[] = [];

  for (let i = 0; i < count; i += 1) {
    outX.push(x[i]);
    outY.push(y[i]);
    if (i === count - 1) {
      break;
    }

    const cells = Math.max(
      Math.abs(x[i + 1] - x[i]) / dx,
      Math.abs(y[i + 1] - y[i]) / dy,
    );
    const steps = Number.isFinite(cells)
      ? Math.min(Math.ceil(cells), MAX_STEPS_PER_SEGMENT)
      : 1;
    for (let k = 1; k < steps; k += 1) {
      outX.push(x[i] + ((x[i + 1] - x[i]) * k) / steps);
      outY.push(y[i] + ((y[i + 1] - y[i]) * k) / steps);
    }
  }

  return { x: outX, y: outY };
}

/* White disc with a dark ring: vertex colours tint the disc and leave the ring dark */
function createRingTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#202020';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 12, 0, 2 * Math.PI);
    ctx.fill();
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Points and/or polyline drawn on top of a `SurfaceVis`, in the surface's data coordinates
 * (e.g. samples of an optimizer on the landscape it explores). Points outside the surface,
 * or whose height is not supported by its scale, are left out.
 */
function SurfaceOverlay(props: Props) {
  const {
    x,
    y,
    z,
    values,
    color = 'white',
    showLine = true,
    lineWidth = 2,
    showPoints = false,
    pointSize = 9,
  } = props;

  const { dataToWorld, cellSize, domain, scaleType, colorMap, invertColorMap } =
    useSurfaceContext();
  const invalidate = useThree((state) => state.invalidate);

  // Lines draped on the surface follow it from cell to cell, rather than cutting through bumps
  const path = useMemo(
    () => (showLine && !z && !values ? densifyPath(x, y, cellSize) : { x, y }),
    [x, y, z, values, showLine, cellSize],
  );

  const buffers = useMemo(() => {
    const count = Math.min(path.x.length, path.y.length);
    const world = [0, 1, 2].map(() => new Float64Array(count).fill(Number.NaN));
    for (let i = 0; i < count; i += 1) {
      const pos = dataToWorld(path.x[i], path.y[i], z?.[i]);
      if (pos) {
        pos.forEach((val, axis) => {
          world[axis][i] = val;
        });
      }
    }

    return buildCurveBuffers(world[0], world[1], world[2], (wx, wy, wz) => [
      wx,
      wy,
      wz,
    ]);
  }, [path, z, dataToWorld]);

  const colors = useMemo(() => {
    const count = Math.min(path.x.length, path.y.length);
    if (values) {
      const lut = getLinearColorLut(colorMap, invertColorMap);
      return getVertexColors(getColorParams(values, domain, scaleType), lut);
    }

    const { r, g, b } = new Color(color); // converted to linear
    return Float32Array.from({ length: count * 3 }, (_, i) => [r, g, b][i % 3]);
  }, [path, values, color, domain, scaleType, colorMap, invertColorMap]);

  const pointsGeometry = useMemo(() => {
    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new BufferAttribute(buffers.pointPositions, 3),
    );
    return geom;
  }, [buffers]);

  const ringTexture = useMemo(createRingTexture, []);

  useEffect(() => () => pointsGeometry.dispose(), [pointsGeometry]);
  useEffect(() => () => ringTexture.dispose(), [ringTexture]);

  useLayoutEffect(() => {
    pointsGeometry.setAttribute(
      'color',
      new BufferAttribute(gatherColors(colors, buffers.pointIndices), 3),
    );
    invalidate();
  }, [pointsGeometry, colors, buffers, invalidate]);

  return (
    <>
      {showLine && (
        <CurveMesh
          buffers={buffers}
          colors={colors}
          showLine
          lineWidth={lineWidth}
          showPoints={false}
          pointSize={0}
        />
      )}
      {showPoints && (
        <points geometry={pointsGeometry} renderOrder={1}>
          <pointsMaterial
            depthTest={false} // e.g. samples of an optimizer must not hide behind bumps
            vertexColors
            size={pointSize} // in CSS pixels: three.js applies the pixel ratio
            sizeAttenuation={false}
            map={ringTexture}
            alphaTest={0.5}
          />
        </points>
      )}
    </>
  );
}

export type { Props as SurfaceOverlayProps };
export default SurfaceOverlay;
