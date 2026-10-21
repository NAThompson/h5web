// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- for packages compiling this file
/// <reference path="./gifenc.d.ts" />
import { GIFEncoder as createEncoder } from 'gifenc';

import { createPaletteIndexer, getGifDelay, getGifPalette } from './gifUtils';

export interface GifWriter {
  addFrame: (frame: HTMLCanvasElement) => void;
  finish: () => Blob;
}

/* Encode frames (e.g. snapshots) of the given size as an animated GIF at `fps`, looping forever,
 * one frame after the other regardless of how long each takes to render. All frames share the
 * palette of the first one, which shows the whole colormap (color bar), to avoid flicker (colors
 * that only appear later, e.g. a curve, get the nearest color of that palette).
 * Frames of another size than the first (e.g. resized) are scaled to fit. */
export function createGifWriter(
  width: number,
  height: number,
  fps: number,
): GifWriter {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not get 2D canvas context');
  }

  const encoder = createEncoder();
  let palette: ReturnType<typeof getGifPalette> | undefined; // of first frame
  let toIndices: ReturnType<typeof createPaletteIndexer> | undefined;

  return {
    addFrame: (frame) => {
      ctx.fillStyle = 'white'; // under transparent pixels, if any
      ctx.fillRect(0, 0, width, height);
      const scale = Math.min(width / frame.width, height / frame.height);
      ctx.drawImage(frame, 0, 0, frame.width * scale, frame.height * scale);

      const { data } = ctx.getImageData(0, 0, width, height);
      const isFirst = !palette;
      palette = palette ?? getGifPalette(data);
      toIndices = toIndices ?? createPaletteIndexer(palette);
      encoder.writeFrame(toIndices(data), width, height, {
        palette: isFirst ? palette : undefined, // global palette
        delay: getGifDelay(fps) * 10, // ms
        repeat: 0, // forever
      });
    },
    finish: () => {
      encoder.finish();
      return new Blob([encoder.bytes()], { type: 'image/gif' });
    },
  };
}
