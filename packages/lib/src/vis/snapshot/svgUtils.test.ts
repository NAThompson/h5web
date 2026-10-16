import { describe, expect, it } from 'vitest';

import {
  chainSegments,
  collapseWhitespace,
  decimate,
  fmt,
  getGenericFontFamily,
  getHermiteControls,
  getRepeatingStripes,
  parseClipPolygon,
  toPathData,
} from './svgUtils';

describe('fmt', () => {
  it('should round to hundredths', () => {
    expect(fmt(1.234_56)).toBe('1.23');
    expect(fmt(10)).toBe('10');
    expect(fmt(-0.001)).toBe('0');
  });
});

describe('getGenericFontFamily', () => {
  it('should map font stacks to generic families', () => {
    expect(getGenericFontFamily('system-ui, -apple-system, sans-serif')).toBe(
      'sans-serif',
    );
    expect(getGenericFontFamily('"Courier New", monospace')).toBe('monospace');
    expect(getGenericFontFamily('Georgia, serif')).toBe('serif');
    expect(getGenericFontFamily('math')).toBe('serif');
  });
});

describe('collapseWhitespace', () => {
  it('should collapse whitespace across texts like SVG text', () => {
    expect(collapseWhitespace([' a  ', ' b', 'c \n'])).toEqual([
      'a ',
      'b',
      'c',
    ]);
    expect(collapseWhitespace(['x', ' ', 'y'])).toEqual(['x', ' ', 'y']);
  });
});

describe('parseClipPolygon', () => {
  it('should resolve percentages and pixels', () => {
    expect(
      parseClipPolygon('polygon(50% 0px, 100% 100%, 0px 100%)', 10, 8),
    ).toEqual([
      [5, 0],
      [10, 8],
      [0, 8],
    ]);
    expect(parseClipPolygon('none', 10, 8)).toBeUndefined();
  });
});

describe('getRepeatingStripes', () => {
  it('should find opaque stripes of dashed legend marks', () => {
    const { direction, stripes } = getRepeatingStripes(
      'repeating-linear-gradient(to right, rgb(255, 0, 0) 0px, rgb(255, 0, 0) 4px, rgba(0, 0, 0, 0) 4px, rgba(0, 0, 0, 0) 6px)',
      14,
    );
    expect(direction).toBe('right');
    expect(stripes).toEqual([
      [0, 4, 'rgb(255, 0, 0)'],
      [6, 10, 'rgb(255, 0, 0)'],
      [12, 14, 'rgb(255, 0, 0)'],
    ]);
  });

  it('should ignore other backgrounds', () => {
    expect(getRepeatingStripes('none', 10).stripes).toEqual([]);
  });
});

describe('chainSegments', () => {
  it('should join segments in any order and direction', () => {
    const segments = Float64Array.from([2, 0, 3, 0, 0, 0, 1, 0, 2, 0, 1, 0]);
    expect(chainSegments(segments)).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ],
    ]);
  });

  it('should keep disjoint segments apart', () => {
    const segments = Float64Array.from([0, 0, 1, 0, 5, 5, 6, 6]);
    expect(chainSegments(segments)).toHaveLength(2);
  });
});

describe('decimate', () => {
  it('should keep first, last, lowest and highest point of each column', () => {
    const points = Array.from({ length: 100 }, (_, i): [number, number] => [
      i / 1000,
      Math.sin(i),
    ]);
    const result = decimate(points);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(points[0]);
    expect(result.at(-1)).toBe(points[99]);
    expect(Math.min(...result.map(([, y]) => y))).toBe(
      Math.min(...points.map(([, y]) => y)),
    );
  });

  it('should keep points in different columns', () => {
    const points = Array.from({ length: 10 }, (_, i): [number, number] => [
      i,
      i,
    ]);
    expect(decimate(points)).toEqual(points);
  });
});

describe('toPathData', () => {
  it('should skip single points', () => {
    expect(
      toPathData([
        [
          [0, 0],
          [1, 2.345],
        ],
        [[5, 5]],
      ]),
    ).toBe('M0 0L1 2.35');
  });
});

describe('getHermiteControls', () => {
  it('should place controls at thirds along slopes', () => {
    expect(getHermiteControls([0, 0], [3, 3], [0, 2])).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });
});
