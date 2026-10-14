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
