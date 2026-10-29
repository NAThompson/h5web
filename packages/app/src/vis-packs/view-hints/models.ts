import {
  type Interpolation,
  type PaletteName,
  type PlaybackSettings,
  type ValueTransform,
} from '@h5web/lib';
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
  Orthoslices = 'orthoslices', // three linked planes through a volume
  Curve = 'curve',
  ParamSurface = 'paramsurface', // parametric surface (CF `coordinates`)
  ComplexLine = 'complexline',
  ComplexHeatmap = 'complexheatmap',
  ComplexCurve = 'complexcurve',
  ComplexPoints = 'complexpoints', // 1D complex values as points of the complex plane
  RGB = 'rgb',
  Scatter = 'scatter', // NeXus scatter, or points (cf. `core/scatter/source.ts`)
  Scatter3D = 'scatter3d', // point cloud
  Compound = 'compound',
  Vector = 'vector', // cf. `VECTOR_VIS` (datasets and groups)
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
  legendLabel?: string; // legend entry regardless of `label` (alike entries shown once)
  dash?: boolean; // dashed lines
  halo?: boolean; // contrasting halo around lines, points and text (default: true)
  stroke?: string; // CSS colour of point outlines
  sliceBy?: string; // dimension scale linking the overlay's leading dimension
}

/* Marker of points: filled disc, cross, or hollow circle (e.g. poles and zeros) */
export type Marker = 'dot' | 'x' | 'o';

export interface PointsOverlay extends OverlayBase {
  kind: 'points';
  points: string; // path of an (N, 2+) dataset, or of a complex (N,) dataset (re, im)
  marker?: Marker;
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

/* Circle [cx, cy, r] in data coordinates, e.g. the unit circle of a z-plane */
export interface CircleOverlay extends OverlayBase {
  kind: 'circle';
  circle: string; // path of a (3,) dataset
}

export type TextAnchor = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface TextOverlay extends OverlayBase {
  kind: 'text';
  text: string;
  at: number[]; // position, in axis values (components ordered like columns)
  anchor: TextAnchor; // side of the position where the text goes
}

/* Line views: reference line at a value, or shaded interval between two */
export interface ReferenceOverlay extends OverlayBase {
  kind: 'hline' | 'vline' | 'band';
  value: string; // path of a scalar or (1,) dataset (lines), or of a (2,) dataset [lo, hi] (bands)
  axis: 'x' | 'y'; // axis of the values
}

export type OverlayHint =
  | PointsOverlay
  | EllipseOverlay
  | CurveOverlay
  | CircleOverlay
  | TextOverlay
  | ReferenceOverlay;

/* Running min / max of a line (`H5WEB_envelope`), drawn over the data or instead of it */
export interface Envelope {
  type: 'cummin' | 'cummax';
  mode: 'add' | 'replace';
  reverse: boolean; // suffix envelope: over the values from each one to the end
}

/* Reduction of a dimension of a heatmap stack, shown instead of a slice (`H5WEB_projection`) */
export type Projection = 'max' | 'min' | 'mean' | 'sum';

export interface ViewHint {
  vis?: HintVis;
  scaleType?: ColorScaleType; // colour scale (and height of real surfaces)
  symlogThreshold?: number; // width of the linear band around 0 of symlog scales
  rootN?: number; // nth-root colour scale (`H5WEB_scale = "root"`), instead of `scaleType`
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
  isoSmooth?: boolean; // volumes: smooth isosurfaces and pass region (default: on small grids)
  passMin?: number; // volumes: region where `passMin ≤ value ≤ passMax`, shown on open
  passMax?: number;
  valueTransform?: ValueTransform; // values are log10 / log2: shown as powers
  envelope?: Envelope; // line: running min / max
  curveLabel?: string; // line: legend entry of the dataset's own curve (default: CF `long_name`)
  curveColor?: string; // line: colour of the dataset's own curve (not in multi-plots)
  curveWidth?: number; // line: width of the dataset's own curve in CSS pixels
  curveDash?: boolean; // line: dashed curve of the dataset
  marker?: Marker; // complex points: marker of the dataset's own points
  markerSize?: number; // complex points: radius of the dataset's own points in CSS pixels
  seriesPaths?: string[]; // line: extra datasets on the same axes (their attributes say how)
  seriesAnchor?: string; // series paths are resolved relative to this path
  bandPaths?: string[]; // line: lower and upper bounds of a filled area around each curve (same shape)
  bandAnchor?: string; // band paths are resolved relative to this path
  bandOpacity?: number; // of the band's fill (default 0.25)
  bandOnly?: boolean; // band without its curve
  xDim?: number; // line: dimension on the x axis; scatter: of the rows form
  multiDim?: number; // line: dimension whose slices are all plotted
  interpolation?: Interpolation; // line: between samples (until changed in the toolbar)
  palette?: readonly string[]; // line multi-plots: colours of the curves, cycled
  paletteName?: PaletteName; // categorical colors: palette of the categories
  paletteBy?: string; // path of a 1D string dataset along `multiDim`: alike labels, alike colours
  paletteByAnchor?: string; // `paletteBy` is resolved relative to this path
  categorical?: boolean; // integer labels / classes: a color per value, discrete legend
  categoryList?: { values: number[]; labels?: string[] }; // CF `flag_values`, `flag_meanings`
  probeDim?: number; // heatmap stacks: clicking a pixel plots its values along this dimension
  projection?: Projection; // heatmap stacks: reduce a dimension instead of slicing it
  projectionDim?: number; // dimension reduced (default: the first sliced dimension)
  slicePosition?: number[]; // orthoslices: indices of the crosshair along the last three dimensions
  playbackDim?: number; // dimension played by default (e.g. walked past empty slices on load)
  multiplesDims?: number[]; // small multiples: a panel per index of these dimensions (rows, cols)
  multiplesColumns?: number; // small multiples of one dimension: panels per row
  linkAxes?: boolean; // panels: zoom and pan together (default: true)
  linkCursor?: boolean; // panels: crosshair at the same coordinates in every panel (default: true)
  nanColor?: string; // CSS colour of NaN / ignored values (3D: drawn on the floor, not as holes)
  belowColor?: string; // CSS colour of values below the colour domain (default: saturate)
  aboveColor?: string;
  playbackSkipEmpty?: boolean; // playback and steps skip slices that are all NaN / ignored
  playback?: Partial<PlaybackSettings>; // initial speed, mode and range of playback
  title?: string; // title of the figure
  valueLabel?: string; // colour bar / value axis: CF `units`, with `long_name` if not the title
  longName?: string; // CF `long_name`, e.g. to label values when `valueLabel` is left out
  sliceBy?: string; // dimension scale linking overlays, when the dataset has no such dimension
  sliceByAnchor?: string; // `sliceBy` is resolved relative to this path (default: `anchor`)
  overlayPaths: string[]; // objects drawn on top (their attributes say what and how)
  anchor?: string; // overlay paths are resolved relative to this path (dataset with the hint, or `<group>/.`)
  notes: string[]; // why parts of the hint were ignored
}

/* Style of a series (`H5WEB_series`), from its attributes */
export interface SeriesStyle {
  label?: string; // legend entry (default: CF `long_name`, else the dataset name)
  color?: string;
  width?: number; // line width in CSS pixels
  dash?: boolean; // dashed line
}

/* Colours of special values (from a hint) */
export type SpecialColorsHint = Pick<
  ViewHint,
  'nanColor' | 'belowColor' | 'aboveColor'
>;

export const EMPTY_HINT: ViewHint = { overlayPaths: [], notes: [] };
