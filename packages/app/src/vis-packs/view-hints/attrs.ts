import {
  clampPlaybackFps,
  INTERPOLATORS,
  type PlaybackMode,
  type PlaybackRange,
  type PlaybackSettings,
  type ValueTransform,
} from '@h5web/lib';
import {
  hasArrayShape,
  hasBoolType,
  hasIntegerType,
  hasNumericType,
  hasScalarShape,
  hasStringType,
  isColorScaleType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type Attribute,
  type AttributeValues,
  type Dataset,
  type Entity,
} from '@h5web/shared/hdf5-models';
import { type ColorScaleType, ComplexVisType } from '@h5web/shared/vis-models';

import { findAttribute } from '../../utils';
import { type ColorMap } from '../core/heatmap/models';
import { DEFAULT_ROOT_N } from '../core/utils';
import {
  type Envelope,
  HINT_ATTR_PREFIX,
  HintVis,
  type OverlayHint,
  type Projection,
  type ReferenceOverlay,
  type SeriesStyle,
  type TextAnchor,
  type ViewHint,
} from './models';

/* Values as plain numbers (a scalar selection may come back as a number) */
export function toNumbers(value: unknown): number[] | undefined {
  if (typeof value === 'number' || typeof value === 'bigint') {
    return [Number(value)];
  }
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<number | bigint>, Number);
  }
  return undefined;
}

function toKey(val: string): string {
  return val.toLowerCase().replaceAll(/[\s\-_]/gu, '');
}

const HINT_VIS = new Map(Object.values(HintVis).map((id) => [id, id]));
const COLOR_MAPS = new Map(
  Object.keys(INTERPOLATORS).map((name) => [toKey(name), name as ColorMap]),
);
const COMPLEX_TYPES = new Map(
  Object.values(ComplexVisType).map((type) => [toKey(type), type]),
);
const TEXT_ANCHORS = new Set<string>([
  'top',
  'bottom',
  'left',
  'right',
  'center',
]);

function parseAmong<T extends string>(values: T[]) {
  return (val: string): T | undefined => {
    const key = val.toLowerCase();
    return values.find((v) => v === key);
  };
}

/* Only the settings that are given */
function readPlayback(read: AttrReader): Partial<PlaybackSettings> | undefined {
  const fps = read.num(
    'H5WEB_playback_fps',
    (v) => Number.isFinite(v) && v > 0,
  );
  const settings = Object.entries({
    fps: fps === undefined ? undefined : clampPlaybackFps(fps),
    mode: read.oneOf(
      'H5WEB_playback_mode',
      parseAmong<PlaybackMode>(['loop', 'bounce', 'once']),
    ),
    range: read.oneOf(
      'H5WEB_playback_range',
      parseAmong<PlaybackRange>(['sequence', 'frame']),
    ),
  }).filter(([, val]) => val !== undefined);
  return settings.length > 0 ? Object.fromEntries(settings) : undefined;
}

/* `H5WEB_envelope`, with its mode and direction (default: `add`, `forward`) */
function readEnvelope(read: AttrReader): Envelope | undefined {
  const type = read.oneOf(
    'H5WEB_envelope',
    parseAmong<Envelope['type']>(['cummin', 'cummax']),
  );
  const mode = read.oneOf(
    'H5WEB_envelope_mode',
    parseAmong<Envelope['mode']>(['add', 'replace']),
  );
  const direction = read.oneOf(
    'H5WEB_envelope_direction',
    parseAmong(['forward', 'reverse']),
  );
  return (
    type && { type, mode: mode ?? 'add', reverse: direction === 'reverse' }
  );
}

function parseScaleType(val: string): ColorScaleType | undefined {
  const type = val.toLowerCase();
  return isColorScaleType(type) ? type : undefined;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ';
const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵉʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛˣ';
const PLAIN = '0123456789+-=()aehijklmnoprstuvx';

/* `_{…}` and `^{…}` as Unicode sub/superscripts, where plain text is needed (e.g. dimension
 * labels; characters with no such form are kept as is, e.g. `ψ_{3,0}` → `ψ₃,₀`) */
export function toUnicodeScripts(
  label: string | undefined,
): string | undefined {
  return label?.replaceAll(
    /([\^_])\{([^}]*)\}/gu,
    (_, mark: string, text: string) => {
      const forms = mark === '_' ? SUB : SUPER; // single UTF-16 code units
      return text.replaceAll(/[\d()+\-=aeh-pr-vx]/gu, (char) =>
        forms.charAt(PLAIN.indexOf(char)),
      );
    },
  );
}

