import { type Camera, type Matrix4 } from 'three';

import { type AxisScale } from '../models';
import { type KnotSpan, type NurbsCurve, type NurbsSurface } from './nurbs';

export interface NurbsLineProps {
  curve: NurbsCurve;
  spans: KnotSpan[]; // cf. `getKnotSpans`
  color: string;
  width: number; // CSS pixels
}

/* Device pixels per unit of data along each axis (linear axes) */
export function getPixelsPerUnit(
  camera: Camera,
  abscissaScale: AxisScale,
  ordinateScale: AxisScale,
  dpr: number,
): [number, number] {
  return [
    ((abscissaScale(1) - abscissaScale(0)) / camera.scale.x) * dpr,
    ((ordinateScale(1) - ordinateScale(0)) / camera.scale.y) * dpr,
  ];
}

/*
 * Control points of a surface (world coordinates) on screen, in device pixels from the centre,
 * and their weights times clip-space `w`: the perspective projection of a NURBS surface is the
 * NURBS surface of those (cf. `getSurfaceSampleCounts`). Points behind the camera are moved
 * onto its near plane, so their spans get the most steps.
 */
export function projectControlPoints(
  surface: NurbsSurface,
  viewProjection: Matrix4,
  size: [number, number],
  near: number,
): { points: Float64Array; weights: Float64Array } {
  const { points, weights } = surface;
  const e = viewProjection.elements;
  const projected = new Float64Array(weights.length * 2);
  const projectedWeights = new Float64Array(weights.length);

  weights.forEach((weight, i) => {
    const [x, y, z] = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    const w = Math.max(e[3] * x + e[7] * y + e[11] * z + e[15], near);
    projected[i * 2] =
      (((e[0] * x + e[4] * y + e[8] * z + e[12]) / w) * size[0]) / 2;
    projected[i * 2 + 1] =
      (((e[1] * x + e[5] * y + e[9] * z + e[13]) / w) * size[1]) / 2;
    projectedWeights[i] = weight * w;
  });
  return { points: projected, weights: projectedWeights };
}
