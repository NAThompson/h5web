import {
  type ContourGeometry,
  type ContourLabelAnchor,
} from '../contours/marchingSquares';
import {
  type GridSpec,
  type MeshField,
  type UnstructuredMesh,
} from '../unstructured/resample';
import { type IsosurfaceGeometry } from '../volume/marchingCubes';

export type ScaleTypeParam = string | [string, number] | undefined;

export type DataValues = Float32Array | Float64Array;

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

/* Array registered in the worker once, then referred to by jobs by its ID */
export interface WorkerData {
  values: DataValues;
  shape: number[];
  axisValues?: AxisCoords; // 3D only
}

export type WorkerRequest =
  | ({ type: 'setData'; dataId: number } & WorkerData)
  | { type: 'setMesh'; dataId: number; mesh: UnstructuredMesh } // split into tetrahedra once
  | { type: 'releaseData'; dataId: number }
  | {
      type: 'isosurface';
      jobId: number;
      dataId: number;
      level: number;
      scaleType: ScaleTypeParam;
      step: number;
    }
  | {
      type: 'contours';
      jobId: number;
      dataId: number;
      levels: number[];
      scaleType: ScaleTypeParam;
      labels: LabelOptions | undefined;
    }
  | {
      type: 'resample';
      jobId: number;
      dataId: number;
      field: MeshField;
      grid: GridSpec;
    }
  | { type: 'cancel'; jobId: number };

export type JobResponse =
  | { type: 'progress'; jobId: number; progress: number }
  | { type: 'isosurface'; jobId: number; geometry: IsosurfaceGeometry }
  | { type: 'contours'; jobId: number; contours: ContourResult[] }
  | {
      type: 'resampled';
      jobId: number;
      values: Float32Array<ArrayBuffer>;
      coverage: Uint8Array<ArrayBuffer>;
    }
  | { type: 'error'; jobId: number; message: string };

export type WorkerResponse = { type: 'ready' } | JobResponse;
