import { type DimensionMapping, getSliceSelection } from '@h5web/lib';

export interface ContourOfSlicing {
  selection: string | undefined;
  mapping: DimensionMapping; // mapping of the contoured dataset's dimensions
}

/* Slicing of a dataset contoured over a base dataset (`H5WEB_contour_of`): with the same dims, it
 * is sliced along with the base; a 2D dataset matches the base's two dims on the axes (whole
 * dataset, the same on every slice). `undefined` if it isn't on the same grid. */
export function getContourOfSlicing(
  baseDims: number[],
  dims: number[],
  dimMapping: DimensionMapping,
): ContourOfSlicing | undefined {
  if (
    dims.length === baseDims.length &&
    dims.every((size, i) => size === baseDims[i])
  ) {
    return { selection: getSliceSelection(dimMapping), mapping: dimMapping };
  }

  const axes = dimMapping.flatMap((dim, i) =>
    dim === 'x' || dim === 'y' ? [i] : [],
  );
  return dims.length === 2 &&
    axes.length === 2 &&
    dims.every((size, j) => size === baseDims[axes[j]])
    ? { selection: undefined, mapping: axes.map((i) => dimMapping[i]) }
    : undefined;
}

/* Regular levels without those drawn emphasized (drawn once, emphasized) */
export function withoutEmphasized(
  levels: number[],
  emphasized: number[],
): number[] {
  return emphasized.length > 0
    ? levels.filter((level) => !emphasized.includes(level))
    : levels;
}
