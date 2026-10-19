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

/* Coordinates of voxels along x, y and z (`undefined`: evenly spaced) */
export type AxisValues = [
  x: NumArray | undefined,
  y: NumArray | undefined,
  z: NumArray | undefined,
];

/* Voxel indices along x, y and z (i.e. column, row and layer of dimensions `[z, y, x]`) */
export type OrthoPoint = [x: number, y: number, z: number];
