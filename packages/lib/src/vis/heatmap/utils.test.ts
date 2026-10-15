import { ScaleType } from '@h5web/shared/vis-models';
import { interpolateGreys } from 'd3-scale-chromatic';
import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../models';
import {
  getCellEdges,
  getChunkBounds,
  getGlslPixels,
  getIndexToPosition,
  getLinearGradient,
  getRelativePixels,
  getSafeDomain,
  getTextureChunks,
  isNonUniform,
  isNonUniformAxis,
  sliceRelativePixels,
  sliceTextureChunk,
  toTextureSafeNdArray,
} from './utils';

// Chebyshev nodes of the first kind, descending from 1 to -1 (like `cos` of increasing angles)
const CHEBYSHEV = Array.from({ length: 8 }, (_, k) =>
  Math.cos(((2 * k + 1) * Math.PI) / 16),
);

const white = 'rgb(255, 255, 255)';
const black = 'rgb(0, 0, 0)';
const gradientRegex = /^linear-gradient\(to top, (.+)\)$/;

describe('getSafeDomain', () => {
  it('should widen the flat domain of constant data', () => {
    const [linear] = getSafeDomain([2, 2], [2, 2], ScaleType.Linear);
    expect(linear[0]).toBeCloseTo(1.9);
    expect(linear[1]).toBeCloseTo(2.1);

    for (const scaleType of [ScaleType.Log, ScaleType.SymLog]) {
      const [[min, max]] = getSafeDomain([1, 1], [1, 1], scaleType);
      expect(min).toBeCloseTo(1 / Math.sqrt(10)); // one decade around the value
      expect(max).toBeCloseTo(Math.sqrt(10));
    }

    const [negative] = getSafeDomain([-1, -1], [-1, -1], ScaleType.SymLog);
    expect(negative[0]).toBeCloseTo(-Math.sqrt(10));
    expect(negative[1]).toBeCloseTo(-1 / Math.sqrt(10));

    expect(getSafeDomain([0, 0], [0, 0], ScaleType.Linear)[0]).toEqual([-1, 1]);
    expect(getSafeDomain([0, 0], [0, 0], ScaleType.SymLog)[0]).toEqual([-1, 1]);
    expect(getSafeDomain([0, 0], [0, 0], ScaleType.Sqrt)[0]).toEqual([0, 1]);
  });

  it('should keep the widened domain of extreme constant values finite', () => {
    const [huge] = getSafeDomain([1e308, 1e308], [1e308, 1e308], ScaleType.Log);
    expect(huge[0]).toBeLessThan(1e308);
    expect(huge[1]).toBe(1e308);
    const max = Number.MAX_VALUE;
    expect(getSafeDomain([max, max], [max, max], ScaleType.Linear)[0][1]).toBe(
      max,
    );
    const tiny = Number.MIN_VALUE;
    expect(getSafeDomain([tiny, tiny], [tiny, tiny], ScaleType.Log)[0][0]).toBe(
      tiny,
    );
  });

  it('should keep a custom flat domain on varying data', () => {
    expect(getSafeDomain([4, 4], [1, 9], ScaleType.Linear)[0]).toEqual([4, 4]);
  });

  it('should return given domain if safe in given scale', () => {
    const [domain, errors] = getSafeDomain([-10, 5], [1, 2], ScaleType.Linear);
    expect(domain).toEqual([-10, 5]);
    expect(errors).toEqual({});
  });

  it('should return fallback domain if min > max', () => {
    const [domain, errors] = getSafeDomain([5, -10], [1, 2], ScaleType.Linear);
    expect(domain).toEqual([1, 2]);
    expect(errors).toEqual({ minGreater: true });
  });

  it('should use fallback min if not supported by given scale', () => {
    const logResult = getSafeDomain([0, 5], [1, 2], ScaleType.Log);
    const sqrtResult = getSafeDomain([-1, 5], [1, 2], ScaleType.Sqrt);

    const expectedDomain = [1, 5];
    const expectedErrors = { minError: DomainError.InvalidMinWithScale };

    expect(logResult).toEqual([expectedDomain, expectedErrors]);
    expect(sqrtResult).toEqual([expectedDomain, expectedErrors]);
  });

  it('should return fallback domain if neither min nor max are supported by given scale', () => {
    const logResult = getSafeDomain([-2, 0], [1, 2], ScaleType.Log);
    const sqrtResult = getSafeDomain([-10, -5], [1, 2], ScaleType.Sqrt);

    const expectedDomain = [1, 2];
    const expectedErrors = {
      minError: DomainError.InvalidMinWithScale,
      maxError: DomainError.InvalidMaxWithScale,
    };

    expect(logResult).toEqual([expectedDomain, expectedErrors]);
    expect(sqrtResult).toEqual([expectedDomain, expectedErrors]);
  });

  it('should return empty [max, max] domain if fallback min is greater than max', () => {
    const [domain, errors] = getSafeDomain([-5, 5], [10, 20], ScaleType.Log);
    expect(domain).toEqual([5, 5]);
    expect(errors).toEqual({ minError: DomainError.CustomMaxFallback });
  });
});