/* Space-separated names or paths, as CF `coordinates` */
export function splitNames(val: string): string[] {
  return val.split(/\s+/u).filter((name) => name.length > 0);
}

function isSingle(attr: Attribute): boolean {
  return (
    hasScalarShape(attr) ||
    (hasArrayShape(attr) &&
      attr.shape.dims.length === 1 &&
      attr.shape.dims[0] === 1)
  );
}

function isVector(attr: Attribute): boolean {
  return (
    hasScalarShape(attr) ||
    (hasArrayShape(attr) && attr.shape.dims.length === 1)
  );
}

function toArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value as unknown[];
  }
  if (ArrayBuffer.isView(value)) {
    return [...(value as unknown as Iterable<unknown>)]; // typed array
  }
  return value === undefined || value === null ? undefined : [value];
}

function toBool(val: unknown): boolean | undefined {
  if (typeof val === 'boolean') {
    return val;
  }
  return typeof val === 'number' || typeof val === 'bigint'
    ? Number(val) !== 0
    : undefined;
}

export interface AttrReader {
  str: (name: string, accept?: (val: string) => boolean) => string | undefined;
  nums: (
    name: string,
    accept?: (val: number[]) => boolean,
  ) => number[] | undefined;
  num: (name: string, accept?: (val: number) => boolean) => number | undefined;
  bool: (name: string) => boolean | undefined;
  oneOf: <T>(
    name: string,
    parse: (val: string) => T | undefined,
  ) => T | undefined;
}

/**
 * Typed reader of the `H5WEB_*` attributes of an entity. Scalars may be stored as 1-element
 * arrays (netCDF-4), booleans as integers of any width or as h5py booleans (nonzero = true).
 * An attribute of the wrong type or value is ignored, with a note; nothing ever throws.
 */
export function createAttrReader(
  entity: Entity,
  values: AttributeValues,
  notes: string[],
  prefix = '',
): AttrReader {
  function read<T>(
    name: string,
    isType: (attr: Attribute) => boolean,
    convert: (arr: unknown[]) => T | undefined,
    accept: (val: T) => boolean,
  ): T | undefined {
    const attr = findAttribute(entity, name);
    if (!attr) {
      return undefined;
    }

    const arr = toArray(values[name]);
    const val = isType(attr) && arr ? convert(arr) : undefined;
    if (val !== undefined && accept(val)) {
      return val;
    }

    notes.push(`${prefix}ignored invalid "${name}"`);
    return undefined;
  }

  function str(
    name: string,
    accept: (val: string) => boolean = () => true,
  ): string | undefined {
    // Fixed-length strings may be padded; empty strings are as good as absent
    const val = read(
      name,
      (attr) => hasStringType(attr) && isSingle(attr),
      ([v]) => (typeof v === 'string' ? v.split('\0')[0].trim() : undefined),
      (v) => v === '' || accept(v),
    );
    return val || undefined;
  }

  function nums(
    name: string,
    accept: (val: number[]) => boolean = () => true,
  ): number[] | undefined {
    return read(
      name,
      (attr) => hasNumericType(attr) && isVector(attr),
      toNumbers,
      accept,
    );
  }

  function num(
    name: string,
    accept: (val: number) => boolean = Number.isFinite,
  ): number | undefined {
    return nums(name, (arr) => arr.length === 1 && accept(arr[0]))?.[0];
  }

  function bool(name: string): boolean | undefined {
    return read(
      name,
      (attr) => (hasIntegerType(attr) || hasBoolType(attr)) && isSingle(attr),
      ([v]) => toBool(v),
      () => true,
    );
  }

  // String among known values (case-insensitive)
  function oneOf<T>(
    name: string,
    parse: (val: string) => T | undefined,
  ): T | undefined {
    let parsed: T | undefined;
    str(name, (val) => {
      parsed = parse(val);
      return parsed !== undefined;
    });
    return parsed;
  }

  return { str, nums, num, bool, oneOf };
}

/* Dimension named by `H5WEB_x_dim` / `H5WEB_multi_dim` / `H5WEB_probe_dim` / `H5WEB_projection_dim`: name of a dimension scale (see
 * `getDimNames`), or index */
function readDim(
  reader: AttrReader,
  name: string,
  entity: Entity,
  dimNames: string[][],
): number | undefined {
  const attr = findAttribute(entity, name);
  if (attr && hasNumericType(attr)) {
    return reader.num(name, (v) => Number.isInteger(v) && v >= 0);
  }
  return reader.oneOf(name, (val) => {
    const dim = dimNames.findIndex((names) => names.includes(val));
    return dim !== -1 ? dim : undefined;
  });
}

