import { type NumArray } from '@h5web/shared/vis-models';

import { type IsosurfaceGeometry } from './marchingCubes';

export enum VolumeRenderMode {
  MIP = 'MIP',
  DVR = 'DVR',
  Iso = 'Iso',
}

export enum VolumeQuality {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum IsoColorMode {
  Solid = 'solid',
  Gradient = 'gradient',
}

export interface IsosurfaceParams {
  id?: number | string; // to keep meshes when levels change (defaults to index)
  geometry: IsosurfaceGeometry;
  color: string;
  opacity: number;
}

/* Points drawn inside a volume, at coordinates along its x, y and z axes (cf. `AxisValues`; voxel
 * indices along evenly spaced axes without values) */
export interface VolumePointSet {
  x: NumArray;
  y: NumArray;
  z: NumArray;
  values?: NumArray; // color each point with the volume's color map, scale and domain...
  color?: string; // ... or with a CSS color
  size?: number; // diameter in CSS pixels
}

/* Coordinates of voxels along x, y and z (`undefined`: evenly spaced) */
export type AxisValues = [
  x: NumArray | undefined,
  y: NumArray | undefined,
  z: NumArray | undefined,
];

/* Voxel indices along x, y and z (i.e. column, row and layer of dimensions `[z, y, x]`) */
export type OrthoPoint = [x: number, y: number, z: number];
