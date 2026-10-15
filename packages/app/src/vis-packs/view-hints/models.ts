import {
  type ColorScaleType,
  type ComplexVisType,
} from '@h5web/shared/vis-models';

import { type ColorMap } from '../core/heatmap/models';

export const HINT_ATTR_PREFIX = 'H5WEB_'; // prefix of view attributes

/* Values of `H5WEB_vis` (case, spaces, `-` and `_` ignored) */
export enum HintVis {
  Scalar = 'scalar',
  Matrix = 'matrix',
  Line = 'line',
  Heatmap = 'heatmap',
  Surface = 'surface', // heatmap in 3D (parametric surface if no heatmap)
  ComplexSurface = 'complexsurface', // heatmap of complex values in 3D
  Volume = 'volume',
  Curve = 'curve',
  ParamSurface = 'paramsurface', // parametric surface (CF `coordinates`)
  ComplexLine = 'complexline',
  ComplexHeatmap = 'complexheatmap',
  ComplexCurve = 'complexcurve',
  RGB = 'rgb',
  Scatter = 'scatter',
  Compound = 'compound',
}

interface OverlayBase {
  /* Names of the base dataset's dimensions (dimension scales) held by each column; default:
   * columns 0 and 1 hold the base dataset's last and second-to-last dimensions */
  columnNames?: string[];
  color?: string; // CSS colour of lines, and of points without `colorBy`
  colorBy?: string; // path of an (N,) dataset colouring points with the base colour map and domain
  width?: number; // line width in CSS pixels
  label?: string; // in the legend, or next to the overlay with `labelMode: "inline"`
  labelMode?: 'legend' | 'inline';
  dash?: boolean; // dashed lines
  halo?: boolean; // contrasting halo around lines, points and text (default: true)
  stroke?: string; // CSS colour of point outlines
  sliceBy?: string; // dimension scale linking the overlay's leading dimension
}

export interface PointsOverlay extends OverlayBase {
  kind: 'points';
  points: string; // path of an (N, 2+) dataset
  /* 3D: height of each point - path of an (N,) dataset, `"value"` (the `colorBy` values) or
   * `"surface"` (default, unless a 3rd column is given) */
  z?: string;
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

export type TextAnchor = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TextOverlay extends OverlayBase {
  kind: 'text';
  text: string;
  at: number[]; // position, in axis values (components ordered like columns)
  anchor: TextAnchor; // side of the position where the text goes
}

export type OverlayHint =
  PointsOverlay | EllipseOverlay | CurveOverlay | TextOverlay;

export interface ViewHint {
  vis?: HintVis;
  scaleType?: ColorScaleType; // colour scale (and height of real surfaces)
  symlogThreshold?: number; // width of the linear band around 0 of symlog scales
  height?: ColorScaleType; // height scale of 3D surfaces (complex surfaces)
  colorMap?: ColorMap | 'auto'; // auto: diverging, centred on `center`, if data changes sign
  invertColorMap?: boolean;
  domain?: [number | null, number | null] | 'symmetric'; // symmetric: ±max |v − center|
  center?: number; // centre of symmetric domains and diverging colour maps (default 0)
  legend?: boolean; // default: shown when an overlay has a label
  keepRatio?: boolean;
  heightScale?: number; // height of 3D surfaces relative to their footprint
  contours?: number | number[]; // number of levels (0: automatic), or explicit levels
  contourLabels?: boolean;
  contourColor?: string;
  contourEmphasize?: number[]; // levels drawn emphasized, even if not among the regular levels
  contourEmphasizeWidth?: number; // CSS pixels (default: twice the regular width)
  contourEmphasizeColor?: string;
  contourOf?: string; // path of another dataset on the same grid, contoured instead of this one
  contourOfAnchor?: string; // `contourOf` is resolved relative to this path
  complex?: ComplexVisType;
  isoLevels?: number[];
  xDim?: number; // line: dimension on the x axis
  multiDim?: number; // line: dimension whose slices are all plotted
  probeDim?: number; // heatmap stacks: clicking a pixel plots its values along this dimension
  title?: string; // title of the figure
  valueLabel?: string; // colour bar / value axis: CF `units`, with `long_name` if not the title
  sliceBy?: string; // dimension scale linking overlays, when the dataset has no such dimension
  sliceByAnchor?: string; // `sliceBy` is resolved relative to this path (default: `anchor`)
  overlayPaths: string[]; // objects drawn on top (their attributes say what and how)
  anchor?: string; // overlay paths are resolved relative to this path (dataset with the hint, or `<group>/.`)
  notes: string[]; // why parts of the hint were ignored
}

export const EMPTY_HINT: ViewHint = { overlayPaths: [], notes: [] };
