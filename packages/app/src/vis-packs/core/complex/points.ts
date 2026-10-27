import { type Domain } from '@h5web/shared/vis-models';

import {
  type OverlayLine,
  type OverlayPoints,
  type ResolvedOverlay,
} from '../../view-hints/overlays';
import {
  REFERENCE_COLOR,
  type ReferenceShape,
} from '../../view-hints/references';

const PADDING = 0.08; // of the larger extent, around the shapes (markers on the edge are whole)
export const MERGE_TOLERANCE = 1e-3; // of the larger extent: points closer than this coincide

function getBounds(values: number[]): Domain | undefined {
  let [min, max] = [Infinity, -Infinity];
  for (const val of values) {
    if (Number.isFinite(val)) {
      [min, max] = [Math.min(min, val), Math.max(max, val)];
    }
  }
  return min <= max ? [min, max] : undefined;
}

function spanOf(domain: Domain | undefined): number {
  return domain ? domain[1] - domain[0] : 0;
}

/* Bounds with 0, if 0 is within `near` of them (e.g. stable poles left of the imaginary axis) */
function withZero([lo, hi]: Domain, near: number): Domain {
  return lo - near <= 0 && hi + near >= 0
    ? [Math.min(lo, 0), Math.max(hi, 0)]
    : [lo, hi];
}

/* Domain padded by a fraction of `extent`; a flat one (e.g. all values real) spans `extent` */
function pad(domain: Domain, extent: number): Domain {
  const half = spanOf(domain) > 0 ? spanOf(domain) / 2 : extent / 2;
  const mid = (domain[0] + domain[1]) / 2;
  return [mid - half - PADDING * extent, mid + half + PADDING * extent];
}

/**
 * Domains of the axes of the complex plane: around all points, lines (e.g. circles) and reference
 * lines, with 0 if near, padded; [-1, 1] if there is nothing to show. Also returns the larger
 * extent of the two, before padding.
 */
export function getPlaneDomains(
  points: Pick<OverlayPoints, 'x' | 'y'>[],
  lines: Pick<OverlayLine, 'x' | 'y'>[],
  references: ReferenceShape[],
): { xDomain: Domain; yDomain: Domain; extent: number } {
  const shapes = [...points, ...lines];
  const [xBounds, yBounds] = (['x', 'y'] as const).map((axis) =>
    getBounds([
      ...shapes.flatMap((shape) => shape[axis]),
      ...references.flatMap((ref) => (ref.axis === axis ? ref.values : [])),
    ]),
  );
  if (!xBounds && !yBounds) {
    return { xDomain: [-1, 1], yDomain: [-1, 1], extent: 2 };
  }

  // All on one spot: 0 is near if within its magnitude
  const magnitude = Math.max(
    ...[...(xBounds ?? []), ...(yBounds ?? [])].map(Math.abs),
  );
  const near = Math.max(spanOf(xBounds), spanOf(yBounds)) || magnitude || 1;
  const x = withZero(xBounds ?? [0, 0], near);
  const y = withZero(yBounds ?? [0, 0], near);

  const extent = Math.max(spanOf(x), spanOf(y)) || magnitude || 1;
  return { xDomain: pad(x, extent), yDomain: pad(y, extent), extent };
}

/* Points within `tolerance` of each other (on both axes) drawn once, with their multiplicity in
 * `counts` (e.g. a double pole); the first point of each group is kept */
export function mergeCoincidentPoints(
  points: OverlayPoints,
  tolerance: number,
): OverlayPoints {
  const { x, y, values } = points;
  const cells = new Map<string, number[]>(); // indices of kept points by grid cell
  const kept: number[] = [];
  const counts: number[] = [];

  for (const [i, xi] of x.entries()) {
    const yi = y[i];
    if (!Number.isFinite(xi) || !Number.isFinite(yi) || tolerance <= 0) {
      kept.push(i);
      counts.push(1);
      continue;
    }

    const [cx, cy] = [Math.floor(xi / tolerance), Math.floor(yi / tolerance)];
    const near = [-1, 0, 1]
      .flatMap((dx) => [-1, 0, 1].map((dy) => `${cx + dx},${cy + dy}`))
      .flatMap((key) => cells.get(key) ?? [])
      .find(
        (k) =>
          Math.abs(x[kept[k]] - xi) <= tolerance &&
          Math.abs(y[kept[k]] - yi) <= tolerance,
      );
    if (near === undefined) {
      const key = `${cx},${cy}`;
      cells.set(key, [...(cells.get(key) ?? []), kept.length]);
      kept.push(i);
      counts.push(1);
    } else {
      counts[near] += 1;
    }
  }

  if (kept.length === x.length) {
    return points;
  }
  return {
    ...points,
    x: kept.map((i) => x[i]),
    y: kept.map((i) => y[i]),
    z: undefined,
    values: values && kept.map((i) => values[i]),
    counts,
  };
}

/* Style of overlays on the complex plane, where they lie on a plain background rather than an
 * image: points without a colour take the next colour of the palette, other shapes are grey; no
 * halo unless asked for */
export function withPlaneStyle(
  overlays: ResolvedOverlay[],
  palette: readonly string[],
): ResolvedOverlay[] {
  let next = 1; // the base dataset's points take the first colour
  return overlays.map((overlay) => {
    const { hint } = overlay;
    const color =
      hint.color ??
      (hint.kind === 'points'
        ? palette[next++ % palette.length]
        : REFERENCE_COLOR);
    return { ...overlay, hint: { ...hint, color, halo: hint.halo ?? false } };
  });
}
