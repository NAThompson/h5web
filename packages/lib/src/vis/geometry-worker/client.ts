import { type IsosurfaceGeometry } from '../volume/marchingCubes';
import {
  type ContourResult,
  type WorkerRequest,
  type WorkerResponse,
} from './models';
import GeometryWorker from './worker?worker&inline';

interface PendingJob {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: number) => void;
}

export interface WorkerTask<T> {
  promise: Promise<T>;
  cancel: () => void;
}

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, PendingJob>();

function getWorker(): Worker {
  if (!worker) {
    worker = new GeometryWorker();
    worker.addEventListener('message', (evt: MessageEvent<WorkerResponse>) => {
      const msg = evt.data;
      const job = pending.get(msg.jobId);
      if (!job) {
        return; // cancelled
      }

      switch (msg.type) {
        case 'progress':
          job.onProgress?.(msg.progress);
          break;
        case 'error':
          pending.delete(msg.jobId);
          job.reject(new Error(msg.message));
          break;
        case 'isosurface':
          pending.delete(msg.jobId);
          job.resolve(msg.geometry as never);
          break;
        case 'contours':
          pending.delete(msg.jobId);
          job.resolve(msg.contours as never);
          break;
        default:
      }
    });
  }
  return worker;
}

function post(msg: WorkerRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(msg, transfer);
}

export function getNextId(): number {
  const id = nextId;
  nextId += 1;
  return id;
}

function startJob<T>(
  msg: WorkerRequest & { jobId: number },
  transfer: Transferable[],
  onProgress?: (progress: number) => void,
): WorkerTask<T> {
  const { jobId } = msg;
  const promise = new Promise<T>((resolve, reject) => {
    pending.set(jobId, {
      resolve,
      reject,
      onProgress,
    });
  });

  post(msg, transfer);

  return {
    promise,
    cancel: () => {
      if (pending.delete(jobId)) {
        post({ type: 'cancel', jobId });
      }
    },
  };
}

/* Send a volume to the worker once; `values` is transferred (i.e. no longer usable afterwards) */
export function setWorkerVolume(
  values: Float32Array,
  shape: [number, number, number],
  axisValues: Extract<WorkerRequest, { type: 'setVolume' }>['axisValues'],
): number {
  const volumeId = getNextId();
  post({ type: 'setVolume', volumeId, values, shape, axisValues }, [
    values.buffer,
  ]);
  return volumeId;
}

export function releaseWorkerVolume(volumeId: number): void {
  post({ type: 'releaseVolume', volumeId });
}

export function requestIsosurface(
  params: Omit<
    Extract<WorkerRequest, { type: 'isosurface' }>,
    'type' | 'jobId'
  >,
  onProgress?: (progress: number) => void,
): WorkerTask<IsosurfaceGeometry> {
  return startJob(
    { type: 'isosurface', jobId: getNextId(), ...params },
    [],
    onProgress,
  );
}

/* `values` is transferred */
export function requestContours(
  params: Omit<Extract<WorkerRequest, { type: 'contours' }>, 'type' | 'jobId'>,
  onProgress?: (progress: number) => void,
): WorkerTask<ContourResult[]> {
  return startJob(
    { type: 'contours', jobId: getNextId(), ...params },
    [params.values.buffer],
    onProgress,
  );
}