describe('getLinearGradient', () => {
  it('should generate linear gradient from first to last color', () => {
    const gradient = getLinearGradient(interpolateGreys, 'top');

    const [match, colorStops] = gradientRegex.exec(gradient) || [];
    expect(match).toBeDefined();
    expect(colorStops.startsWith(white)).toBe(true);
    expect(colorStops.endsWith(black)).toBe(true);
    expect(colorStops.match(/rgb/gu)?.length).toBe(21);
  });

  it('should generate linear gradient with two solid colors', () => {
    const gradient = getLinearGradient(interpolateGreys, 'top', true);

    const [match, colorStops] = gradientRegex.exec(gradient) || [];
    expect(match).toBeDefined();
    expect(colorStops).toBe(`${white}, ${white} 50%, ${black} 50%, ${black}`);
  });
});

describe('toTextureSafeNdArray', () => {
  it('should pass float32 and uint8 through', () => {
    const initial = ndarray(Float32Array.from([1, 2]), [2]);
    expect(toTextureSafeNdArray(initial)).toBe(initial);
  });

  it('should pass float16 through as uint16 without copying', () => {
    const values = Float16Array.from([1.5, -2.5]);
    const safe = toTextureSafeNdArray(ndarray(values, [2]));

    expect(safe.dtype).toBe('uint16');
    expect(safe.data.buffer).toBe(values.buffer);
    expect(safe.shape).toEqual([2]);
  });

  it('should convert other numeric types to float32', () => {
    const safe = toTextureSafeNdArray(ndarray(Int16Array.from([1, 2]), [2]));

    expect(safe.dtype).toBe('float32');
    expect([...safe.data]).toEqual([1, 2]);
  });
});

describe('getTextureChunks', () => {
  it('should return single chunk if shape fits in max texture size', () => {
    expect(getTextureChunks([4, 3], 4)).toEqual([
      {
        rows: { start: 0, end: 4, texStart: 0, texEnd: 4 },
        cols: { start: 0, end: 3, texStart: 0, texEnd: 3 },
      },
    ]);
  });

  it('should split rows into chunks with overlapping texels', () => {
    // Chunks hold at most 4 - 2 visible rows so textures with overlap fit in 4
    expect(getTextureChunks([5, 3], 4)).toEqual([
      {
        rows: { start: 0, end: 2, texStart: 0, texEnd: 3 },
        cols: { start: 0, end: 3, texStart: 0, texEnd: 3 },
      },
      {
        rows: { start: 2, end: 4, texStart: 1, texEnd: 5 },
        cols: { start: 0, end: 3, texStart: 0, texEnd: 3 },
      },
      {
        rows: { start: 4, end: 5, texStart: 3, texEnd: 5 },
        cols: { start: 0, end: 3, texStart: 0, texEnd: 3 },
      },
    ]);
  });

  it('should split both dimensions', () => {
    const chunks = getTextureChunks([10, 7], 6);

    expect(chunks.map(({ rows, cols }) => [rows.start, cols.start])).toEqual([
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
      [8, 0],
      [8, 4],
    ]);
    expect(chunks[3]).toEqual({
      rows: { start: 4, end: 8, texStart: 3, texEnd: 9 },
      cols: { start: 4, end: 7, texStart: 3, texEnd: 7 },
    });

    chunks.forEach(({ rows, cols }) => {
      expect(rows.texEnd - rows.texStart).toBeLessThanOrEqual(6);
      expect(cols.texEnd - cols.texStart).toBeLessThanOrEqual(6);
    });
  });
});

