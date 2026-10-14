/// <reference types="vite/client" />
import { type Bounds } from '@h5web/shared/vis-models';

import {
  getFloat32Bounds,
  getHalfFloatNormalization,
  mergeBounds,
} from './utils';
import {
  type PrepareRequest,
  type PrepareResponse,
  processChunk,
} from './worker';
import PrepareWorker from './worker?worker&inline';

/*
 * Large `Float32Array` volumes are prepared for rendering in a few workers: bounds (for the
 * domain) and, if the volume is too large to be uploaded as 32-bit floats, normalized half
 * floats. This takes a fraction of the time the main thread would take (e.g. under a second
 * instead of ~4s for 1.8 GB), even though workers must be sent a copy of the volume.
 *
 * The volume is split into chunks of whole slices, which are handed out to workers as they
 * become available. Half floats are kept in chunks, which are uploaded to the GPU one after
 * the other, rather than assembled into another large array.
 */

export const MIN_WORKER_VALUES = 2 ** 24; // smaller volumes are prepared on the main thread
export const MAX_FLOAT_TEXTURE_BYTES = 2 ** 30; // Chromium caps textures at 1 GiB
const CHUNK_VALUES = 2 ** 23; // 32 MB of float32
const MAX_WORKERS = 6;
const MAX_PENDING_CHUNKS = 2; // per worker, so workers don't wait for the next chunk to be copied

export interface HalfFloatChunk {
  start: number; // index of first slice
  values: Uint16Array<ArrayBuffer>; // whole slices
}

export interface PreparedHalfFloats {
  chunks: HalfFloatChunk[];
  offset: number;
  scale: number;
}

export interface PreparedVolume {
  bounds: Bounds | undefined; // of finite values, as `getBounds` without `ignoreValue`
  halfFloats?: PreparedHalfFloats; // released once uploaded (cf. `releasePreparedHalfFloats`)
}

const EMPTY_BUFFER = new ArrayBuffer(0);

async function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
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

/* Same promise for the same array, e.g. for React's `use` (so not an async function).
 * `sliceLength` is the number of values per slice along the first dimension. */
// eslint-disable-next-line @typescript-eslint/promise-function-async
export function prepareVolume(
  data: Float32Array,
  sliceLength: number,
): Promise<PreparedVolume> {
  let promise = preparations.get(data);
  if (!promise) {
    promise = runPreparation(data, sliceLength);
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
 * as long as `data` (they are prepared again by `VolumeMesh` if needed) */
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

async function runPreparation(
  data: Float32Array,
  sliceLength: number,
): Promise<PreparedVolume> {
  const withHalfFloats = shouldPrepareHalfFloats(data);

  let result: PreparedVolume;
  try {
    result = await prepareInWorkers(data, sliceLength, withHalfFloats);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not prepare volume in workers:', error);
    result = { bounds: getFloat32Bounds(data) }; // half floats are then computed by `VolumeMesh`
  }

  results.set(data, result);
  return result;
}

/* Worker with requests matched to responses by ID */
class WorkerHandle {
  private readonly worker = createWorker();
  private readonly pending = new Map<
    number,
    {
      resolve: (response: PrepareResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  public constructor() {
    this.worker.addEventListener(
      'message',
      (evt: MessageEvent<PrepareResponse>) => {
        const { id } = evt.data;
        const job = this.pending.get(id);
        this.pending.delete(id);
        if (evt.data.type === 'error') {
          job?.reject(new Error(evt.data.message));
        } else {
          job?.resolve(evt.data);
        }
      },
    );

    this.worker.addEventListener('error', (evt) => {
      for (const job of this.pending.values()) {
        job.reject(new Error(evt.message || 'Worker failed'));
      }
      this.pending.clear();
    });
  }

  public async request(
    msg: PrepareRequest,
    transfer: Transferable[] = [],
  ): Promise<PrepareResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(msg.id, { resolve, reject });
      this.worker.postMessage(msg, transfer);
    });
  }

  public terminate(): void {
    this.worker.terminate();
  }
}

async function prepareInWorkers(
  data: Float32Array,
  sliceLength: number,
  withHalfFloats: boolean,
): Promise<PreparedVolume> {
  const chunkLength =
    Math.max(1, Math.floor(CHUNK_VALUES / sliceLength)) * sliceLength;
  const chunkCount = Math.ceil(data.length / chunkLength);
  const cores =
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, cores - 2, chunkCount));
  const handles = Array.from({ length: workerCount }, () => new WorkerHandle());

  /* Send chunks to workers as they become available (so slower cores get fewer chunks),
   * keeping a couple of chunks in flight per worker so they don't wait for the next copy.
   * Only chunks in flight are copied at any time, so memory use stays bounded. Copying a
   * chunk takes about as long as processing it, so the main thread also processes chunks
   * itself in between (yielding after each one to stay responsive). */
  async function processChunks<T>(
    makeRequest: (id: number, buffer: ArrayBuffer) => PrepareRequest,
    onResponse: (id: number, response: PrepareResponse) => T,
  ): Promise<T[]> {
    const outputs: T[] = [];
    let next = 0;

    async function processOnMainThread(): Promise<void> {
      while (next < chunkCount) {
        const id = next;
        next += 1;

        const chunk = data.subarray(id * chunkLength, (id + 1) * chunkLength);
        const request = makeRequest(id, EMPTY_BUFFER);
        outputs[id] = onResponse(id, processChunk(request, chunk));
        await yieldToMain(); // eslint-disable-line no-await-in-loop
      }
    }

    await Promise.all([
      processOnMainThread(),
      ...handles.flatMap((handle) =>
        Array.from({ length: MAX_PENDING_CHUNKS }, async () => {
          while (next < chunkCount) {
            const id = next;
            next += 1;

            const { buffer } = data.slice(
              id * chunkLength,
              (id + 1) * chunkLength,
            );
            // eslint-disable-next-line no-await-in-loop -- one chunk at a time per loop
            const response = await handle.request(makeRequest(id, buffer), [
              buffer,
            ]);
            outputs[id] = onResponse(id, response);
          }
        }),
      ),
    ]);
    return outputs;
  }

  try {
    const bounds = mergeBounds(
      await processChunks(
        (id, buffer) => ({ type: 'bounds', id, buffer }),
        (_, response) =>
          response.type === 'bounds' ? response.bounds : undefined,
      ),
    );

    if (!withHalfFloats) {
      return { bounds };
    }

    const normalization = getHalfFloatNormalization(bounds);
    const chunks = await processChunks(
      (id, buffer) => ({ type: 'halfFloats', id, buffer, normalization }),
      (id, response): HalfFloatChunk => {
        if (response.type !== 'halfFloats') {
          throw new Error('Unexpected response');
        }
        return {
          start: (id * chunkLength) / sliceLength,
          values: new Uint16Array(response.buffer),
        };
      },
    );

    return { bounds, halfFloats: { chunks, ...normalization } };
  } finally {
    for (const handle of handles) {
      handle.terminate();
    }
  }
}