/* One or two distinct dimensions, leaving one or more for the panels' axes */
function isMultiplesDims(dims: number[], rank: number): boolean {
  return (
    dims.length <= 2 &&
    dims.length < rank &&
    new Set(dims).size === dims.length &&
    dims.every((dim) => Number.isInteger(dim) && dim >= 0 && dim < rank)
  );
}

/* Dimensions of small multiples (`H5WEB_multiples_dim`): one or two, space-separated in a string
 * (same forms as `readDim`), or indices */
function readMultiplesDims(
  reader: AttrReader,
  entity: Entity,
  dimNames: string[][],
): number[] | undefined {
  const name = 'H5WEB_multiples_dim';
  const attr = findAttribute(entity, name);
  if (attr && hasNumericType(attr)) {
    return reader.nums(name, (arr) => isMultiplesDims(arr, dimNames.length));
  }
  return reader.oneOf(name, (val) => {
    const dims = splitNames(val).map((dimName) =>
      dimNames.findIndex((names) => names.includes(dimName)),
    );
    return dims.length > 0 && isMultiplesDims(dims, dimNames.length)
      ? dims
      : undefined;
  });
}

function isLevels(arr: number[]): boolean {
  return arr.length > 0 && arr.every(Number.isFinite);
}
export function isScatterHint(vis: HintVis | undefined): boolean {
  return vis === HintVis.Scatter || vis === HintVis.Scatter3D;
}

/* Unchecked where CSS is not available (e.g. unit tests in Node) */
export function isCssColor(val: string): boolean {
  return typeof CSS === 'undefined' || CSS.supports('color', val);
}

/* CSS colour as `rgba(…)`, which the renderer parses (unlike e.g. `oklch(…)` or space-separated
 * `rgb(…)`), from a pixel painted with it; as is without a DOM (e.g. in unit tests) */
export function toRgbaColor(val: string | undefined): string | undefined {
  const ctx =
    val && typeof document !== 'undefined'
      ? document.createElement('canvas').getContext('2d')
      : null;
  if (!val || !ctx) {
    return val;
  }
  ctx.fillStyle = val;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}
function isPos(val: number): boolean {
  return Number.isFinite(val) && val > 0;
}

/**
 * View hint of a dataset (or NXdata group) from its `H5WEB_*` attributes, CF `long_name` as
 * title. `dimNames`: names of the dimensions of the dataset, for `H5WEB_x_dim`/`multi_dim`.
 */
