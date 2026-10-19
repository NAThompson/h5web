import { createArrayFromView, type OrthoPoint } from '@h5web/lib';
import { type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';

export type OrthoAxis = 0 | 1 | 2; // x, y, z: index in an `OrthoPoint`
export type OrthoPlane = 'xy' | 'yz' | 'xz';

export const AXIS_NAMES = ['x', 'y', 'z'] as const;

/* Axes of the heatmap of each plane (abscissa, ordinate), in the classic layout: YZ beside XY
 * (sharing its y axis, with z across), XZ below it (sharing its x axis, with z upwards) */
export const PLANE_AXES: Record<OrthoPlane, [OrthoAxis, OrthoAxis]> = {
  xy: [0, 1],
  yz: [2, 1],
  xz: [0, 2],
};

/* Axis normal to a plane, along which it is sliced */
export function getNormalAxis(plane: OrthoPlane): OrthoAxis {
  const [u, v] = PLANE_AXES[plane];
  return (3 - u - v) as OrthoAxis;
}

/* Slice of a volume of dimensions `[z, y, x]` through a point, with rows along the plane's
 * ordinate and columns along its abscissa (cf. `PLANE_AXES`); copied, for heatmap textures */
export function getOrthoSlice(
  volume: NdArray<NumArray>,
  plane: OrthoPlane,
  point: OrthoPoint,
): NdArray<NumArray> {
  const [x, y, z] = point;
  const view =
    plane === 'xy'
      ? volume.pick(z, null, null) // [y, x]
      : plane === 'xz'
        ? volume.pick(null, y, null) // [z, x]
        : volume.pick(null, null, x).transpose(1, 0); // [y, z]
  return createArrayFromView(view);
}

/* Sizes of a volume of dimensions `[z, y, x]` along x, y and z */
export function getAxisSizes(shape: number[]): [number, number, number] {
  const [depth, rows, cols] = shape;
  return [cols, rows, depth];
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(Math.round(index), 0), count - 1);
}

/* Point of the crosshair at first: `H5WEB_slice_position` (indices along the last three
 * dimensions, in the dataset's order, i.e. z, y, x), clamped to the volume, else its centre */
export function getInitialPoint(
  shape: number[],
  hinted: number[] | undefined,
): OrthoPoint {
  const indices = hinted && [hinted[2], hinted[1], hinted[0]]; // along x, y, z
  return getAxisSizes(shape).map((size, axis) =>
    indices ? clampIndex(indices[axis], size) : Math.floor((size - 1) / 2),
  ) as OrthoPoint;
}

/* Point with the index along an axis replaced (clamped to the volume) */
export function withIndex(
  point: OrthoPoint,
  axis: OrthoAxis,
  index: number,
  shape: number[],
): OrthoPoint {
  const next: OrthoPoint = [...point];
  next[axis] = clampIndex(index, getAxisSizes(shape)[axis]);
  return next;
}
