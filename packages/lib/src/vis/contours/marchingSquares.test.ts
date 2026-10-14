import { describe, expect, it } from 'vitest';

import {
  type ContourGeometry,
  getLabelAnchors,
  getPolylines,
  marchingSquares,
} from './marchingSquares';

function sampleImage(
  rows: number,
  cols: number,
  fn: (x: number, y: number) => number,
): Float64Array {
  const values = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      values[r * cols + c] = fn(c, r);
    }
  }
  return values;
}

function points(geom: ContourGeometry): [number, number][] {
  return Array.from({ length: geom.vertices.length / 2 }, (_, i) => [
    geom.vertices[i * 2],
    geom.vertices[i * 2 + 1],
  ]);
}

describe('marchingSquares', () => {
  it('should approximate a circle with a single closed polyline', () => {
    const n = 64;
    const c = (n - 1) / 2;
    const radius = 20;
    const values = sampleImage(n, n, (x, y) => Math.hypot(x - c, y - c));

    const geom = marchingSquares(values, [n, n], radius);
    expect(geom.segments.length / 2).toBeGreaterThan(100);

    // Pixel centres are at +0.5 in pixel-edge index space
    const centre = c + 0.5;
    for (const [x, y] of points(geom)) {
      expect(
        Math.abs(Math.hypot(x - centre, y - centre) - radius),
      ).toBeLessThan(0.05);
    }

    const polylines = getPolylines(geom);
    expect(polylines).toHaveLength(1);
    expect(polylines[0][0]).toBe(polylines[0].at(-1)); // closed
    expect(polylines[0]).toHaveLength(geom.vertices.length / 2 + 1);
  });

  it('should extract straight lines exactly, as open polylines', () => {
    const values = sampleImage(5, 8, (x, y) => x + 0.1 * y);
    const geom = marchingSquares(values, [5, 8], 2.7);

    for (const [x, y] of points(geom)) {
      expect(x - 0.5 + 0.1 * (y - 0.5)).toBeCloseTo(2.7, 5);
    }
    const polylines = getPolylines(geom);
    expect(polylines).toHaveLength(1);
    expect(polylines[0]).toHaveLength(5); // one vertex per row
  });

  it('should disambiguate saddles with the centre value', () => {
    // v0 (bottom-left) and v2 (top-right) are high, v1 and v3 are low
    const values = Float64Array.from([1, 0, 0, 1]);

    // Centre (0.5) is above 0.4, so the high corners are connected: v1 and v3 are cut off
    const low = marchingSquares(values, [2, 2], 0.4);
    expect(low.segments).toHaveLength(4);
    const lowLines = getPolylines(low).map((line) =>
      line.map((v) => [low.vertices[v * 2], low.vertices[v * 2 + 1]]),
    );
    for (const line of lowLines) {
      const midX = (line[0][0] + line[1][0]) / 2;
      const midY = (line[0][1] + line[1][1]) / 2;
      // Each segment hugs either the bottom-right or the top-left corner
      expect(midX > 1).toBe(midY < 1);
    }

    // Centre is below 0.6, so the high corners are separated: v0 and v2 are cut off
    const high = marchingSquares(values, [2, 2], 0.6);
    const highLines = getPolylines(high).map((line) =>
      line.map((v) => [high.vertices[v * 2], high.vertices[v * 2 + 1]]),
    );
    expect(highLines).toHaveLength(2);
    for (const line of highLines) {
      const midX = (line[0][0] + line[1][0]) / 2;
      const midY = (line[0][1] + line[1][1]) / 2;
      expect(midX < 1).toBe(midY < 1);
    }
  });

  it('should skip cells with NaN or invalid corners', () => {
    const values = sampleImage(10, 10, (x) => (x === 4 ? Number.NaN : x));
    const geom = marchingSquares(values, [10, 10], 4.5);
    expect(geom.segments).toHaveLength(0); // the only crossing cells contain NaNs

    const other = marchingSquares(values, [10, 10], 6.5);
    expect(other.segments.length / 2).toBe(9);

    // Non-positive values are invalid in log scale
    const logValues = sampleImage(2, 4, (x) => [-1, 0, 10, 100][x]);
    expect(
      marchingSquares(logValues, [2, 4], 0.5, { scaleType: 'log' }).segments,
    ).toHaveLength(0);
    const logGeom = marchingSquares(logValues, [2, 4], 10 ** 1.5, {
      scaleType: 'log',
    });
    for (const [x] of points(logGeom)) {
      expect(x).toBeCloseTo(3, 5); // halfway between pixel centres 2.5 and 3.5
    }
  });

  it('should return nothing for degenerate images or invalid levels', () => {
    expect(marchingSquares([1, 2, 3], [1, 3], 1.5).segments).toHaveLength(0);
    expect(
      marchingSquares([1, 2, 3, 4], [2, 2], -1, { scaleType: 'log' }).segments,
    ).toHaveLength(0);
  });
});

describe('getLabelAnchors', () => {
  it('should place labels along long enough polylines', () => {
    const n = 64;
    const c = (n - 1) / 2;
    const values = sampleImage(n, n, (x, y) => Math.hypot(x - c, y - c));

    const big = marchingSquares(values, [n, n], 20);
    const anchors = getLabelAnchors(big, {
      minLength: 10,
      spacing: 40,
      maxCount: 10,
    });
    expect(anchors).toHaveLength(3); // circumference ~125.7
    for (const { x, y, angle } of anchors) {
      expect(Math.hypot(x - c - 0.5, y - c - 0.5)).toBeCloseTo(20, 0);
      expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI / 2);
    }

    const small = marchingSquares(values, [n, n], 1);
    expect(
      getLabelAnchors(small, { minLength: 10, spacing: 40, maxCount: 10 }),
    ).toHaveLength(0);
  });
});
