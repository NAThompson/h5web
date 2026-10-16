/* Pure helpers for `svg.ts` and `svgScene.ts`, kept free of DOM access for unit testing. */

import { splitTopLevel } from './utils';

export type Point = [number, number];
export type Subpath = Point[];

/* Number as short SVG attribute value (hundredths of a pixel) */
export function fmt(val: number): string {
  const rounded = Math.round(val * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/* Generic family of a computed `font-family`, so that exported text embeds anywhere */
export function getGenericFontFamily(
  fontFamily: string,
): 'serif' | 'sans-serif' | 'monospace' {
  const families = splitTopLevel(fontFamily).map((name) =>
    name.replaceAll(/["']/gu, '').trim().toLowerCase(),
  );
  for (const name of families) {
    if (/consol|courier|menlo|mono/u.test(name)) {
      return 'monospace';
    }
    if (name === 'serif' || /garamond|georgia|^math$|times/u.test(name)) {
      return 'serif';
    }
    if (name === 'sans-serif' || name !== '') {
      return 'sans-serif';
    }
  }
  return 'sans-serif';
}

/* Whitespace collapsing of SVG text (`xml:space` default): one space between words */
export function collapseWhitespace(texts: string[]): string[] {
  let previousEndsWithSpace = true; // trims leading space of first text
  const collapsed = texts.map((text) => {
    let result = text.replaceAll(/\s+/gu, ' ');
    if (previousEndsWithSpace && result.startsWith(' ')) {
      result = result.slice(1);
    }
    if (result !== '') {
      previousEndsWithSpace = result.endsWith(' ');
    }
    return result;
  });

  // Trim trailing space of last non-empty text
  for (let i = collapsed.length - 1; i >= 0; i--) {
    if (collapsed[i] !== '') {
      collapsed[i] = collapsed[i].replace(/ $/u, '');
      break;
    }
  }
  return collapsed;
}

export function escapeXml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function lengthToPx(len: string, size: number): number {
  return len.endsWith('%')
    ? (Number.parseFloat(len) / 100) * size
    : Number.parseFloat(len) || 0;
}

/* Vertices of a computed `clip-path: polygon(...)` in a box of the given size */
export function parseClipPolygon(
  value: string,
  width: number,
  height: number,
): Point[] | undefined {
  const match = /^polygon\((.*)\)$/u.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const points = splitTopLevel(match[1].replace(/^(?:evenodd|nonzero),/u, ''))
    .map((pair) => pair.split(/\s+/u))
    .map(([x = '0', y = '0']): Point => [
      lengthToPx(x, width),
      lengthToPx(y, height),
    ]);
  return points.length >= 3 ? points : undefined;
}

/* Opaque stripes of a computed `repeating-linear-gradient(to right|bottom, ...)` with
 * stops in pixels (e.g. dashed legend marks), as `[start, end, color]` along `length` */
export function getRepeatingStripes(
  value: string,
  length: number,
): { direction: 'right' | 'bottom'; stripes: [number, number, string][] } {
  const empty = { direction: 'right' as const, stripes: [] };
  const match = /^repeating-linear-gradient\(to (bottom|right), (.*)\)$/u.exec(
    value.trim(),
  );
  if (!match) {
    return empty;
  }

  const stops = splitTopLevel(match[2]).flatMap((arg) => {
    const [color, ...positions] = splitTopLevel(arg, ' ');
    return positions.map((pos) => ({ color, pos: Number.parseFloat(pos) }));
  });
  const period = stops.at(-1)?.pos ?? 0;
  if (
    stops.length < 2 ||
    !(period > 0) ||
    stops.some((s) => Number.isNaN(s.pos))
  ) {
    return empty;
  }

  // Constant-colour intervals between consecutive stops
  const bands = stops
    .slice(1)
    .flatMap((stop, i): [number, number, string][] => {
      const prev = stops[i];
      const isOpaque = !/^(?:transparent|rgba\(.*,\s*0\))$/u.test(prev.color);
      return stop.color === prev.color && stop.pos > prev.pos && isOpaque
        ? [[prev.pos, stop.pos, prev.color]]
        : [];
    });

  const stripes: [number, number, string][] = [];
  for (let offset = 0; offset < length && bands.length > 0; offset += period) {
    for (const [start, end, color] of bands) {
      if (offset + start < length) {
        stripes.push([offset + start, Math.min(offset + end, length), color]);
      }
    }
  }
  return { direction: match[1] as 'right' | 'bottom', stripes };
}

/* Join segments `[x0, y0, x1, y1]` that share end points into subpaths (e.g. contour
 * lines, whose segments come in any order), so that strokes and dashes are continuous */
export function chainSegments(
  segments: Float64Array,
  tolerance = 0.01,
): Subpath[] {
  const count = segments.length / 4;
  function key(x: number, y: number): string {
    return `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
  }

  // Segments by key of each of their end points
  const byPoint = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    for (const end of [0, 1]) {
      const k = key(segments[i * 4 + end * 2], segments[i * 4 + end * 2 + 1]);
      const list = byPoint.get(k);
      if (list) {
        list.push(i);
      } else {
        byPoint.set(k, [i]);
      }
    }
  }

  const used = new Uint8Array(count);
  function takeFrom(point: Point): Point | undefined {
    const candidates = byPoint.get(key(...point)) ?? [];
    for (const i of candidates) {
      if (!used[i]) {
        used[i] = 1;
        const [x0, y0, x1, y1] = segments.subarray(i * 4, i * 4 + 4);
        return key(x0, y0) === key(...point) ? [x1, y1] : [x0, y0];
      }
    }
    return undefined;
  }

  const subpaths: Subpath[] = [];
  for (let i = 0; i < count; i++) {
    if (used[i]) {
      continue;
    }
    used[i] = 1;
    const [x0, y0, x1, y1] = segments.subarray(i * 4, i * 4 + 4);
    const forward: Point[] = [[x1, y1]];
    for (let p = takeFrom(forward[0]); p; p = takeFrom(p)) {
      forward.push(p);
    }
    const backward: Point[] = [];
    for (let p = takeFrom([x0, y0]); p; p = takeFrom(p)) {
      backward.push(p);
    }
    subpaths.push([...backward.reverse(), [x0, y0], ...forward]);
  }
  return subpaths;
}

/* Drop points that can't be told apart at screen resolution: within each run of points
 * in the same column of `step` pixels, keep the first, last, lowest and highest (M4) */
export function decimate(subpath: Subpath, step = 0.5): Subpath {
  if (subpath.length <= 4) {
    return subpath;
  }

  const result: Point[] = [];
  let start = 0;
  function flush(end: number) {
    // Points `start..end` (exclusive) share a column
    if (end - start <= 4) {
      result.push(...subpath.slice(start, end));
      return;
    }
    let [lo, hi] = [start, start];
    for (let i = start; i < end; i++) {
      if (subpath[i][1] < subpath[lo][1]) {
        lo = i;
      }
      if (subpath[i][1] > subpath[hi][1]) {
        hi = i;
      }
    }
    const kept = [...new Set([start, lo, hi, end - 1])].sort((a, b) => a - b);
    result.push(...kept.map((i) => subpath[i]));
  }

  for (let i = 1; i <= subpath.length; i++) {
    if (
      i === subpath.length ||
      Math.floor(subpath[i][0] / step) !== Math.floor(subpath[start][0] / step)
    ) {
      flush(i);
      start = i;
    }
  }
  return result;
}

export function toPathData(subpaths: Subpath[]): string {
  return subpaths
    .filter((points) => points.length > 1)
    .map(
      (points) => `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join('L')}`,
    )
    .join('');
}

/* Bézier control points of the cubic Hermite interpolant between two points with the
 * given slopes (`dy/dx`), as drawn by PCHIP lines */
export function getHermiteControls(
  start: Point,
  end: Point,
  slopes: [number, number],
): [Point, Point] {
  const width = end[0] - start[0];
  return [
    [start[0] + width / 3, start[1] + (slopes[0] * width) / 3],
    [end[0] - width / 3, end[1] - (slopes[1] * width) / 3],
  ];
}
