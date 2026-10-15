import { type DimensionMapping, getValueToIndexScale } from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';

/* Probed pixel: index along each dimension on the axes when it was clicked */
export type ProbePoint = Partial<Record<number, number>>;

/* Dimension along which a pixel is probed: the hinted dimension if it is sliced, else the first
 * sliced dimension; `undefined` if no dimension is sliced */
export function getProbeDim(
  dimMapping: DimensionMapping,
  hinted?: number,
): number | undefined {
  if (hinted !== undefined && typeof dimMapping[hinted] === 'number') {
    return hinted;
  }
  const first = dimMapping.findIndex((dim) => typeof dim === 'number');
  return first === -1 ? undefined : first;
}

/* Selection of the values at a pixel along the probe dimension (other sliced dimensions at their
 * current index), e.g. `:,1,2,3`; `undefined` if the point doesn't give the index of a dimension
 * on the axes (e.g. axes changed since) */
export function getProbeSelection(
  dimMapping: DimensionMapping,
  probeDim: number,
  point: ProbePoint,
): string | undefined {
  const parts = dimMapping.map((dim, i) =>
    i === probeDim ? ':' : typeof dim === 'number' ? dim : point[i],
  );
  return parts.includes(undefined) ? undefined : parts.join(',');
}

/* Values at the edges of the pixels of a heatmap axis (as `HeatmapVis`) */
export function getPixelEdges(
  values: NumArray | undefined,
  count: number,
): number[] {
  if (!values) {
    return Array.from({ length: count + 1 }, (_, i) => i);
  }
  const edges = [...values].slice(0, count + 1);
  if (edges.length === count) {
    edges.push(edges[count - 1] + (edges[1] - edges[0])); // regularly spaced
  }
  return edges;
}

/* Index of the pixel at a coordinate along a heatmap axis; `undefined` outside the image */
export function getPixelIndex(
  coord: number,
  edges: number[],
): number | undefined {
  const [first, last] = [edges[0], edges.at(-1) ?? edges[0]];
  if (coord < Math.min(first, last) || coord > Math.max(first, last)) {
    return undefined;
  }
  return Math.min(getValueToIndexScale(edges)(coord), edges.length - 2);
}