export function parseViewHint(
  entity: Entity,
  values: AttributeValues,
  dimNames: string[][] = [],
): ViewHint {
  const notes: string[] = [];
  const read = createAttrReader(entity, values, notes);

  // NaN: automatic end
  const domain = read.nums('H5WEB_domain', (arr) => arr.length === 2);
  const fixedDomain = domain?.map((v) => (Number.isFinite(v) ? v : null)) as
    [number | null, number | null] | undefined;
  const isSymmetric = read.bool('H5WEB_symmetric');
  const levels = read.nums('H5WEB_contour_levels', isLevels);
  const count = read.num(
    'H5WEB_contour_count',
    (v) => Number.isInteger(v) && v >= 0,
  );

  const vis = read.oneOf('H5WEB_vis', (val) =>
    HINT_VIS.get(toKey(val) as HintVis),
  );
  const scale = read.oneOf('H5WEB_scale', (val) =>
    val.toLowerCase() === 'root' ? 'root' : parseScaleType(val),
  );

  return {
    vis,
    scaleType: scale === 'root' ? undefined : scale,
    rootN:
      scale === 'root'
        ? (read.num('H5WEB_root_n', (v) => Number.isFinite(v) && v > 1) ??
          DEFAULT_ROOT_N)
        : undefined,
    symlogThreshold: read.num(
      'H5WEB_symlog_threshold',
      (v) => Number.isFinite(v) && v > 0,
    ),
    height: read.oneOf('H5WEB_z_scale', parseScaleType),
    colorMap: read.oneOf('H5WEB_colormap', (val) =>
      val.toLowerCase() === 'auto' ? 'auto' : COLOR_MAPS.get(toKey(val)),
    ),
    invertColorMap: read.bool('H5WEB_invert_colormap'),
    domain: fixedDomain?.some((v) => v !== null)
      ? fixedDomain
      : isSymmetric
        ? 'symmetric'
        : undefined,
    center: read.num('H5WEB_center'),
    legend: read.bool('H5WEB_legend'),
    keepRatio: read.bool('H5WEB_keep_ratio'),
    heightScale: read.num(
      'H5WEB_z_stretch',
      (v) => Number.isFinite(v) && v > 0,
    ),
    contours: levels ?? count,
    contourLabels: read.bool('H5WEB_contour_labels'),
    contourColor: read.str('H5WEB_contour_color'),
    contourEmphasize: read.nums('H5WEB_contour_emphasize', isLevels),
    contourEmphasizeWidth: read.num('H5WEB_contour_emphasize_width', isPos),
    contourEmphasizeColor: read.str('H5WEB_contour_emphasize_color'),
    contourOf: read.str('H5WEB_contour_of'),
    complex: read.oneOf('H5WEB_complex', (val) =>
      COMPLEX_TYPES.get(toKey(val)),
    ),
    isoLevels: read.nums(
      'H5WEB_iso_levels',
      (arr) => arr.length > 0 && arr.every(Number.isFinite),
    ),
    valueTransform: read.oneOf(
      'H5WEB_value_transform',
      parseAmong<ValueTransform>(['exp10', 'exp2']),
    ),
    envelope: readEnvelope(read),
    curveLabel: read.str('H5WEB_label'),
    // Scatter: path of colour values, or colour of all points (cf. `core/scatter/source.ts`)
    curveColor: isScatterHint(vis)
      ? undefined
      : toRgbaColor(read.str('H5WEB_color', isCssColor)),
    curveWidth: read.num('H5WEB_width', isPos),
    xDim: readDim(read, 'H5WEB_x_dim', entity, dimNames),
    multiDim: readDim(read, 'H5WEB_multi_dim', entity, dimNames),
    probeDim: readDim(read, 'H5WEB_probe_dim', entity, dimNames),
    projection: read.oneOf(
      'H5WEB_projection',
      parseAmong<Projection>(['max', 'min', 'mean', 'sum']),
    ),
    projectionDim: readDim(read, 'H5WEB_projection_dim', entity, dimNames),
    slicePosition: read.nums(
      'H5WEB_slice_position',
      (arr) =>
        arr.length === 3 && arr.every((v) => Number.isInteger(v) && v >= 0),
    ),
    playbackDim: readDim(read, 'H5WEB_playback_dim', entity, dimNames),
    multiplesDims: readMultiplesDims(read, entity, dimNames),
    multiplesColumns: read.num(
      'H5WEB_multiples_columns',
      (v) => Number.isInteger(v) && v > 0,
    ),
    linkAxes: read.bool('H5WEB_link_axes'),
    linkCursor: read.bool('H5WEB_link_cursor'),
    nanColor: toRgbaColor(read.str('H5WEB_nan_color', isCssColor)),
    belowColor: toRgbaColor(read.str('H5WEB_below_color', isCssColor)),
    aboveColor: toRgbaColor(read.str('H5WEB_above_color', isCssColor)),
    playbackSkipEmpty: read.bool('H5WEB_playback_skip_empty'),
    playback: readPlayback(read),
    title: read.str('H5WEB_title') ?? read.str('long_name'), // `_{…}` and `^{…}` markup kept
    sliceBy: read.str('H5WEB_slice_by'),
    overlayPaths: splitNames(read.str('H5WEB_overlays') ?? ''),
    seriesPaths: splitNames(read.str('H5WEB_series') ?? ''),
    notes,
  };
}

/* Style of a line series (`H5WEB_series`) from its attributes, as of overlays */
export function parseSeriesStyle(
  entity: Entity,
  values: AttributeValues,
  notes: string[],
  prefix: string,
): SeriesStyle {
  const read = createAttrReader(entity, values, notes, prefix);
  return {
    label: read.str('H5WEB_label') ?? read.str('long_name'),
    color: toRgbaColor(read.str('H5WEB_color', isCssColor)),
    width: read.num('H5WEB_width', isPos),
    dash: read.bool('H5WEB_dash'),
  };
}

/* `H5WEB_z`: path, or `value` / `surface` (case-insensitive) */
function parseZ(val: string | undefined): string | undefined {
  const key = val?.toLowerCase();
  return key === 'value' || key === 'surface' ? key : val;
}

const REFERENCE_GEOMETRIES = new Set(['hline', 'vline', 'band']);

