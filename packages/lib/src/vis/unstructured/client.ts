import {
  getWorkerGeneration,
  releaseWorkerData,
  requestResample,
  setWorkerMesh,
  WorkerError,
} from '../geometry-worker/client';
import {
  getCoverage,
  type GridSpec,
  type MeshField,
  type ResampledValues,
  resampleMesh,
  type UnstructuredMesh,
} from './resample';

interface MeshEntry {
  key: WeakRef<object>;
  dataId: number;
  generation: number;
  jobs: number; // requests not settled yet
}

// Only the last mesh is kept in the worker (and previous ones until their requests settle),
// so that other fields are resampled without sending and splitting it again
let current: MeshEntry | undefined;

function releaseIfUnused(entry: MeshEntry): void {
  if (entry !== current && entry.jobs === 0) {
    releaseWorkerData(entry.dataId);
  }
}

/* Resample a field of a mesh onto a grid in the geometry worker, or on the main thread if
 * the worker can't start (e.g. blocked by a Content Security Policy). `key` identifies the
 * mesh by reference (e.g. its fetched points), and `getMesh` returns the mesh only when it
 * isn't in the worker already. */
export async function resampleMeshInWorker(
  ...args: Parameters<typeof resampleMeshWithCoverage>
): Promise<Float32Array<ArrayBuffer>> {
  const { values } = await resampleMeshWithCoverage(...args);
  return values;
}

/* Same as `resampleMeshInWorker`, with the coverage of the samples (cf. `getCoverage`) */
export async function resampleMeshWithCoverage(
  key: object,
  getMesh: () => UnstructuredMesh,
  field: MeshField,
  grid: GridSpec,
  signal?: AbortSignal,
): Promise<ResampledValues> {
  let entry: MeshEntry | undefined;
  try {
    signal?.throwIfAborted();
    const generation = getWorkerGeneration();
    if (current?.key.deref() !== key || current.generation !== generation) {
      const previous = current;
      current = {
        key: new WeakRef(key),
        dataId: setWorkerMesh(getMesh()),
        generation,
        jobs: 0,
      };
      if (previous) {
        releaseIfUnused(previous);
      }
    }

    entry = current;
    entry.jobs += 1;
    const task = requestResample({ dataId: entry.dataId, field, grid });
    const aborted = new Promise<never>((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        task.cancel(); // e.g. resolution changed meanwhile
        reject(new Error('Resampling aborted'));
      });
    });
    return await Promise.race([task.promise, aborted]);
  } catch (error) {
    if (error instanceof WorkerError && error.isLoadFailure) {
      const values = resampleMesh(getMesh(), field, grid);
      return { values, coverage: getCoverage(values, grid.shape) };
    }
    throw error;
  } finally {
    if (entry) {
      entry.jobs -= 1;
      releaseIfUnused(entry);
    }
  }
}
