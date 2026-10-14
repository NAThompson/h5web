/* eslint-disable no-bitwise, complexity, max-depth, unicorn/prefer-single-call -- tight loops over corner bitmasks */
import { GrowableArray } from '../geometry-worker/buffers';
import {
  crossingRatio,
  getScaleTransform,
  type ScaleTransform,
} from '../geometry-worker/scale';

export interface ContourGeometry {
  level: number;
  /* Vertex coordinates `[x0, y0, x1, y1, ...]` in pixel-edge index space:
   * the centre of pixel `(row, col)` is at `(col + 0.5, row + 0.5)` */
  vertices: Float32Array;
  /* Pairs of vertex indices, one pair per line segment */
  segments: Uint32Array;
}

export interface ContourLabelAnchor {
  x: number;
  y: number;
  angle: number; // radians, in index space, kept within [-π/2, π/2] for readability
}

export interface MarchingSquaresOptions {
  scaleType?: string | [string, number];
}

const ROWS_PER_STEP = 64;

/*
 * Marching squares with welded vertices (one per crossed grid edge) and
 * saddle cells disambiguated with the bilinear centre value ("asymptotic decider").
 * Cells with a NaN or otherwise invalid corner (e.g. non-positive in log scale) are skipped.
 * Yields progress in [0, 1] every few rows so callers can report progress or cancel.
 */
export function* marchingSquaresSteps(
  values: ArrayLike<number>,
  shape: [rows: number, cols: number],
  level: number,
  opts: MarchingSquaresOptions = {},
): Generator<number, ContourGeometry> {
  const [rows, cols] = shape;
  const transform = getScaleTransform(opts.scaleType);

  const vertices = new GrowableArray(Float32Array);
  const segments = new GrowableArray(Uint32Array);

  if (rows < 2 || cols < 2 || !transform.isValid(level)) {
    return {
      level,
      vertices: vertices.toArray(),
      segments: segments.toArray(),
    };
  }

  // Vertex index of the crossing on each horizontal edge of the current and next rows, and on each vertical edge between them
  let hBottom = new Int32Array(cols - 1).fill(-1);
  let hTop = new Int32Array(cols - 1).fill(-1);
  const vEdges = new Int32Array(cols);

  let vertexCount = 0;
  function addVertex(x: number, y: number): number {
    vertices.push(x);
    vertices.push(y);
    vertexCount += 1;
    return vertexCount - 1;
  }

  function crossing(a: number, b: number): number {
    return crossingRatio(a, b, level, transform.fn);
  }

  const cellEdges = new Int32Array(4);

  for (let r = 0; r < rows - 1; r += 1) {
    vEdges.fill(-1);
    const rowOffset = r * cols;
    const nextRowOffset = rowOffset + cols;

    for (let c = 0; c < cols - 1; c += 1) {
      const v0 = values[rowOffset + c]; // bottom-left
      const v1 = values[rowOffset + c + 1]; // bottom-right
      const v2 = values[nextRowOffset + c + 1]; // top-right
      const v3 = values[nextRowOffset + c]; // top-left

      if (
        !isValidCorner(v0, transform) ||
        !isValidCorner(v1, transform) ||
        !isValidCorner(v2, transform) ||
        !isValidCorner(v3, transform)
      ) {
        continue;
      }

      const caseIndex =
        (v0 >= level ? 1 : 0) |
        (v1 >= level ? 2 : 0) |
        (v2 >= level ? 4 : 0) |
        (v3 >= level ? 8 : 0);

      if (caseIndex === 0 || caseIndex === 15) {
        continue;
      }

      // Edges walked counter-clockwise: 0 = bottom, 1 = right, 2 = top, 3 = left
      const x = c + 0.5;
      const y = r + 0.5;
      cellEdges.fill(-1);

      if ((caseIndex & 1) !== ((caseIndex >> 1) & 1)) {
        if (hBottom[c] < 0) {
          hBottom[c] = addVertex(x + crossing(v0, v1), y);
        }
        cellEdges[0] = hBottom[c];
      }
      if (((caseIndex >> 1) & 1) !== ((caseIndex >> 2) & 1)) {
        if (vEdges[c + 1] < 0) {
          vEdges[c + 1] = addVertex(x + 1, y + crossing(v1, v2));
        }
        cellEdges[1] = vEdges[c + 1];
      }
      if (((caseIndex >> 3) & 1) !== ((caseIndex >> 2) & 1)) {
        if (hTop[c] < 0) {
          hTop[c] = addVertex(x + crossing(v3, v2), y + 1);
        }
        cellEdges[2] = hTop[c];
      }
      if ((caseIndex & 1) !== ((caseIndex >> 3) & 1)) {
        if (vEdges[c] < 0) {
          vEdges[c] = addVertex(x, y + crossing(v0, v3));
        }
        cellEdges[3] = vEdges[c];
      }

      if (caseIndex === 5 || caseIndex === 10) {
        // Saddle: are the corners on the diagonal of `v0` connected through the centre?
        const centre = (v0 + v1 + v2 + v3) / 4;
        const v0Connected = centre >= level === v0 >= level;
        if (v0Connected) {
          // Cut off `v1` and `v3`
          pushSegment(segments, cellEdges[0], cellEdges[1]);
          pushSegment(segments, cellEdges[2], cellEdges[3]);
        } else {
          // Cut off `v0` and `v2`
          pushSegment(segments, cellEdges[3], cellEdges[0]);
          pushSegment(segments, cellEdges[1], cellEdges[2]);
        }
      } else {
        let first = -1;
        for (const vertex of cellEdges) {
          if (vertex >= 0) {
            if (first < 0) {
              first = vertex;
            } else {
              pushSegment(segments, first, vertex);
            }
          }
        }
      }
    }

    // Top edges of this row become bottom edges of the next one
    [hBottom, hTop] = [hTop, hBottom];
    hTop.fill(-1);

    if (r % ROWS_PER_STEP === ROWS_PER_STEP - 1) {
      yield (r + 1) / (rows - 1);
    }
  }

  return { level, vertices: vertices.toArray(), segments: segments.toArray() };
}

