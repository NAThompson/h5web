import { type Camera } from 'three';

import { type AxisScale } from '../models';
import { type KnotSpan, type NurbsCurve } from './nurbs';

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
