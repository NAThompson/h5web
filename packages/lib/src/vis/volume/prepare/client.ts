/// <reference types="vite/client" />
import { type Bounds } from '@h5web/shared/vis-models';

import {
  getFloat32Bounds,
  type HalfFloatNormalization,
  mergeBounds,
  toHalfFloatBits,
} from './utils';
import {
  type PrepareRequest,
  type PrepareResponse,
  processChunk,
} from './worker';
import PrepareWorker from './worker?worker&inline';

/*
 * Large `Float32Array` volumes are prepared for rendering in a few workers: bounds (for the
 * domain, cf. `prepareVolume`) and, only if the volume is too large to be uploaded as 32-bit
 * floats, normalized half floats (cf. `convertToHalfFloats`). This takes a fraction of the time
 * the main thread would take, even though workers must be sent a copy of the volume.
 *
 * The volume is split into chunks of whole slices, which are handed out to workers as they
 * become available. Half floats are returned in chunks, to be uploaded to the GPU one after
 * the other rather than assembled into another large array.
 */

export const MIN_WORKER_VALUES = 2 ** 24; // smaller volumes are prepared on the main thread
const CHUNK_VALUES = 2 ** 23; // 32 MB of float32
const MAX_WORKERS = 6;
const MAX_PENDING_CHUNKS = 2; // per worker, so workers don't wait for the next chunk to be copied

export interface HalfFloatChunk {
  start: number; // index of first slice
  values: Uint16Array<ArrayBuffer>; // whole slices
}

