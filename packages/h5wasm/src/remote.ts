import { type Remote, wrap } from 'comlink';

import LocalWorker from './worker?worker&inline';
import { type H5WasmWorkerAPI } from './worker-api';

const remotes = new Map<boolean, Remote<H5WasmWorkerAPI>>();

export function getH5WasmRemote(wasm64 = false): Remote<H5WasmWorkerAPI> {
  let remote = remotes.get(wasm64);

  if (!remote) {
    remote = wasm64
      ? createLazyRemote(loadWasm64Worker)
      : wrap<H5WasmWorkerAPI>(new LocalWorker());
    remotes.set(wasm64, remote);
  }

  return remote;
}

/* The wasm64 worker embeds a second copy of HDF5, so load it on demand (separate chunk).
 * If loading fails (e.g. chunk can't be fetched), API calls reject with the error so it can be
 * reported, and the next call tries again. */
export function createLazyRemote(
  loadWorker: () => Promise<Worker>,
): Remote<H5WasmWorkerAPI> {
  let remotePromise: Promise<Remote<H5WasmWorkerAPI>> | undefined;

  async function loadRemote(): Promise<Remote<H5WasmWorkerAPI>> {
    try {
      return wrap<H5WasmWorkerAPI>(await loadWorker());
    } catch (error) {
      remotePromise = undefined; // don't cache failure
      throw error;
    }
  }

  return new Proxy({} as Remote<H5WasmWorkerAPI>, {
    get(_, method) {
      if (typeof method !== 'string' || method === 'then') {
        return undefined; // not a thenable
      }

      return async (...args: unknown[]) => {
        remotePromise = remotePromise ?? loadRemote();
        const remote = (await remotePromise) as unknown as Record<
          string,
          (...params: unknown[]) => Promise<unknown>
        >;
        return remote[method](...args);
      };
    },
  });
}

async function loadWasm64Worker(): Promise<Worker> {
  const { default: Wasm64Worker } = await import('./worker64?worker&inline');
  return new Wasm64Worker();
}
