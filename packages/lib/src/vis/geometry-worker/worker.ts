/* Web worker extracting contour lines and isosurfaces off the main thread.
 * Arrays are registered once and referred to by ID; jobs run one at a time, in slices,
 * so that cancellations sent while a job runs are honoured. */

import { contoursSteps, isosurfaceSteps } from './jobs';
import {
  type JobResponse,
  type WorkerData,
  type WorkerRequest,
  type WorkerResponse,
} from './models';

interface Job {
  jobId: number;
  run: () => Generator<number, JobResponse>;
}

const SLICE_DURATION = 30; // ms between checks for incoming messages
const PROGRESS_INTERVAL = 100; // ms between progress reports

const dataArrays = new Map<number, WorkerData>();
const queue: Job[] = [];
const cancelled = new Set<number>();
let isRunning = false;
let runningJobId: number | undefined;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  globalThis.postMessage(msg, { transfer });
}

async function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function getTransferables(msg: JobResponse): Transferable[] {
  if (msg.type === 'isosurface') {
    const { positions, normals, gradients, indices } = msg.geometry;
    return [positions, normals, gradients, indices].map((arr) => arr.buffer);
  }
  if (msg.type === 'contours') {
    return msg.contours.flatMap(({ vertices, segments }) => [
      vertices.buffer,
      segments.buffer,
    ]);
  }
  return [];
}

function getData(dataId: number, rank: number): WorkerData {
  const data = dataArrays.get(dataId);
  if (!data) {
    throw new Error('Data no longer available');
  }
  if (data.shape.length !== rank) {
    throw new Error(`Expected ${rank}D data`);
  }
  return data;
}

async function processQueue(): Promise<void> {
  if (isRunning) {
    return;
  }
  isRunning = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      continue;
    }
    runningJobId = job.jobId;

    try {
      const gen = job.run();
      let sliceStart = performance.now();
      let lastProgress = sliceStart;
      let res = gen.next();
      let isCancelled = false;

      while (!res.done && !isCancelled) {
        const now = performance.now();
        if (now - lastProgress > PROGRESS_INTERVAL) {
          post({ type: 'progress', jobId: job.jobId, progress: res.value });
          lastProgress = now;
        }
        if (now - sliceStart > SLICE_DURATION) {
          await yieldToEventLoop(); // eslint-disable-line no-await-in-loop
          sliceStart = performance.now();
          isCancelled = cancelled.delete(job.jobId);
        }
        if (!isCancelled) {
          res = gen.next();
        }
      }

      if (!isCancelled && res.done) {
        post(res.value, getTransferables(res.value));
      }
    } catch (error) {
      post({
        type: 'error',
        jobId: job.jobId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  runningJobId = undefined;
  cancelled.clear();
  isRunning = false;
}

export function handleRequest(msg: WorkerRequest): void {
  switch (msg.type) {
    case 'setData': {
      const { dataId, values, shape, axisValues } = msg;
      dataArrays.set(dataId, { values, shape, axisValues });
      break;
    }

    case 'releaseData':
      dataArrays.delete(msg.dataId);
      break;

    case 'cancel': {
      const index = queue.findIndex((job) => job.jobId === msg.jobId);
      if (index !== -1) {
        queue.splice(index, 1);
      } else if (msg.jobId === runningJobId) {
        cancelled.add(msg.jobId);
      }
      break;
    }

    case 'isosurface': {
      const { jobId, dataId, level, scaleType, step } = msg;
      queue.push({
        jobId,
        *run() {
          const { values, shape, axisValues } = getData(dataId, 3);
          const geometry = yield* isosurfaceSteps(
            values,
            shape as [number, number, number],
            axisValues ?? [undefined, undefined, undefined],
            level,
            scaleType,
            step,
          );
          return { type: 'isosurface', jobId, geometry };
        },
      });
      void processQueue();
      break;
    }

    case 'contours': {
      const { jobId, dataId, levels, scaleType, labels } = msg;
      queue.push({
        jobId,
        *run() {
          const { values, shape } = getData(dataId, 2);
          const contours = yield* contoursSteps(
            values,
            shape as [number, number],
            levels,
            scaleType,
            labels,
          );
          return { type: 'contours', jobId, contours };
        },
      });
      void processQueue();
      break;
    }

    default:
  }
}

/* Testing seam: lets the protocol run in-process with any `postMessage` */
export function getWorkerState(): { queued: number; dataCount: number } {
  return { queued: queue.length, dataCount: dataArrays.size };
}

if ('WorkerGlobalScope' in globalThis) {
  globalThis.addEventListener('message', (evt: MessageEvent<WorkerRequest>) => {
    handleRequest(evt.data);
  });
  post({ type: 'ready' });
}
