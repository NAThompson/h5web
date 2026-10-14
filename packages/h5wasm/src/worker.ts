import { expose } from 'comlink';
// eslint-disable-next-line import-x/no-namespace -- `createWorkerApi` expects the whole module
import * as h5wasm from 'h5wasm';

import { createWorkerApi } from './worker-api';

const api = createWorkerApi(h5wasm);

export default api; // to allow testing in Node (without Web Worker)

if (import.meta.env.MODE !== 'test') {
  expose(api);
}
