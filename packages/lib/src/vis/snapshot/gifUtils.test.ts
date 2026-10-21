import { describe, expect, it } from 'vitest';

import {
  createPaletteIndexer,
  getColorfulColors,
  getGifDelay,
  getGifPalette,
  getGrays,
  medianCut,
} from './gifUtils';

describe('getGifDelay', () => {
  it('should convert frame rate to hundredths of a second', () => {
    expect(getGifDelay(10)).toBe(10);
    expect(getGifDelay(0.5)).toBe(200);
    expect(getGifDelay(30)).toBe(3);
    expect(getGifDelay(60)).toBe(2); // capped at 50 fps
  });
});

const white = [255, 255, 255, 255];
const purple = [68, 1, 84, 255];
const nearlyGray = [100, 104, 98, 255]; // e.g. antialiased text
const yellow = [253, 231, 37, 255];

describe('getColorfulColors', () => {
  it('should count distinct colors that are not gray', () => {
    const rgba = new Uint8ClampedArray(
      [white, purple, nearlyGray, yellow, purple].flat(),
    );
    expect([...getColorfulColors(rgba).values()]).toStrictEqual([
      { color: [68, 1, 84], count: 2 },
      { color: [253, 231, 37], count: 1 },
    ]);
  });
});

describe('getGrays', () => {
  it('should spread grays from black to white', () => {
    expect(getGrays(3)).toStrictEqual([
      [0, 0, 0],
      [128, 128, 128],
      [255, 255, 255],
    ]);
  });
});

describe('medianCut', () => {
  it('should spread colors evenly over a gradient', () => {
    const gradient = Array.from(
      { length: 100 },
      (_, i): [number, number, number] => [i, 2 * i, 100],
    );
    const reds = medianCut(gradient, 4).map(([r]) => r);
    expect(reds.toSorted((a, b) => a - b)).toStrictEqual([12, 37, 62, 87]);
  });

  it('should return at most the given colors', () => {
    expect(medianCut([[1, 2, 3]], 4)).toStrictEqual([[1, 2, 3]]);
    expect(medianCut([], 4)).toStrictEqual([]);
  });
});

describe('getGifPalette', () => {
  it('should have colors and grays for the rest', () => {
    const colorful = new Uint8ClampedArray([white, purple, yellow].flat());
    expect(getGifPalette(colorful)).toStrictEqual([
      [68, 1, 84],
      [253, 231, 37],
      ...getGrays(254),
    ]);

    const gray = new Uint8ClampedArray([white, nearlyGray].flat());
    expect(getGifPalette(gray)).toStrictEqual(getGrays(256));
  });

  it('should keep exact colors of a few pixels (e.g. curve of a line plot)', () => {
    const pixels = Array.from({ length: 1000 }, (_, i) =>
      i === 0 ? [255, 0, 0, 255] : white,
    );
    const palette = getGifPalette(new Uint8ClampedArray(pixels.flat()));
    expect(palette).toContainEqual([255, 0, 0]);
    expect(palette).toHaveLength(256);
  });

  it('should keep a few grays with many colors', () => {
    const pixels = Array.from({ length: 1000 }, (_, i) => [i % 256, 0, 0, 255]);
    const palette = getGifPalette(new Uint8ClampedArray(pixels.flat()));
    expect(palette).toHaveLength(256);
    expect(palette.slice(-16)).toStrictEqual(getGrays(16));
  });
});

describe('createPaletteIndexer', () => {
  it('should map pixels to nearest color', () => {
    const toIndices = createPaletteIndexer([
      [0, 0, 0],
      [255, 255, 255],
      [68, 1, 84],
    ]);
    const rgba = new Uint8ClampedArray(
      [white, [30, 30, 30, 255], [80, 10, 90, 255]].flat(),
    );
    expect([...toIndices(rgba)]).toStrictEqual([1, 0, 2]);
  });
});
