/* Web worker computing the bounds of chunks of a volume or converting them to half floats */

import {
  getFloat32Bounds,
  type HalfFloatNormalization,
  toHalfFloatBits,
} from './utils';

export type PrepareRequest =
  | { type: 'bounds'; id: number; buffer: ArrayBuffer } // chunk (`Float32Array`), ignored by `processChunk`
  | {
      type: 'halfFloats';
      id: number;
      buffer: ArrayBuffer;
      normalization: HalfFloatNormalization;
    };

export type PrepareResponse =
  | { type: 'bounds'; id: number; bounds: ReturnType<typeof getFloat32Bounds> }
  | { type: 'halfFloats'; id: number; buffer: ArrayBuffer }
  | { type: 'error'; id: number; message: string };

/* Also used on the main thread, which processes some chunks itself (without copying them) */
export function processChunk(
  msg: PrepareRequest,
  chunk: Float32Array,
): PrepareResponse {
  const { id } = msg;

  if (msg.type === 'bounds') {
    return { type: 'bounds', id, bounds: getFloat32Bounds(chunk) };
  }

  const { buffer } = toHalfFloatBits(chunk, msg.normalization);
  return { type: 'halfFloats', id, buffer };
}

// Don't listen to messages when imported on the main thread
if ('importScripts' in globalThis) {
  globalThis.addEventListener(
    'message',
    (evt: MessageEvent<PrepareRequest>) => {
      const msg = evt.data;
      let response: PrepareResponse;
      try {
        response = processChunk(msg, new Float32Array(msg.buffer));
      } catch (error) {
        response = {
          type: 'error',
          id: msg.id,
          message: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      globalThis.postMessage(response, {
        transfer: response.type === 'halfFloats' ? [response.buffer] : [],
      });
    },
  );
}
