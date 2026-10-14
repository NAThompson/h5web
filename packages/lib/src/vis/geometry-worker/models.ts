import {
  type ContourGeometry,
  type ContourLabelAnchor,
} from '../contours/marchingSquares';
import { type IsosurfaceGeometry } from '../volume/marchingCubes';

export type ScaleTypeParam = string | [string, number] | undefined;

export type AxisCoords = [
  x: Float64Array | undefined,
  y: Float64Array | undefined,
  z: Float64Array | undefined,
];

export interface LabelOptions {
  minLength: number;
  spacing: number;
  maxCount: number;
}

export interface ContourResult extends ContourGeometry {
  labels: ContourLabelAnchor[];
}

export type WorkerRequest =
  | {
      type: 'setVolume';
      volumeId: number;
      values: Float32Array;
      shape: [number, number, number];
      axisValues: AxisCoords;
    }
  | { type: 'releaseVolume'; volumeId: number }
  | {
      type: 'isosurface';
      jobId: number;
      volumeId: number;
      level: number;
      scaleType: ScaleTypeParam;
      step: number;
    }
  | {
      type: 'contours';
      jobId: number;
      values: Float64Array;
      shape: [number, number];
      levels: number[];
      scaleType: ScaleTypeParam;
      labels: LabelOptions | undefined;
    }
  | { type: 'cancel'; jobId: number };

export type WorkerResponse =
  | { type: 'progress'; jobId: number; progress: number }
  | { type: 'isosurface'; jobId: number; geometry: IsosurfaceGeometry }
  | { type: 'contours'; jobId: number; contours: ContourResult[] }
  | { type: 'error'; jobId: number; message: string };
