import { type Axis, type DimensionMapping } from '@h5web/lib';
import { type Domain, ScaleType } from '@h5web/shared/vis-models';

import { type PanelKind, type PanelSpec } from './models';

export const MAX_PANELS = 1024; // more would take too long to fetch and draw
export const SNAPSHOT_MAX_PANELS = 256; // loaded for a snapshot, if not seen yet
export const MAX_LISTED_VALUES = 8; // panels: the readout lists the values of all linked ones

/* Rows and columns of a grid of `count` panels: as hinted (more rows if too few), else near-square,
 * wider than tall */
export function getGridSize(
  count: number,
  layout?: [number, number],
): [number, number] {
  if (layout) {
    const [rows, cols] = layout;
    return [Math.max(rows, Math.ceil(count / cols)), cols];
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return [Math.max(1, Math.ceil(count / cols)), cols];
}

export interface DimsInfo {
  dims: number[];
  scales: string[][]; // paths of the dimension scales attached to each dimension
}

/* Dimension of `ref` that dimension `i` of `panel` slices along with: same dimension scale (and
 * length), else the same dimension of a dataset of the same shape without scales on it */
export function matchDim(
  panel: DimsInfo,
  ref: DimsInfo,
  i: number,
): number | undefined {
  const scales = panel.scales[i] ?? [];
  const j = ref.dims.findIndex(
    (size, d) =>
      size === panel.dims[i] &&
      scales.some((path) => (ref.scales[d] ?? []).includes(path)),
  );
  if (j !== -1) {
    return j;
  }
  const isSameShape =
    panel.dims.length === ref.dims.length &&
    panel.dims.every((size, d) => size === ref.dims[d]);
  return isSameShape &&
    scales.length === 0 &&
    (ref.scales[i] ?? []).length === 0
    ? i
    : undefined;
}

export function getPanelAxes(kind: PanelKind): Axis[] {
  return kind === 'heatmap' ? ['x', 'y'] : ['x'];
}

/* Mapping of a panel's dimensions that follows the reference's (cf. `matchDim`): slicing indices
 * and axes it can show, other axes on its last free dimensions (as by default), else on sliced
 * ones, other dimensions at index 0 */
export function getPanelMapping(
  panel: DimsInfo,
  kind: PanelKind,
  ref: DimsInfo,
  refMapping: DimensionMapping,
): DimensionMapping {
  const axes = getPanelAxes(kind);
  const mapping: (Axis | number | undefined)[] = panel.dims.map((_, i) => {
    const j = matchDim(panel, ref, i);
    const refDim = j === undefined ? undefined : refMapping[j];
    if (typeof refDim === 'number') {
      return refDim; // same length (cf. `matchDim`)
    }
    return refDim && axes.includes(refDim) ? refDim : undefined;
  });

  // Each axis once
  axes.forEach((axis) => {
    const first = mapping.indexOf(axis);
    mapping.forEach((dim, i) => {
      if (dim === axis && i !== first) {
        mapping[i] = undefined;
      }
    });
  });

  // Missing axes on the last free dimensions (`x` last), else on the last sliced ones
  for (const axis of axes) {
    if (!mapping.includes(axis)) {
      const free = mapping.lastIndexOf(undefined);
      const sliced = mapping.findLastIndex((dim) => typeof dim === 'number');
      const index = free === -1 ? sliced : free;
      if (index !== -1) {
        mapping[index] = axis;
      }
    }
  }

  return mapping.map((dim) => dim ?? 0);
}

/* Values of all dimensions from those of all but `dims`, and those of `dims` */
function insertAt<T>(values: T[], dims: number[], inserted: T[]): T[] {
  const rest = [...values];
  return Array.from({ length: values.length + dims.length }, (_, d) => {
    const k = dims.indexOf(d);
    return k === -1 ? (rest.shift() as T) : inserted[k];
  });
}

/* Mapping of a dataset's dimensions from the mapping of all but the multiples dimensions, and
 * the indices of these */
export function insertIndices(
  subMapping: DimensionMapping,
  multiplesDims: number[],
  indices: number[],
): DimensionMapping {
  return insertAt<DimensionMapping[number]>(subMapping, multiplesDims, indices);
}

/* Slicing selection of a dataset (e.g. `2,0,:,:`) from the selection of all but the multiples
 * dimensions (`undefined`: none sliced), and the indices of these */
export function insertSelectionIndices(
  subSelection: string | undefined,
  subRank: number,
  multiplesDims: number[],
  indices: number[],
): string {
  const parts =
    subSelection?.split(',') ?? Array.from({ length: subRank }, () => ':');
  return insertAt(parts, multiplesDims, indices.map(String)).join(',');
}

/* Panels of small multiples along one or two dimensions, with their places in the grid: rows along
 * the first dimension, columns along the second; one dimension: `cols` per row. Only the first
 * `max` panels. */
export function getMultiplesGrid(
  sizes: number[],
  cols: number,
  max: number,
): { indices: number[]; row: number; col: number }[] {
  const count = Math.min(
    sizes.reduce((acc, size) => acc * size, 1),
    max,
  );
  return Array.from({ length: count }, (_, i) => {
    const [row, col] = [Math.floor(i / cols), i % cols];
    return { indices: sizes.length === 2 ? [row, col] : [i], row, col };
  });
}

/* Row of the bottom-most panel of each column (e.g. above the end of a partial last row) */
export function getBottomRows(
  panels: { row: number; col: number }[],
): Map<number, number> {
  const bottomRows = new Map<number, number>();
  panels.forEach(({ row, col }) => {
    bottomRows.set(col, Math.max(row, bottomRows.get(col) ?? 0));
  });
  return bottomRows;
}

/* Heatmap panels whose colours can be shared: same colour scale and map, and same values and
 * colours beyond the domain on the colour bar (else the colour bar of the group, as its first
 * member's, could differ from some of them) */
export function getColorGroup(spec: PanelSpec): string | undefined {
  if (spec.kind !== 'heatmap') {
    return undefined;
  }
  const { scaleType = ScaleType.Linear, colorMap, invertColorMap } = spec.hint;
  const { valueTransform, belowColor, aboveColor } = spec.hint;
  const threshold =
    scaleType === ScaleType.SymLog ? spec.hint.symlogThreshold : undefined;
  return [
    scaleType,
    colorMap,
    invertColorMap,
    threshold,
    valueTransform,
    belowColor,
    aboveColor,
  ].join('|');
}

/* Smallest domain containing the given ones (`undefined` if none) */
export function combineDomains(
  domains: (Domain | undefined)[],
): Domain | undefined {
  const defined = domains.filter(
    (domain): domain is Domain =>
      !!domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]),
  );
  if (defined.length === 0) {
    return undefined;
  }
  return [
    Math.min(...defined.map(([min]) => min)),
    Math.max(...defined.map(([, max]) => max)),
  ];
}

/* Label of an index of a dimension: its slice label, else its value on the dimension's scale */
export function formatIndexLabel(
  name: string,
  index: number,
  values: ArrayLike<number | bigint> | undefined,
  labels: string[] | undefined,
): string {
  const label = labels?.[index];
  if (label) {
    return label;
  }
  const value = values?.[index];
  if (value === undefined) {
    return `${name} = ${index}`;
  }
  const num = Number(value);
  return `${name} = ${Number.isInteger(num) ? num : Number(num.toPrecision(4))}`;
}
