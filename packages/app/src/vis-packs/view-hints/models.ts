import {
  type AxisScaleType,
  type ColorScaleType,
  type ComplexVisType,
} from '@h5web/shared/vis-models';

import { type ColorMap } from '../core/heatmap/models';

export const VIEW_HINT_ATTR = 'H5WEB_view';

/* Stable ids of the visualizations a file can ask for (case, spaces, `-` and `_` ignored) */
export enum HintVis {
  Scalar = 'scalar',
  Matrix = 'matrix',
  Line = 'line',
  Heatmap = 'heatmap',
  Surface = 'surface', // parametric surface if supported, else heatmap in 3D
  ComplexSurface = 'complexsurface', // heatmap of complex values in 3D
  Volume = 'volume',
  Curve = 'curve',
  RGB = 'rgb',
  Scatter = 'scatter',
  Compound = 'compound',
}

interface OverlayBase {
  /* Columns of the last dimension holding coordinates along the base dataset's last and
   * second-to-last dimensions (and z); default [0, 1] */
  columns?: number[];
  /* Or: names of the base dataset's dimensions (dimension scales) held by each column */
  columnNames?: string[];
  stroke?: string; // CSS colour of lines and point outlines
}

export interface PointsOverlay extends OverlayBase {
  kind: 'points';
  points: string; // path of an (N, 2+) dataset
  color?: string; // path of an (N,) dataset to colour points by (base colour map and domain)
  z?: string; // 3D: path of an (N,) dataset giving the height of each point
  fill?: string; // CSS colour of points without `color`
  size?: number; // radius in CSS pixels
}

export interface EllipseOverlay extends OverlayBase {
  kind: 'ellipse';
  mean: string; // path of a (d,) dataset
  cov: string; // path of a (d, d) dataset
  scale?: string; // path of a scalar dataset: step size σ, ellipse of σ² C
  nsigma: number[]; // ellipses drawn at these numbers of standard deviations
}

export interface CurveOverlay extends OverlayBase {
  kind: 'curve';
  curve: string; // path of an (M, 2+) dataset
  trail: boolean; // rows up to the linked index only, i.e. path followed so far
}

export type OverlayHint = PointsOverlay | EllipseOverlay | CurveOverlay;

export interface ViewHint {
  vis?: HintVis;
  scaleType?: ColorScaleType; // colour scale (and height of real surfaces)
  height?: ColorScaleType; // height scale of 3D surfaces (complex surfaces)
  xScaleType?: AxisScaleType;
  yScaleType?: AxisScaleType;
  colorMap?: ColorMap;
  invertColorMap?: boolean;
  domain?: [number | null, number | null];
  keepRatio?: boolean;
  heightScale?: number; // height of 3D surfaces relative to their footprint
  contours?: number | number[]; // number of levels, or explicit levels
  complex?: ComplexVisType;
  isoLevels?: number[];
  xDim?: number; // line: dimension on the x axis
  multiDim?: number; // line: dimension whose slices are all plotted
  sliceBy?: string; // dimension scale linking overlays, when the dataset has no such dimension
  overlays: OverlayHint[];
  anchor?: string; // overlay paths are resolved relative to this path (dataset with the hint, or `<group>/.`)
  notes: string[]; // why parts of the hint were ignored
}

export const EMPTY_HINT: ViewHint = { overlays: [], notes: [] };
