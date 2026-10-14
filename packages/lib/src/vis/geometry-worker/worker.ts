/* Web worker extracting contour lines and isosurfaces off the main thread.
 * Jobs run one at a time, in slices, so that cancellations sent while a job runs are honoured. */

import { contoursSteps, isosurfaceSteps } from './jobs';
import {
  type AxisCoords,
  type WorkerRequest,
  type WorkerResponse,
} from './models';

interface Volume {
  values: Float32Array;
  shape: [number, number, number];
  axisValues: AxisCoords;
}

interface Job {
  jobId: number;
  run: () => Generator<number, WorkerResponse>;
}

const SLICE_DURATION = 30; // ms between checks for incoming messages
const PROGRESS_INTERVAL = 100; // ms between progress reports

const volumes = new Map<number, Volume>();
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

function getTransferables(msg: WorkerResponse): Transferable[] {
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

globalThis.addEventListener('message', (evt: MessageEvent<WorkerRequest>) => {
  const msg = evt.data;

  switch (msg.type) {
    case 'setVolume': {
      const { volumeId, values, shape, axisValues } = msg;
      volumes.set(volumeId, { values, shape, axisValues });
      break;
    }

    case 'releaseVolume':
      volumes.delete(msg.volumeId);
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
      const { jobId, volumeId, level, scaleType, step } = msg;
      queue.push({
        jobId,
        *run() {
          const volume = volumes.get(volumeId);
          if (!volume) {
            throw new Error('Volume no longer available');
          }
          const { values, shape, axisValues } = volume;
          const geometry = yield* isosurfaceSteps(
            values,
            shape,
            axisValues,
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
      const { jobId, values, shape, levels, scaleType, labels } = msg;
      queue.push({
        jobId,
        *run() {
          const contours = yield* contoursSteps(
            values,
            shape,
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
});
