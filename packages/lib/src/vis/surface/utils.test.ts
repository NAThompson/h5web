import { ScaleType } from '@h5web/shared/vis-models';
import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import {
  getColorParams,
  getLinearColorLut,
  getVertexColors,
} from '../three-d/utils';
import {
  assertSurfaceArrays,
  buildSurfaceBuffers,
  findCell,
  flattenArray,
  getCellCenters,
  getCoordsDomain,
  getDownsamplingStride,
  getFootprint,
  getSampledIndices,
  getSurfaceColors,
  interpolateGrid,
  isSurfaceSupported,
  sampleArray,
} from './utils';

function getVertexCount(rows: number, cols: number, stride: number): number {
  return (
    getSampledIndices(rows, stride).length *
    getSampledIndices(cols, stride).length
  );
}

describe('getDownsamplingStride', () => {
  it('should not downsample below vertex limit', () => {
    expect(getDownsamplingStride(100, 100, 10_000)).toBe(1);
  });

  it('should return smallest stride that keeps vertex count under limit', () => {
    for (const [rows, cols] of [
      [4000, 4000],
      [2000, 3000],
      [1500, 1100],
    ]) {
      const stride = getDownsamplingStride(rows, cols, 1_000_000);
      expect(getVertexCount(rows, cols, stride)).toBeLessThanOrEqual(1_000_000);
      expect(getVertexCount(rows, cols, stride - 1)).toBeGreaterThan(1_000_000);
    }
  });

  it('should enforce vertex limit for elongated arrays', () => {
    const stride = getDownsamplingStride(2, 8_388_608, 1_048_576);
    expect(getVertexCount(2, 8_388_608, stride)).toBeLessThanOrEqual(1_048_576);
  });

  it('should not loop forever when limit cannot be met', () => {
    expect(getDownsamplingStride(3, 3, 1)).toBe(3);
  });
});

describe('getSampledIndices', () => {
  it('should return every index with stride 1', () => {
    expect(getSampledIndices(4, 1)).toEqual([0, 1, 2, 3]);
  });

  it('should always include last index', () => {
    expect(getSampledIndices(10, 3)).toEqual([0, 3, 6, 9]);
    expect(getSampledIndices(11, 3)).toEqual([0, 3, 6, 9, 10]);
  });
});

describe('sampleArray', () => {
  it('should pick given rows and columns', () => {
    const arr = ndarray(
      Float32Array.from({ length: 12 }, (_, i) => i),
      [3, 4],
    );
    const sampled = sampleArray(arr, [0, 2], [1, 3]);
    expect(sampled.shape).toEqual([2, 2]);
    expect([...sampled.data]).toEqual([1, 3, 9, 11]);
  });

  it('should return same array when picking everything', () => {
    const arr = ndarray([1, 2, 3, 4], [2, 2]);
    expect(sampleArray(arr, [0, 1], [0, 1])).toBe(arr);
  });
});

describe('getCellCenters', () => {
  it('should return indices when no axis values', () => {
    expect(getCellCenters(undefined, 3)).toEqual([0, 1, 2]);
  });

  it('should return axis values as is when one per cell', () => {
    expect(getCellCenters([10, 20, 40], 3)).toEqual([10, 20, 40]);
  });

  it('should return mid-points when axis values are pixel edges', () => {
    expect(getCellCenters([0, 2, 6, 8], 3)).toEqual([1, 4, 7]);
  });
});

describe('getCoordsDomain', () => {
  it('should return extent of finite coordinates', () => {
    expect(getCoordsDomain([-1, Number.NaN, 3, 2])).toEqual([-1, 3]);
  });

  it('should keep descending axes descending, like HeatmapVis', () => {
    expect(getCoordsDomain([3, 2, 1, 0])).toEqual([3, 0]);
  });

  it('should extend degenerate domains', () => {
    expect(getCoordsDomain([5])).toEqual([4.5, 5.5]);
    expect(getCoordsDomain([])).toEqual([-0.5, 0.5]);
  });
});

describe('getFootprint', () => {
  it('should return square footprint when not keeping ratio', () => {
    expect(getFootprint([0, 100], [0, 10], false)).toEqual([1, 1]);
  });

  it('should respect ratio between axis extents with longest side of 1', () => {
    expect(getFootprint([0, 40], [0, 20], true)).toEqual([1, 0.5]);
    expect(getFootprint([0, 10], [-20, 20], true)).toEqual([0.25, 1]);
  });
});