/* Reference line (`hline`: y value, `vline`: x value) or band ([lo, hi] along `H5WEB_axis`) */
function parseReference(
  geometry: ReferenceOverlay['kind'],
  entity: Entity,
  read: AttrReader,
  style: Omit<ReferenceOverlay, 'kind' | 'value' | 'axis'>,
): ReferenceOverlay | string {
  const axis =
    geometry === 'band'
      ? read.oneOf('H5WEB_axis', parseAmong<'x' | 'y'>(['x', 'y']))
      : geometry === 'hline'
        ? 'y'
        : 'x';
  if (
    !isDataset(entity) ||
    (!hasArrayShape(entity) && !hasScalarShape(entity))
  ) {
    return `"${geometry}" needs a dataset`;
  }
  if (!axis) {
    return 'needs "H5WEB_axis" (x or y)';
  }
  if (geometry === 'band' && getDims(entity).at(-1) !== 2) {
    return '"band" needs a (2,) dataset [lo, hi]';
  }
  return { kind: geometry, value: entity.path, axis, ...style };
}

/**
 * Overlay drawn by an object listed in `H5WEB_overlays`, from its attributes: `H5WEB_geometry`
 * and style. `text`: value of a scalar string dataset. Returns why if it can't be drawn.
 */
export function parseOverlay(
  entity: Entity,
  values: AttributeValues,
  notes: string[],
  prefix: string,
  text?: string,
): OverlayHint | string {
  const read = createAttrReader(entity, values, notes, prefix);
  const geometry = read.str('H5WEB_geometry')?.toLowerCase();
  if (!geometry) {
    return 'no valid "H5WEB_geometry"';
  }

  const common = {
    columnNames: splitNames(
      read.str('H5WEB_columns', (val) => splitNames(val).length >= 2) ?? '',
    ),
    color: read.str('H5WEB_color'),
    colorBy: read.str('H5WEB_color_by'),
    width: read.num('H5WEB_width', (v) => Number.isFinite(v) && v > 0),
    label: read.str('H5WEB_label'),
    labelMode: read.oneOf<'inline' | 'legend'>('H5WEB_label_mode', (val) => {
      const mode = val.toLowerCase();
      return mode === 'inline' || mode === 'legend' ? mode : undefined;
    }),
    legendLabel: read.str('H5WEB_legend_label'),
    dash: read.bool('H5WEB_dash'),
    halo: read.bool('H5WEB_halo'),
    stroke: read.str('H5WEB_stroke'),
    sliceBy: read.str('H5WEB_slice_by'),
  };
  const style = {
    ...common,
    columnNames: common.columnNames.length > 0 ? common.columnNames : undefined,
  };

  if (geometry === 'points' || geometry === 'curve') {
    if (!isDataset(entity)) {
      return `"${geometry}" needs a dataset`;
    }
    return geometry === 'points'
      ? {
          kind: 'points',
          points: entity.path,
          z: parseZ(read.str('H5WEB_z')),
          size: read.num('H5WEB_size', (v) => Number.isFinite(v) && v > 0),
          ...style,
        }
      : {
          kind: 'curve',
          curve: entity.path,
          trail: read.bool('H5WEB_trail') ?? false,
          ...style,
        };
  }

  if (geometry === 'ellipse') {
    const mean = read.str('H5WEB_mean');
    const cov = read.str('H5WEB_cov');
    const nsigma = read.nums(
      'H5WEB_nsigma',
      (arr) => arr.length > 0 && arr.every((n) => Number.isFinite(n) && n > 0),
    );
    if (!mean || !cov) {
      return 'needs "H5WEB_mean" and "H5WEB_cov"';
    }
    return {
      kind: 'ellipse',
      mean,
      cov,
      scale: read.str('H5WEB_sigma'),
      nsigma: nsigma ?? [1, 2],
      ...style,
    };
  }

  if (geometry === 'text') {
    const at = read.nums(
      'H5WEB_at',
      (arr) => arr.length >= 2 && arr.every(Number.isFinite),
    );
    if (text === undefined) {
      return '"text" needs a scalar string dataset';
    }
    if (!at) {
      return 'needs "H5WEB_at"';
    }
    return {
      kind: 'text',
      text,
      at,
      anchor:
        read.oneOf('H5WEB_anchor', (val) => {
          const anchor = val.toLowerCase();
          return TEXT_ANCHORS.has(anchor) ? (anchor as TextAnchor) : undefined;
        }) ?? 'center',
      ...style,
    };
  }

  if (REFERENCE_GEOMETRIES.has(geometry)) {
    return parseReference(
      geometry as ReferenceOverlay['kind'],
      entity,
      read,
      style,
    );
  }

  return `unknown "H5WEB_geometry" "${geometry}"`;
}

function getDims(entity: Dataset): number[] {
  return hasArrayShape(entity) ? entity.shape.dims : [];
}

/* Whether an entity says how to view it */
export function hasViewAttrs(entity: Entity): boolean {
  return (
    (isDataset(entity) || isGroup(entity)) &&
    entity.attributes.some(({ name }) => name.startsWith(HINT_ATTR_PREFIX))
  );
}