describe('sliceTextureChunk', () => {
  const chunk = {
    rows: { start: 1, end: 2, texStart: 0, texEnd: 3 },
    cols: { start: 2, end: 3, texStart: 1, texEnd: 4 },
  };

  it('should copy chunk with overlapping texels into new array of same type', () => {
    const values = ndarray(
      Uint8Array.from({ length: 12 }, (_, i) => i),
      [3, 4],
    );
    const sliced = sliceTextureChunk(values, chunk);

    expect(sliced.dtype).toBe('uint8');
    expect(sliced.shape).toEqual([3, 3]);
    expect([...sliced.data]).toEqual([1, 2, 3, 5, 6, 7, 9, 10, 11]);
  });

  it('should respect strides and offset of views', () => {
    const data = Float32Array.from({ length: 12 }, (_, i) => i);
    const transposed = ndarray(data, [4, 3]).transpose(1, 0); // shape [3, 4]
    const sliced = sliceTextureChunk(transposed, chunk);

    expect([...sliced.data]).toEqual([3, 6, 9, 4, 7, 10, 5, 8, 11]);
  });

  it('should not copy contiguous rows', () => {
    const values = ndarray(
      Float32Array.from({ length: 12 }, (_, i) => i),
      [4, 3],
    );
    const sliced = sliceTextureChunk(values, {
      rows: { start: 2, end: 3, texStart: 1, texEnd: 4 },
      cols: { start: 0, end: 3, texStart: 0, texEnd: 3 },
    });

    expect(sliced.data.buffer).toBe(values.data.buffer);
    expect([...sliced.data]).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
});

describe('getChunkBounds', () => {
  it('should compute quad and visible texture coordinates of chunk', () => {
    const [, chunk] = getTextureChunks([5, 3], 4);
    const bounds = getChunkBounds(chunk, [5, 3], { width: 30, height: 10 });

    expect(bounds).toEqual({
      x: [-15, 15],
      y: [-1, 3],
      u: [0, 1],
      v: [0.25, 0.75], // visible rows 2-3 within texture rows 1-4
    });
  });

  it('should share exact edges between adjacent chunks', () => {
    const shape = [10, 7];
    const size = { width: 1, height: 0.3 }; // non-integer cell sizes
    const chunks = getTextureChunks(shape, 6);
    const [b00, b01, b10] = [0, 1, 2].map((i) =>
      getChunkBounds(chunks[i], shape, size),
    );

    expect(b00.x[1]).toBe(b01.x[0]);
    expect(b00.y[1]).toBe(b10.y[0]);
    expect(b00.x[0]).toBe(-0.5);
    expect(b00.y[0]).toBe(-0.15);
  });

  it('should place chunks of non-uniform axes at their edges', () => {
    const [, chunk] = getTextureChunks([5, 3], 4); // rows 2-3 (texture rows 1-4)
    const relY = getRelativePixels([0, 0.1, 0.2, 0.4, 0.7, 1]);
    const bounds = getChunkBounds(
      chunk,
      [5, 3],
      { width: 30, height: 10 },
      undefined,
      relY,
    );

    expect(bounds.x).toEqual([-15, 15]); // uniform axis unchanged
    expect(bounds.y[0]).toBeCloseTo(-3); // edge 2 at 0.2
    expect(bounds.y[1]).toBeCloseTo(2); // edge 4 at 0.7
    // Relative positions within texture rows 1-4 (0.1 to 1), remapped to texels in the shader
    expect(bounds.v[0]).toBeCloseTo(0.1 / 0.9);
    expect(bounds.v[1]).toBeCloseTo(0.6 / 0.9);
  });
});

describe('isNonUniform', () => {
  it('should detect unevenly spaced monotonic values', () => {
    expect(isNonUniform(CHEBYSHEV)).toBe(true);
    expect(isNonUniform([1, 10, 100, 1000])).toBe(true);
    expect(isNonUniform([1000, 100, 10, 1])).toBe(true);
  });

  it('should consider evenly spaced values uniform, within tolerance', () => {
    expect(isNonUniform([0, 1, 2, 3, 4])).toBe(false);
    expect(isNonUniform([4, 3, 2, 1, 0])).toBe(false);
    expect(isNonUniform([0, 0.1, 0.2, 0.3])).toBe(false); // rounding errors
    expect(isNonUniform([0, 1.005, 2, 3])).toBe(false);
    expect(isNonUniform([0, 1.02, 2, 3])).toBe(true);
  });

  it('should consider float32 linspaces uniform, despite rounding', () => {
    const linspace = Float32Array.from(
      { length: 1000 },
      (_, i) => 1000 + i * 0.01,
    );
    expect(isNonUniform(linspace)).toBe(false);
    expect(isNonUniformAxis(linspace, 1000)).toBe(false);
    expect(isNonUniformAxis(linspace, 999)).toBe(false); // as edges
    expect(getCellEdges(linspace, 1000)).toHaveLength(1001);
    expect(getIndexToPosition(linspace, 1000)).toBeUndefined(); // contours as the mesh
  });

  it('should ignore values that cannot be remapped', () => {
    expect(isNonUniform([0, 1])).toBe(false);
    expect(isNonUniform([0, 2, 1, 3])).toBe(false); // not monotonic
    expect(isNonUniform([0, 0, 1, 3])).toBe(false); // repeated value
    expect(isNonUniform([0, 1, Number.NaN, 3])).toBe(false);
    expect(isNonUniform([2, 2, 2])).toBe(false);
  });
});

describe('getCellEdges', () => {
  it('should keep edges of uniform pixel values as before (values at pixel starts)', () => {
    expect(getCellEdges([10, 20, 30], 3)).toEqual([10, 20, 30, 40]);
    expect(getCellEdges(undefined, 2)).toEqual([0, 1, 2]);
  });

  it('should keep edges given as is, uniform or not', () => {
    expect(getCellEdges([0, 1, 3, 7], 3)).toEqual([0, 1, 3, 7]);
  });

  it('should centre pixels on non-uniform values', () => {
    expect(getCellEdges([1, 2, 4, 8], 4)).toEqual([0.5, 1.5, 3, 6, 10]);
    expect(getCellEdges([8, 4, 2, 1], 4)).toEqual([10, 6, 3, 1.5, 0.5]);

    const edges = getCellEdges(CHEBYSHEV, 8);
    expect(edges).toHaveLength(9);
    CHEBYSHEV.forEach((val, i) => {
      expect(val).toBeLessThan(edges[i]); // descending
      expect(val).toBeGreaterThan(edges[i + 1]);
    });
  });
});

describe('getRelativePixels', () => {
  it('should interleave relative edges and centres of pixels', () => {
    expect([...getRelativePixels([2, 6, 10])]).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect([...getRelativePixels([2, 6, 10], [3, 9])]).toEqual([
      0, 0.125, 0.5, 0.875, 1,
    ]);
  });

  it('should slice pixels and rescale them from 0 to 1', () => {
    const relPixels = getRelativePixels([0, 1, 3, 7]);
    expect([...sliceRelativePixels(relPixels, 1, 3)]).toEqual([
      0,
      expect.closeTo(1 / 6),
      expect.closeTo(1 / 3),
      expect.closeTo(2 / 3),
      1,
    ]);
  });
});

describe('getIndexToPosition', () => {
  it('should be undefined for evenly spaced pixels', () => {
    expect(getIndexToPosition(undefined, 3)).toBeUndefined();
    expect(getIndexToPosition([1, 2, 3], 3)).toBeUndefined();
  });

  it('should map pixel centres to non-uniform pixel values', () => {
    const toPos = getIndexToPosition([1, 2, 4, 8], 4); // edges 0.5 to 10
    expect(toPos).toBeDefined();
    function toVal(u: number): number {
      return 0.5 + (toPos?.(u) ?? Number.NaN) * 9.5;
    }

    expect(toVal(0)).toBeCloseTo(0.5);
    expect(toVal(0.5)).toBeCloseTo(1);
    expect(toVal(2.5)).toBeCloseTo(4);
    expect(toVal(3)).toBeCloseTo(6); // between centres: between values
    expect(toVal(4)).toBeCloseTo(10);
  });

  it('should interpolate between bin centres of non-uniform bin edges', () => {
    const toPos = getIndexToPosition([0, 1, 3, 7], 3); // centres at 0.5, 2, 5
    expect(toPos?.(0)).toBeCloseTo(0);
    expect(toPos?.(0.5)).toBeCloseTo(0.5 / 7);
    expect(toPos?.(1)).toBeCloseTo(1.25 / 7); // halfway between centres, not at edge 1
    expect(toPos?.(2.5)).toBeCloseTo(5 / 7);
    expect(toPos?.(3)).toBeCloseTo(1);
  });
});

describe('getGlslPixels', () => {
  it('should only remap coordinates of non-uniform axes', () => {
    expect(getGlslPixels(false, false)).toEqual({
      declarations: '',
      remapping: '',
    });
    expect(getGlslPixels(true, false).remapping).toContain(
      'vec2(toTexCoord(xPixels, coords.x), coords.y)',
    );
    expect(getGlslPixels(false, true).remapping).toContain(
      'vec2(coords.x, toTexCoord(yPixels, coords.y))',
    );
  });
});