export interface PreparedVolume {
  bounds: Bounds | undefined; // of finite values, as `getBounds` without `ignoreValue`
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

// Chunks depend on the slice length, so the same array prepared for another shape is prepared again
const preparations = new WeakMap<
  Float32Array,
  { sliceLength: number; promise: Promise<PreparedVolume> }
>();
const results = new WeakMap<
  Float32Array,
  { sliceLength: number; result: PreparedVolume }
>();

/* Bounds of a volume, computed in workers. Same promise for the same array, e.g. for React's
 * `use` (so not an async function). `sliceLength` is the number of values per slice along
 * the first dimension. */
// eslint-disable-next-line @typescript-eslint/promise-function-async
export function prepareVolume(
  data: Float32Array,
  sliceLength: number,
): Promise<PreparedVolume> {
  const preparation = preparations.get(data);
  if (preparation?.sliceLength === sliceLength) {
    return preparation.promise;
  }

  const promise = runPreparation(data, sliceLength);
  preparations.set(data, { sliceLength, promise });
  return promise;
}

/* Result of `prepareVolume`, if it has resolved */
export function getPreparedVolume(
  data: Float32Array,
  sliceLength: number,
): PreparedVolume | undefined {
  const entry = results.get(data);
  return entry?.sliceLength === sliceLength ? entry.result : undefined;
}

async function runPreparation(
  data: Float32Array,
  sliceLength: number,
): Promise<PreparedVolume> {
  let bounds: Bounds | undefined;
  try {
    bounds = mergeBounds(
      await processInWorkers(
        data,
        sliceLength,
        (id, buffer) => ({ type: 'bounds', id, buffer }),
        (_, response) =>
          response.type === 'bounds' ? response.bounds : undefined,
      ),
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not compute bounds of volume in workers:', error);
    bounds = getFloat32Bounds(data);
  }

  const result = { bounds };
  results.set(data, { sliceLength, result });
  return result;
}

/* Convert a volume to normalized half floats in workers (on the main thread if they fail),
 * in chunks of whole slices. Nothing is cached: chunks are only referenced by the caller. */
export async function convertToHalfFloats(
  data: Float32Array,
  sliceLength: number,
  normalization: HalfFloatNormalization,
  signal?: AbortSignal,
): Promise<HalfFloatChunk[]> {
  const chunkLength = getChunkLength(sliceLength);
  function toChunk(id: number, buffer: ArrayBuffer): HalfFloatChunk {
    return {
      start: (id * chunkLength) / sliceLength,
      values: new Uint16Array(buffer),
    };
  }

  try {
    return await processInWorkers(
      data,
      sliceLength,
      (id, buffer) => ({ type: 'halfFloats', id, buffer, normalization }),
      (id, response) => {
        if (response.type !== 'halfFloats') {
          throw new Error('Unexpected response');
        }
        return toChunk(id, response.buffer);
      },
      signal,
    );
  } catch (error) {
    signal?.throwIfAborted();

    // eslint-disable-next-line no-console
    console.warn('Could not convert volume in workers:', error);
    const chunks: HalfFloatChunk[] = [];
    for (let start = 0; start < data.length; start += chunkLength) {
      const chunk = data.subarray(start, start + chunkLength);
      chunks.push(
        toChunk(
          start / chunkLength,
          toHalfFloatBits(chunk, normalization).buffer,
        ),
      );
    }
    return chunks;
  }
}

function getChunkLength(sliceLength: number): number {
  return Math.max(1, Math.floor(CHUNK_VALUES / sliceLength)) * sliceLength;
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

/* Process chunks of whole slices in a pool of workers, handing out chunks as workers become
 * available (so slower cores get fewer chunks) and keeping a couple of chunks in flight per
 * worker so they don't wait for the next copy. Only chunks in flight are copied at any time,
 * so memory use stays bounded. Copying a chunk takes about as long as processing it, so the
 * main thread also processes chunks itself in between (yielding after each one to stay
 * responsive). Everything stops as soon as one chunk fails or `signal` is aborted. */
async function processInWorkers<T>(
  data: Float32Array,
  sliceLength: number,
  makeRequest: (id: number, buffer: ArrayBuffer) => PrepareRequest,
  onResponse: (id: number, response: PrepareResponse) => T,
  signal?: AbortSignal,
): Promise<T[]> {
  const chunkLength = getChunkLength(sliceLength);
  const chunkCount = Math.ceil(data.length / chunkLength);
  const cores =
    typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4;
  const workerCount = Math.max(1, Math.min(MAX_WORKERS, cores - 2, chunkCount));

  const handles: WorkerHandle[] = [];
  const outputs: T[] = [];
  let next = 0;
  let stopped = false;

  function nextChunk(): number | undefined {
    if (stopped || signal?.aborted || next >= chunkCount) {
      return undefined;
    }
    next += 1;
    return next - 1;
  }

  async function guard(loop: () => Promise<void>): Promise<void> {
    try {
      await loop();
    } catch (error) {
      stopped = true; // stop other loops, including the main thread's
      throw error;
    }
  }

  async function processOnMainThread(): Promise<void> {
    for (let id = nextChunk(); id !== undefined; id = nextChunk()) {
      const chunk = data.subarray(id * chunkLength, (id + 1) * chunkLength);
      outputs[id] = onResponse(
        id,
        processChunk(makeRequest(id, EMPTY_BUFFER), chunk),
      );
      await yieldToMain(); // eslint-disable-line no-await-in-loop
    }
  }

  async function processInWorker(handle: WorkerHandle): Promise<void> {
    for (let id = nextChunk(); id !== undefined; id = nextChunk()) {
      const { buffer } = data.slice(id * chunkLength, (id + 1) * chunkLength);
      // eslint-disable-next-line no-await-in-loop -- one chunk at a time per loop
      const response = await handle.request(makeRequest(id, buffer), [buffer]);
      outputs[id] = onResponse(id, response);
    }
  }

  try {
    for (let i = 0; i < workerCount; i += 1) {
      handles.push(new WorkerHandle()); // inside `try`, to terminate workers if one fails to start
    }

    await Promise.all([
      guard(processOnMainThread),
      ...handles.flatMap((handle) =>
        Array.from({ length: MAX_PENDING_CHUNKS }, async () =>
          guard(async () => processInWorker(handle)),
        ),
      ),
    ]);

    signal?.throwIfAborted();
    return outputs;
  } finally {
    stopped = true;
    for (const handle of handles) {
      handle.terminate();
    }
  }
}
