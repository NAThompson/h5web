import { type DimensionMapping } from '@h5web/lib';
import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';

import { type Projection } from '../../view-hints/models';

export const PROJECTIONS: Projection[] = ['max', 'min', 'mean', 'sum'];

/* Reduction of a sliced dimension of a heatmap stack, shown instead of a slice */
export interface HeatmapProjection {
  kind: Projection;
  dim: number; // of the dataset
}

/* Dimension reduced by a projection: the hinted / chosen one if it is sliced, else the first
 * sliced dimension; `undefined` if no dimension is sliced */
export function getProjectionDim(
  dimMapping: DimensionMapping,
  chosen?: number,
): number | undefined {
  if (chosen !== undefined && typeof dimMapping[chosen] === 'number') {
    return chosen;
  }
  const first = dimMapping.findIndex((dim) => typeof dim === 'number');
  return first === -1 ? undefined : first;
}

/* Selection of the values to project: the projected dimension whole, other sliced dimensions at
 * their index (e.g. `:,2,:,:`); `undefined` to fetch the whole dataset */
export function getProjectionSelection(
  dimMapping: DimensionMapping,
  projectedDim: number,
): string | undefined {
  const parts = dimMapping.map((val, i) =>
    i === projectedDim || typeof val !== 'number' ? ':' : val,
  );
  return parts.every((part) => part === ':') ? undefined : parts.join(',');
}

/**
 * Reduction of an array of dimensions `dims` (row-major) along `axis`, ignoring NaN and ignored
 * values (as NumPy's `nanmax`, `nanmin`, `nanmean`, `nansum`): max, min and mean of values that
 * are all NaN are NaN; their sum is 0. Accumulates in double precision.
 */
export function projectArray(
  values: NumArray,
  dims: number[],
  axis: number,
  projection: Projection,
  ignoreValue?: IgnoreValue,
): Float64Array {
  const length = dims[axis];
  const inner = dims.slice(axis + 1).reduce((acc, dim) => acc * dim, 1);
  const outer = dims.slice(0, axis).reduce((acc, dim) => acc * dim, 1);
  const size = outer * inner;

  // Along the last dimension, the values of each result are contiguous
  if (inner === 1) {
    const reduce = RUN_REDUCERS[projection];
    return Float64Array.from({ length: outer }, (_, o) =>
      reduce(values, o * length, length, ignoreValue),
    );
  }

  // Ignored values (e.g. netCDF fill values) count as NaN: checked as values are read (not on
  // a copy of the stack), and only if there are any
  const isExtremum = projection === 'max' || projection === 'min';
  const acc = new Float64Array(size).fill(isExtremum ? Number.NaN : 0);
  const counts = new Uint32Array(projection === 'mean' ? size : 0);

  // Reduce a row of `inner` contiguous values into a row of results: a tight loop per kind of
  // reduction, without branching on the kind for each value (about 40 ms for 256³)
  const reduceRow = {
    max: (from: number, to: number) => {
      for (let i = 0; i < inner; i += 1) {
        const val = values[from + i];
        if (
          !(acc[to + i] >= val) &&
          !Number.isNaN(val) &&
          !ignoreValue?.(val)
        ) {
          acc[to + i] = val; // also replaces NaN, i.e. no value yet
        }
      }
    },
    min: (from: number, to: number) => {
      for (let i = 0; i < inner; i += 1) {
        const val = values[from + i];
        if (
          !(acc[to + i] <= val) &&
          !Number.isNaN(val) &&
          !ignoreValue?.(val)
        ) {
          acc[to + i] = val;
        }
      }
    },
    sum: (from: number, to: number) => {
      for (let i = 0; i < inner; i += 1) {
        const val = values[from + i];
        if (!Number.isNaN(val) && !ignoreValue?.(val)) {
          acc[to + i] += val;
        }
      }
    },
    mean: (from: number, to: number) => {
      for (let i = 0; i < inner; i += 1) {
        const val = values[from + i];
        if (!Number.isNaN(val) && !ignoreValue?.(val)) {
          acc[to + i] += val;
          counts[to + i] += 1;
        }
      }
    },
  }[projection];

  for (let o = 0; o < outer; o += 1) {
    for (let k = 0; k < length; k += 1) {
      reduceRow((o * length + k) * inner, o * inner);
    }
  }

  if (projection === 'mean') {
    for (let j = 0; j < size; j += 1) {
      acc[j] = counts[j] > 0 ? acc[j] / counts[j] : Number.NaN;
    }
  }
  return acc;
}

/* Position of a dimension of the dataset among the dimensions of the fetched values: those on
 * the axes and the projected one (cf. `getProjectionSelection`) */
export function getProjectionAxis(
  dimMapping: DimensionMapping,
  projectedDim: number,
): number {
  return dimMapping
    .slice(0, projectedDim)
    .filter((val) => typeof val !== 'number').length;
}

/* What a projection did, e.g. `max over 𝑧` */
export function getProjectionLabel(
  projection: Projection,
  dimLabel: string,
): string {
  return `${projection} over ${dimLabel}`;
}

/* Reduce a run of contiguous values, skipping NaN and ignored values, as `projectArray` */
const RUN_REDUCERS: Record<
  Projection,
  (
    values: NumArray,
    from: number,
    length: number,
    ignoreValue: IgnoreValue | undefined,
  ) => number
> = {
  max: (values, from, length, ignoreValue) => {
    let max = Number.NaN;
    for (let i = from; i < from + length; i += 1) {
      const val = values[i];
      if (!(max >= val) && !Number.isNaN(val) && !ignoreValue?.(val)) {
        max = val;
      }
    }
    return max;
  },
  min: (values, from, length, ignoreValue) => {
    let min = Number.NaN;
    for (let i = from; i < from + length; i += 1) {
      const val = values[i];
      if (!(min <= val) && !Number.isNaN(val) && !ignoreValue?.(val)) {
        min = val;
      }
    }
    return min;
  },
  sum: (values, from, length, ignoreValue) => {
    let sum = 0;
    for (let i = from; i < from + length; i += 1) {
      const val = values[i];
      if (!Number.isNaN(val) && !ignoreValue?.(val)) {
        sum += val;
      }
    }
    return sum;
  },
  mean: (values, from, length, ignoreValue) => {
    let sum = 0;
    let count = 0;
    for (let i = from; i < from + length; i += 1) {
      const val = values[i];
      if (!Number.isNaN(val) && !ignoreValue?.(val)) {
        sum += val;
        count += 1;
      }
    }
    return count > 0 ? sum / count : Number.NaN;
  },
};

/* Title of a projection, e.g. `stack (max over time)` */
export function getProjectedTitle(
  title: string,
  label: string | undefined,
): string {
  return label ? `${title} (${label})` : title;
}

/* Colour-bar label of a projection, e.g. `intensity (a.u.), max over time` */
export function getProjectedValueLabel(
  valueLabel: string | undefined,
  label: string | undefined,
): string | undefined {
  return label && valueLabel
    ? `${valueLabel}, ${label}`
    : (label ?? valueLabel);
}