export function marchingSquares(
  values: ArrayLike<number>,
  shape: [rows: number, cols: number],
  level: number,
  opts?: MarchingSquaresOptions,
): ContourGeometry {
  return runToCompletion(marchingSquaresSteps(values, shape, level, opts));
}

export function runToCompletion<T>(gen: Generator<number, T>): T {
  let res = gen.next();
  while (!res.done) {
    res = gen.next();
  }
  return res.value;
}

function isValidCorner(val: number, transform: ScaleTransform): boolean {
  return transform.isValid(val);
}

function pushSegment(
  segments: GrowableArray<Uint32Array>,
  a: number,
  b: number,
): void {
  segments.push(a);
  segments.push(b);
}

/* Chain segments into polylines (lists of vertex indices) */
export function getPolylines(geometry: ContourGeometry): number[][] {
  const { vertices, segments } = geometry;
  const vertexCount = vertices.length / 2;

  // Each welded vertex is shared by at most two segments
  const neighbours = new Int32Array(vertexCount * 2).fill(-1);
  for (let i = 0; i < segments.length; i += 2) {
    const a = segments[i];
    const b = segments[i + 1];
    neighbours[a * 2 + (neighbours[a * 2] < 0 ? 0 : 1)] = b;
    neighbours[b * 2 + (neighbours[b * 2] < 0 ? 0 : 1)] = a;
  }

  const visited = new Uint8Array(vertexCount);
  const polylines: number[][] = [];

  function walk(start: number): number[] {
    const line = [start];
    visited[start] = 1;
    let prev = -1;
    let current = start;
    for (;;) {
      const n0 = neighbours[current * 2];
      const n1 = neighbours[current * 2 + 1];
      const next = n0 === prev ? n1 : n0;
      if (next < 0 || visited[next]) {
        if (next === start && line.length > 2) {
          line.push(start); // close loop
        }
        return line;
      }
      line.push(next);
      visited[next] = 1;
      prev = current;
      current = next;
    }
  }

  // Open polylines first (start from their ends), then closed loops
  for (let v = 0; v < vertexCount; v += 1) {
    const isEnd = neighbours[v * 2] >= 0 && neighbours[v * 2 + 1] < 0;
    if (isEnd && !visited[v]) {
      polylines.push(walk(v));
    }
  }
  for (let v = 0; v < vertexCount; v += 1) {
    if (!visited[v] && neighbours[v * 2] >= 0) {
      polylines.push(walk(v));
    }
  }

  return polylines;
}

/* Place labels along polylines that are long enough, spaced by `spacing` (in pixels of the index grid) */
export function getLabelAnchors(
  geometry: ContourGeometry,
  opts: { minLength: number; spacing: number; maxCount: number },
): ContourLabelAnchor[] {
  const { minLength, spacing, maxCount } = opts;
  const { vertices } = geometry;
  const anchors: ContourLabelAnchor[] = [];

  const polylines = getPolylines(geometry)
    .map((line) => ({ line, length: getPolylineLength(vertices, line) }))
    .filter(({ length }) => length >= minLength)
    .sort((a, b) => b.length - a.length);

  for (const { line, length } of polylines) {
    const count = Math.max(1, Math.floor(length / spacing));
    const step = length / count;
    let target = step / 2;
    let travelled = 0;

    for (let i = 1; i < line.length && anchors.length < maxCount; i += 1) {
      const x0 = vertices[line[i - 1] * 2];
      const y0 = vertices[line[i - 1] * 2 + 1];
      const x1 = vertices[line[i] * 2];
      const y1 = vertices[line[i] * 2 + 1];
      const segLength = Math.hypot(x1 - x0, y1 - y0);

      while (target <= travelled + segLength && anchors.length < maxCount) {
        const t = segLength > 0 ? (target - travelled) / segLength : 0;
        let angle = Math.atan2(y1 - y0, x1 - x0);
        if (angle > Math.PI / 2) {
          angle -= Math.PI;
        } else if (angle < -Math.PI / 2) {
          angle += Math.PI;
        }
        anchors.push({ x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0), angle });
        target += step;
      }
      travelled += segLength;
    }

    if (anchors.length >= maxCount) {
      break;
    }
  }

  return anchors;
}

function getPolylineLength(vertices: Float32Array, line: number[]): number {
  let length = 0;
  for (let i = 1; i < line.length; i += 1) {
    length += Math.hypot(
      vertices[line[i] * 2] - vertices[line[i - 1] * 2],
      vertices[line[i] * 2 + 1] - vertices[line[i - 1] * 2 + 1],
    );
  }
  return length;
}
