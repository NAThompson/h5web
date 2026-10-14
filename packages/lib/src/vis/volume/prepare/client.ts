/// <reference types="vite/client" />
import { type Bounds } from '@h5web/shared/vis-models';

import {
  getFloat32Bounds,
  getHalfFloatNormalization,
  mergeBounds,
} from './utils';
import { type PrepareRequest, type PrepareResponse } from './worker';
import PrepareWorker from './worker?worker&inline';

/*
 * Large `Float32Array` volumes are prepared for rendering in a few workers: bounds (for the
 * domain) and, if the volume is too large to be uploaded as 32-bit floats, normalized half
 * floats. This takes a fraction of the time the main thread would take (e.g. 0.4s instead of
 * 3s for 1.8 GB), even though each worker must be sent a copy of its part of the volume.
 */

export const MIN_WORKER_VALUES = 2 ** 24; // smaller volumes are prepared on the main thread
export const MAX_FLOAT_TEXTURE_BYTES = 2 ** 30; // Chromium caps textures at 1 GiB
const MAX_WORKERS = 8;

export interface PreparedHalfFloats {
  values: Uint16Array;
  offset: number;
  scale: number;
}

export interface PreparedVolume {
  bounds: Bounds | undefined; // of finite values, as `getBounds` without `ignoreValue`
  halfFloats?: PreparedHalfFloats; // released once uploaded (cf. `releasePreparedHalfFloats`)
}

type WorkerFactory = () => Worker;
function createDefaultWorker(): Worker {
  return new PrepareWorker();
}

let createWorker: WorkerFactory = createDefaultWorker;

/* For tests */
export function setPrepareWorkerFactory(factory: WorkerFactory): void {
  createWorker = factory;
}

const preparations = new WeakMap<Float32Array, Promise<PreparedVolume>>();
const results = new WeakMap<Float32Array, PreparedVolume>();

/* Same promise for the same array, e.g. for React's `use` (so not an async function) */
// eslint-disable-next-line @typescript-eslint/promise-function-async
export function prepareVolume(data: Float32Array): Promise<PreparedVolume> {
  let promise = preparations.get(data);
  if (!promise) {
    promise = runPreparation(data);
    preparations.set(data, promise);
  }
  return promise;
}

/* Half floats prepared for `data`, if any (synchronous, once `prepareVolume` has resolved) */
export function getPreparedHalfFloats(
  data: Float32Array,
): PreparedHalfFloats | undefined {
  return results.get(data)?.halfFloats;
}

/* Drop prepared half floats (e.g. once uploaded to the GPU), so they don't stay in memory
 * as long as `data` (they are prepared again if needed) */
export function releasePreparedHalfFloats(data: Float32Array): void {
  const result = results.get(data);
  if (result) {
    result.halfFloats = undefined; // same object as resolved by `prepareVolume`'s promise
  }
}

export function shouldPrepareHalfFloats(data: Float32Array): boolean {
  return (
    data.byteLength > MAX_FLOAT_TEXTURE_BYTES &&
    typeof Float16Array !== 'undefined'
  );
}

async function runPreparation(data: Float32Array): Promise<PreparedVolume> {
  const withHalfFloats = shouldPrepareHalfFloats(data);

  let result: PreparedVolume;
  try {
    result = await prepareInWorkers(data, withHalfFloats);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not prepare volume in workers:', error);
    result = { bounds: getFloat32Bounds(data) }; // half floats are then computed by `VolumeMesh`
  }

  results.set(data, result);
  return result;
}

function getWorkerCount(length: number): number {
  const cores =
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
  return Math.max(
    1,
    Math.min(MAX_WORKERS, cores - 2, Math.ceil(length / MIN_WORKER_VALUES)),
  );
}

async function request(
  worker: Worker,
  msg: PrepareRequest,
  transfer: Transferable[] = [],
): Promise<PrepareResponse> {
  return new Promise((resolve, reject) => {
    worker.addEventListener(
      'message',
      (evt: MessageEvent<PrepareResponse>) => {
        if (evt.data.type === 'error') {
          reject(new Error(evt.data.message));
        } else {
          resolve(evt.data);
        }
      },
      { once: true },
    );
    worker.addEventListener(
      'error',
      (evt) => {
        reject(new Error(evt.message || 'Worker failed'));
      },
      { once: true },
    );
    worker.postMessage(msg, transfer);
  });
}

async function prepareInWorkers(
  data: Float32Array,
  withHalfFloats: boolean,
): Promise<PreparedVolume> {
  const workerCount = getWorkerCount(data.length);
  const partLength = Math.ceil(data.length / workerCount);
  const starts = Array.from({ length: workerCount }, (_, i) => i * partLength);

  const workers: Worker[] = [];
  try {
    // Send each worker a copy of its part (copying the next part while the first ones are scanned)
    const boundsPromises = starts.map(async (start) => {
      const worker = createWorker();
      workers.push(worker);
      const { buffer } = data.slice(start, start + partLength);
      const response = await request(worker, { type: 'bounds', buffer }, [
        buffer,
      ]);
      return response.type === 'bounds' ? response.bounds : undefined;
    });
    const bounds = mergeBounds(await Promise.all(boundsPromises));

    if (!withHalfFloats) {
      return { bounds };
    }

    const normalization = getHalfFloatNormalization(bounds);
    const values = new Uint16Array(data.length);
    await Promise.all(
      workers.map(async (worker, i) => {
        const response = await request(worker, {
          type: 'halfFloats',
          normalization,
        });
        if (response.type !== 'halfFloats') {
          throw new Error('Unexpected response');
        }
        values.set(new Uint16Array(response.buffer), starts[i]);
      }),
    );

    return { bounds, halfFloats: { values, ...normalization } };
  } finally {
    for (const worker of workers) {
      worker.terminate();
    }
  }
}