describe('buildSurfaceBuffers', () => {
  it('should normalize heights with scale and create two triangles per cell', () => {
    const values = ndarray([0, 5, 10, 10], [2, 2]);
    const { positions, index } = buildSurfaceBuffers({
      values,
      xCoords: [-0.5, 0.5],
      yCoords: [-0.25, 0.25],
      domain: [0, 10],
      scaleType: ScaleType.Linear,
    });

    expect([...positions]).toEqual([
      -0.5, -0.25, 0, 0.5, -0.25, 0.5, -0.5, 0.25, 1, 0.5, 0.25, 1,
    ]);
    expect([...index]).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it('should clamp heights to domain', () => {
    const values = ndarray([-5, 20, 0, 0], [2, 2]);
    const { positions } = buildSurfaceBuffers({
      values,
      xCoords: [0, 1],
      yCoords: [0, 1],
      domain: [0, 10],
      scaleType: ScaleType.Linear,
    });

    expect(positions[2]).toBe(0);
    expect(positions[5]).toBe(1);
  });

  it('should use same scale for height as for colours (log)', () => {
    const values = ndarray([1, 10, 100, 1000], [2, 2]);
    const { positions } = buildSurfaceBuffers({
      values,
      xCoords: [0, 1],
      yCoords: [0, 1],
      domain: [1, 1000],
      scaleType: ScaleType.Log,
    });

    const heights = [positions[2], positions[5], positions[8], positions[11]];
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBeCloseTo(1 / 3);
    expect(heights[2]).toBeCloseTo(2 / 3);
    expect(heights[3]).toBeCloseTo(1);
  });

  it('should leave holes for NaN, ignored and unsupported values', () => {
    // 3x3 grid -> 4 cells; each corner cell has a bad value
    const values = ndarray([1, 2, Number.NaN, 4, 5, 6, -7, 8, 99], [3, 3]);
    const { index } = buildSurfaceBuffers({
      values,
      xCoords: [0, 1, 2],
      yCoords: [0, 1, 2],
      domain: [1, 10],
      scaleType: ScaleType.Log, // -7 not supported
      ignoreValue: (val) => val === 99,
    });

    // Only bottom-left cell (values 1, 2, 4, 5) remains
    expect([...index]).toEqual([0, 1, 3, 1, 4, 3]);
  });

  it('should leave holes for non-finite axis coordinates', () => {
    const { positions, index } = buildSurfaceBuffers({
      values: ndarray([1, 2, 3, 4, 5, 6], [2, 3]),
      xCoords: [0, Number.NaN, 2],
      yCoords: [0, 1],
      domain: [1, 6],
      scaleType: ScaleType.Linear,
    });

    expect(index).toHaveLength(0); // both cells touch column with NaN coordinate
    expect(positions.every(Number.isFinite)).toBe(true);
  });

  it('should produce no triangle with a single row or column', () => {
    const { index } = buildSurfaceBuffers({
      values: ndarray([1, 2, 3], [1, 3]),
      xCoords: [0, 1, 2],
      yCoords: [0],
      domain: [1, 3],
      scaleType: ScaleType.Linear,
    });

    expect(index).toHaveLength(0);
    expect(isSurfaceSupported([1, 3])).toBe(false);
    expect(isSurfaceSupported([3, 1])).toBe(false);
    expect(isSurfaceSupported([2, 2])).toBe(true);
  });
});

describe('getSurfaceColors', () => {
  it('should map normalized heights through colour map', () => {
    const colorLut = getLinearColorLut('Greys', false);
    const { positions } = buildSurfaceBuffers({
      values: ndarray([0, 10, 0, 10], [2, 2]),
      xCoords: [0, 1],
      yCoords: [0, 1],
      domain: [0, 10],
      scaleType: ScaleType.Linear,
    });

    const colors = getSurfaceColors(positions, colorLut);

    // Min value gets first colour of LUT, max value gets last colour
    expect(colors.slice(0, 3)).toEqual(colorLut.slice(0, 3));
    expect(colors.slice(3, 6)).toEqual(colorLut.slice(-3));
    expect(colorLut[0]).not.toBe(colorLut.at(-1));
  });
});

describe('flattenArray', () => {
  it('should return data of contiguous arrays as is', () => {
    const arr = ndarray(Float32Array.from([1, 2, 3, 4, 5, 6]), [2, 3]);
    expect(flattenArray(arr)).toBe(arr.data);
  });

  it('should flatten views in row-major order', () => {
    const arr = ndarray([1, 2, 3, 4, 5, 6], [2, 3]).transpose(1, 0);
    expect([...flattenArray(arr)]).toEqual([1, 4, 2, 5, 3, 6]);
  });
});

describe('buildSurfaceBuffers with floorUnsupported', () => {
  it('should put values not supported by the scale on the floor instead of leaving holes', () => {
    const values = ndarray([0, 10, 100, 1000], [2, 2]); // 0 not supported in log
    const params: Parameters<typeof buildSurfaceBuffers>[0] = {
      values,
      xCoords: [0, 1],
      yCoords: [0, 1],
      domain: [1, 1000],
      scaleType: ScaleType.Log,
    };

    expect(buildSurfaceBuffers(params).index).toHaveLength(0);

    const { positions, index } = buildSurfaceBuffers({
      ...params,
      floorUnsupported: true,
    });
    expect([...index]).toEqual([0, 1, 2, 1, 3, 2]);
    expect(positions[2]).toBe(0);
  });

  it('should still leave holes for NaN', () => {
    const { index } = buildSurfaceBuffers({
      values: ndarray([Number.NaN, 10, 100, 1000], [2, 2]),
      xCoords: [0, 1],
      yCoords: [0, 1],
      domain: [1, 1000],
      scaleType: ScaleType.Log,
      floorUnsupported: true,
    });
    expect(index).toHaveLength(0);
  });
});

describe('assertSurfaceArrays', () => {
  it('should reject arrays with a single row or column', () => {
    expect(() => assertSurfaceArrays(ndarray([1, 2, 3], [1, 3]))).toThrow(
      'two rows and two columns',
    );
  });

  it('should reject colour arrays of another shape', () => {
    expect(() =>
      assertSurfaceArrays(
        ndarray([1, 2, 3, 4, 5, 6], [2, 3]),
        ndarray([1, 2, 3, 4, 5, 6], [3, 2]),
      ),
    ).toThrow('same shape');
  });

  it('should accept transposed colour arrays of the same shape', () => {
    const colors = ndarray([1, 2, 3, 4, 5, 6], [3, 2]).transpose(1, 0);
    expect(() =>
      assertSurfaceArrays(ndarray([1, 2, 3, 4, 5, 6], [2, 3]), colors),
    ).not.toThrow();
  });
});

describe('downsampled colour field', () => {
  it('should keep colours aligned with vertices when sampling both arrays with the same indices', () => {
    const rows = 5;
    const cols = 7;
    const heights = ndarray(
      Float64Array.from({ length: rows * cols }, (_, i) => i),
      [rows, cols],
    );
    // Colour field: transposed view, value = column index (as each row of the view is a column)
    const colorField = ndarray(
      Float64Array.from({ length: rows * cols }, (_, i) =>
        Math.floor(i / rows),
      ),
      [cols, rows],
    ).transpose(1, 0);

    const stride = getDownsamplingStride(rows, cols, 12);
    const rowIndices = getSampledIndices(rows, stride);
    const colIndices = getSampledIndices(cols, stride);
    const sampledHeights = sampleArray(heights, rowIndices, colIndices);
    const sampledColors = sampleArray(colorField, rowIndices, colIndices);

    expect(sampledColors.shape).toEqual(sampledHeights.shape);

    const lut = getLinearColorLut('Viridis', false);
    const colors = getVertexColors(
      getColorParams(
        flattenArray(sampledColors),
        [0, cols - 1],
        ScaleType.Linear,
      ),
      lut,
    );

    // Last vertex: last row and last column of the data -> colour of last column
    const last = sampledHeights.size - 1;
    expect(sampledHeights.data[last]).toBe(rows * cols - 1);
    expect(colors.slice(last * 3, last * 3 + 3)).toEqual(lut.slice(-3));
  });
});

describe('findCell', () => {
  it('find cell of ascending and descending coordinates', () => {
    expect(findCell([0, 1, 2, 3], 1.25)).toEqual([1, 0.25]);
    expect(findCell([3, 2, 1, 0], 1.25)).toEqual([1, 0.75]);
    expect(findCell([0, 1, 2], 2)).toEqual([1, 1]);
  });

  it('return undefined outside coordinates', () => {
    expect(findCell([0, 1, 2], -0.1)).toBeUndefined();
    expect(findCell([0, 1, 2], Number.NaN)).toBeUndefined();
    expect(findCell([0], 0)).toBeUndefined();
  });
});

describe('interpolateGrid', () => {
  // f(x, y) = x + 10 y on a 2 x 3 grid (rows: y, columns: x)
  const values = ndarray([0, 1, 2, 10, 11, 12], [2, 3]);

  it('interpolate bilinearly', () => {
    expect(interpolateGrid(values, [0, 1, 2], [0, 1], 1.5, 0.5)).toBeCloseTo(
      6.5,
    );
    expect(interpolateGrid(values, [0, 1, 2], [0, 1], 2, 1)).toBe(12);
  });

  it('follow descending coordinates', () => {
    expect(interpolateGrid(values, [2, 1, 0], [0, 1], 2, 0)).toBe(0);
  });

  it('return NaN outside the grid', () => {
    expect(interpolateGrid(values, [0, 1, 2], [0, 1], 3, 0)).toBeNaN();
  });
});
