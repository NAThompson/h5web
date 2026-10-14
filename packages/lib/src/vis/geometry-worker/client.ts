/// <reference types="vite/client" />
import { type IsosurfaceGeometry } from '../volume/marchingCubes';
import {
  type ContourResult,
  type WorkerData,
  type WorkerRequest,
  type WorkerResponse,
} from './models';
import GeometryWorker from './worker?worker&inline';

/* Thrown when the worker can't be started (e.g. blocked by a Content Security Policy) or crashes */
export class WorkerError extends Error {
  public constructor(
    message: string,
    public readonly isLoadFailure: boolean,
  ) {
    super(message);
    this.name = 'WorkerError';
  }
}

interface PendingJob {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: number) => void;
}

export interface WorkerTask<T> {
  promise: Promise<T>;
  cancel: () => void;
}

type WorkerFactory = () => Worker;

function createDefaultWorker(): Worker {
  return new GeometryWorker();
}

let createWorker: WorkerFactory = createDefaultWorker;
let worker: Worker | undefined;
let isReady = false;
let loadFailure: WorkerError | undefined;
let generation = 0;
let nextId = 1;

const pending = new Map<number, PendingJob>();
const dataGenerations = new Map<number, number>(); // generation of the worker that holds each data array
const listeners = new Set<() => void>();

export function getNextId(): number {
  const id = nextId;
  nextId += 1;
  return id;
}

/* Incremented whenever the worker fails, so that hooks know to send their data again */
export function getWorkerGeneration(): number {
  return generation;
}

export function subscribeWorker(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* The worker could not be started at all: callers should fall back to the main thread */
export function getWorkerLoadFailure(): WorkerError | undefined {
  return loadFailure;
}

function handleFailure(reason: string): void {
  const error = isReady
    ? new WorkerError(`Background worker crashed (${reason})`, false)
    : new WorkerError(`Background worker could not start (${reason})`, true);

  const jobs = [...pending.values()];
  pending.clear();
  for (const job of jobs) {
    job.reject(error);
  }

  worker?.terminate();
  worker = undefined;
  if (!isReady) {
    loadFailure = error; // don't retry: the environment doesn't allow the worker
  }
  isReady = false;
  dataGenerations.clear();
  generation += 1;
  for (const listener of listeners) {
    listener();
  }
}

function handleMessage(evt: MessageEvent<WorkerResponse>): void {
  const msg = evt.data;
  if (msg.type === 'ready') {
    isReady = true;
    return;
  }

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
}

function getWorker(): Worker {
  if (loadFailure) {
    throw loadFailure;
  }

  if (!worker) {
    try {
      worker = createWorker();
    } catch (error) {
      loadFailure = new WorkerError(
        `Background worker could not start (${error instanceof Error ? error.message : 'unknown error'})`,
        true,
      );
      throw loadFailure;
    }

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', (evt) => {
      evt.preventDefault();
      handleFailure(evt.message || 'failed to load or run');
    });
    worker.addEventListener('messageerror', () => {
      handleFailure('message could not be deserialized');
    });
  }

  return worker;
}

function post(msg: WorkerRequest, transfer: Transferable[] = []): void {
  getWorker().postMessage(msg, transfer);
}

function startJob<T>(
  msg: WorkerRequest & { jobId: number; dataId: number },
  onProgress?: (progress: number) => void,
): WorkerTask<T> {
  const { jobId, dataId } = msg;

  if (dataGenerations.get(dataId) !== generation) {
    return {
      promise: Promise.reject(
        new WorkerError('Data is no longer available in the worker', false),
      ),
      cancel: () => {},
    };
  }

  const promise = new Promise<T>((resolve, reject) => {
    pending.set(jobId, { resolve, reject, onProgress });
  });

  try {
    post(msg);
  } catch (error) {
    pending.delete(jobId);
    return {
      promise: Promise.reject(
        error instanceof Error ? error : new Error('Failed to post job'),
      ),
      cancel: () => {},
    };
  }

  return {
    promise,
    cancel: () => {
      if (pending.delete(jobId) && worker) {
        post({ type: 'cancel', jobId });
      }
    },
  };
}

/* Register an array in the worker; `values` is transferred (i.e. no longer usable afterwards). Throws `WorkerError`. */
export function setWorkerData(data: WorkerData): number {
  const dataId = getNextId();
  post({ type: 'setData', dataId, ...data }, [data.values.buffer]);
  dataGenerations.set(dataId, generation);
  return dataId;
}

export function releaseWorkerData(dataId: number): void {
  if (dataGenerations.delete(dataId) && worker) {
    post({ type: 'releaseData', dataId });
  }
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
    onProgress,
  );
}

export function requestContours(
  params: Omit<Extract<WorkerRequest, { type: 'contours' }>, 'type' | 'jobId'>,
  onProgress?: (progress: number) => void,
): WorkerTask<ContourResult[]> {
  return startJob(
    { type: 'contours', jobId: getNextId(), ...params },
    onProgress,
  );
}

/* For tests: replace the worker (e.g. with one that fails), and forget previous failures */
export function resetGeometryWorker(factory?: WorkerFactory): void {
  worker?.terminate();
  worker = undefined;
  isReady = false;
  loadFailure = undefined;
  pending.clear();
  dataGenerations.clear();
  generation += 1;
  createWorker = factory ?? createDefaultWorker;
  for (const listener of listeners) {
    listener();
  }
}
