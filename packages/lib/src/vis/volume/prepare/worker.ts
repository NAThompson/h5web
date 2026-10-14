/* Web worker computing the bounds of a part of a volume and converting it to half floats */

import {
  getFloat32Bounds,
  type HalfFloatNormalization,
  toHalfFloatBits,
} from './utils';

export type PrepareRequest =
  | { type: 'bounds'; buffer: ArrayBuffer } // part of the volume (`Float32Array`), kept for `halfFloats`
  | { type: 'halfFloats'; normalization: HalfFloatNormalization };

export type PrepareResponse =
  | { type: 'bounds'; bounds: ReturnType<typeof getFloat32Bounds> }
  | { type: 'halfFloats'; buffer: ArrayBuffer }
  | { type: 'error'; message: string };

let part: Float32Array | undefined;

function post(msg: PrepareResponse, transfer: Transferable[] = []): void {
  globalThis.postMessage(msg, { transfer });
}

globalThis.addEventListener('message', (evt: MessageEvent<PrepareRequest>) => {
  const msg = evt.data;

  try {
    if (msg.type === 'bounds') {
      part = new Float32Array(msg.buffer);
      post({ type: 'bounds', bounds: getFloat32Bounds(part) });
      return;
    }

    if (!part) {
      throw new Error('No data to convert');
    }

    const { buffer } = toHalfFloatBits(part, msg.normalization);
    part = undefined;
    post({ type: 'halfFloats', buffer }, [buffer]);
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
