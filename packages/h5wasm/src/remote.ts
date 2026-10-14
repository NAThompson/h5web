import { type Endpoint, type Remote, wrap } from 'comlink';

import LocalWorker from './worker?worker&inline';
import { type H5WasmWorkerAPI } from './worker-api';

const remotes = new Map<boolean, Remote<H5WasmWorkerAPI>>();

export function getH5WasmRemote(wasm64 = false): Remote<H5WasmWorkerAPI> {
  let remote = remotes.get(wasm64);

  if (!remote) {
    remote = wrap<H5WasmWorkerAPI>(
      wasm64 ? createWasm64Endpoint() : new LocalWorker(),
    );
    remotes.set(wasm64, remote);
  }

  return remote;
}

/* The wasm64 worker embeds a second copy of HDF5, so load it on demand (separate chunk).
 * Every call awaits the same promise, so the order of messages is preserved. */
function createWasm64Endpoint(): Endpoint {
  const workerReady = loadWasm64Worker();

  return {
    postMessage: (message: unknown, transfer?: Transferable[]) => {
      void (async () => {
        const worker = await workerReady;
        worker.postMessage(message, transfer ?? []);
      })();
    },
    addEventListener: (type, listener, options) => {
      void (async () => {
        const worker = await workerReady;
        worker.addEventListener(type, listener, options);
      })();
    },
    removeEventListener: (type, listener, options) => {
      void (async () => {
        const worker = await workerReady;
        worker.removeEventListener(type, listener, options);
      })();
    },
  };
}

async function loadWasm64Worker(): Promise<Worker> {
  const { default: Wasm64Worker } = await import('./worker64?worker&inline');
  return new Wasm64Worker();
}
