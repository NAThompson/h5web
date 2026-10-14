import { expose } from 'comlink';
// eslint-disable-next-line import-x/no-namespace -- `createWorkerApi` expects the whole module
import * as h5wasm from 'h5wasm/wasm64';

import { createWorkerApi } from './worker-api';

expose(createWorkerApi(h5wasm));
