import { INTERPOLATORS } from '@h5web/lib';
import {
  isAxisScaleType,
  isColorScaleType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import { type ProvidedEntity } from '@h5web/shared/hdf5-models';
import {
  type AxisScaleType,
  type ColorScaleType,
  ComplexVisType,
} from '@h5web/shared/vis-models';
import { queryOptions } from '@tanstack/react-query';

import { type DataContextValue } from '../../providers/DataProvider';
import { isTransportError } from '../../providers/utils';
import { getAttributeValue } from '../../utils';
import { findStrAttr } from '../core/geometry/utils';
import { type ColorMap } from '../core/heatmap/models';
import { type VisDef } from '../models';
import {
  EMPTY_HINT,
  HintVis,
  type OverlayHint,
  type TextAnchor,
  VIEW_HINT_ATTR,
  type ViewHint,
} from './models';

type Json = Record<string, unknown>;

function isObject(val: unknown): val is Json {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isFiniteNum(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

function isStr(val: unknown): val is string {
  return typeof val === 'string' && val.length > 0;
}

function isIndex(val: unknown): val is number {
  return Number.isInteger(val) && (val as number) >= 0;
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

function parseScaleType(val: unknown): ColorScaleType | undefined {
  const type = typeof val === 'string' ? val.toLowerCase() : val;
  return isColorScaleType(type) ? type : undefined;
}

function parseAxisScaleType(val: unknown): AxisScaleType | undefined {
  const type = typeof val === 'string' ? val.toLowerCase() : val;
  return isAxisScaleType(type) ? type : undefined;
}

const TEXT_ANCHORS = new Set<TextAnchor>([
  'top',
  'bottom',
  'left',
  'right',
  'center',
]);

function parseAxisOption(
  axes: unknown,
  axis: 'x' | 'y',
): AxisScaleType | undefined {
  const opts = isObject(axes) ? axes[axis] : undefined;
  return isObject(opts) ? parseAxisScaleType(opts.scaleType) : undefined;
}

function parseColumns(val: unknown): number[] | undefined {
  return Array.isArray(val) && val.length >= 2 && val.every(isIndex)
    ? val
    : undefined;
}

function parseNumbers(val: unknown): number[] | undefined {
  const arr = isFiniteNum(val) ? [val] : val;
  return Array.isArray(arr) && arr.length > 0 && arr.every(isFiniteNum)
    ? arr
    : undefined;
}

function parseDomain(val: unknown): ViewHint['domain'] {
  if (
    !Array.isArray(val) ||
    val.length !== 2 ||
    !val.every((v) => v === null || isFiniteNum(v))
  ) {
    return undefined;
  }
  return val as [number | null, number | null];
}

function parseContours(val: unknown): ViewHint['contours'] {
  if (isObject(val)) {
    // Object form: `{"levels": [...]}` or `{"count": 8}` (styles are read separately)
    return val.levels === undefined
      ? parseContours(val.count ?? true)
      : parseContours(val.levels);
  }
  if (val === true) {
    return 0; // automatic levels, stored count
  }
  if (val === false) {
    return [];
  }
  if (Number.isInteger(val) && (val as number) > 0) {
    return val as number;
  }
  return Array.isArray(val) ? parseNumbers(val) : undefined;
}

function optStr(obj: Json, key: string): string | undefined {
  return isStr(obj[key]) ? obj[key] : undefined;
}

/* Keys shared by all overlays: columns and style */
function parseOverlayStyle(raw: Json) {
  return {
    columns: parseColumns(raw.columns),
    columnNames:
      Array.isArray(raw.columns) &&
      raw.columns.length >= 2 &&
      raw.columns.every(isStr)
        ? raw.columns
        : undefined,
    color: optStr(raw, 'color'),
    colorBy: optStr(raw, 'colorBy'),
    width: isFiniteNum(raw.width) && raw.width > 0 ? raw.width : undefined,
    label: optStr(raw, 'label'),
    labelMode: raw.labelMode === 'inline' ? ('inline' as const) : undefined,
    dash: raw.dash === true ? true : undefined,
    stroke: optStr(raw, 'stroke'),
  };
}

/* An overlay is an object with one of `points`, `ellipse` or `curve` keys */
export function parseOverlay(raw: unknown): OverlayHint | undefined {
  if (!isObject(raw)) {
    return undefined;
  }

  const common = parseOverlayStyle(raw);

  if (isStr(raw.text)) {
    const at = parseNumbers(raw.at);
    return at && at.length >= 2
      ? {
          kind: 'text',
          text: raw.text,
          at,
          anchor: TEXT_ANCHORS.has(raw.anchor as TextAnchor)
            ? (raw.anchor as TextAnchor)
            : 'center',
          ...common,
        }
      : undefined;
  }

  if (isStr(raw.points)) {
    return {
      kind: 'points',
      points: raw.points,
      z: optStr(raw, 'z'),
      size: isFiniteNum(raw.size) && raw.size > 0 ? raw.size : undefined,
      ...common,
    };
  }

  if (isObject(raw.ellipse)) {
    const { ellipse } = raw;
    if (!isStr(ellipse.mean) || !isStr(ellipse.cov)) {
      return undefined;
    }
    return {
      kind: 'ellipse',
      mean: ellipse.mean,
      cov: ellipse.cov,
      scale: optStr(ellipse, 'scale'),
      nsigma: parseNumbers(ellipse.nsigma ?? raw.nsigma)?.filter(
        (n) => n > 0,
      ) ?? [1],
      ...common,
    };
  }

  if (isStr(raw.curve)) {
    return {
      kind: 'curve',
      curve: raw.curve,
      trail: raw.trail === true,
      ...common,
    };
  }

  return undefined;
}

/* Parse an `H5WEB_view` attribute. Forgiving: unknown keys and invalid values are ignored
 * (invalid values are listed in `notes`); never throws. */
export function parseViewHint(json: string): ViewHint {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ...EMPTY_HINT, notes: [`${VIEW_HINT_ATTR} is not valid JSON`] };
  }

  if (!isObject(raw)) {
    return { ...EMPTY_HINT, notes: [`${VIEW_HINT_ATTR} is not a JSON object`] };
  }

  const notes: string[] = [];
  function check<T>(key: string, parse: (val: unknown) => T | undefined) {
    if (raw === undefined || !isObject(raw) || !(key in raw)) {
      return undefined;
    }
    const val = parse(raw[key]);
    if (val === undefined) {
      notes.push(`ignored invalid "${key}"`);
    }
    return val;
  }

  const overlays = check('overlays', (val) =>
    Array.isArray(val) ? val : undefined,
  );
  const parsedOverlays = (overlays ?? []).map(parseOverlay);
  parsedOverlays.forEach((overlay, i) => {
    if (!overlay) {
      notes.push(`ignored invalid overlay ${i + 1}`);
    }
  });

  return {
    vis: check('vis', (val) =>
      typeof val === 'string' ? HINT_VIS.get(toKey(val) as HintVis) : undefined,
    ),
    scaleType: check('scaleType', parseScaleType),
    height: check('height', parseScaleType),
    // `axes`: per-axis options keyed by `x` or `y` (dimension names: not yet)
    xScaleType:
      check('xScaleType', parseAxisScaleType) ?? parseAxisOption(raw.axes, 'x'),
    yScaleType:
      check('yScaleType', parseAxisScaleType) ?? parseAxisOption(raw.axes, 'y'),
    colorMap: check('colorMap', (val) =>
      typeof val === 'string'
        ? val.toLowerCase() === 'auto'
          ? 'auto'
          : COLOR_MAPS.get(toKey(val))
        : undefined,
    ),
    invertColorMap: check('invertColorMap', (val) =>
      typeof val === 'boolean' ? val : undefined,
    ),
    domain: check('domain', (val) =>
      val === 'symmetric' ? val : parseDomain(val),
    ),
    center: check('center', (val) => (isFiniteNum(val) ? val : undefined)),
    legend: check('legend', (val) =>
      typeof val === 'boolean' ? val : undefined,
    ),
    keepRatio: check('keepRatio', (val) =>
      typeof val === 'boolean' ? val : undefined,
    ),
    heightScale: check('heightScale', (val) =>
      isFiniteNum(val) && val > 0 ? val : undefined,
    ),
    contours: check('contours', parseContours),
    complex: check('complex', (val) =>
      typeof val === 'string' ? COMPLEX_TYPES.get(toKey(val)) : undefined,
    ),
    isoLevels: check('isoLevels', parseNumbers),
    xDim: check('xDim', (val) => (isIndex(val) ? val : undefined)),
    multiDim: check('multiDim', (val) => (isIndex(val) ? val : undefined)),
    title: check('title', (val) => (isStr(val) ? val : undefined)),
    contourLabels:
      isObject(raw.contours) && raw.contours.labels === true ? true : undefined,
    contourColor: isObject(raw.contours)
      ? optStr(raw.contours, 'color')
      : undefined,
    sliceBy:
      check('sliceBy', (val) => (isStr(val) ? val : undefined)) ??
      (isObject(raw.playback) ? optStr(raw.playback, 'dim') : undefined),
    overlays: parsedOverlays.filter((overlay) => overlay !== undefined),
    notes,
  };
}

/* Hint of a dataset, or of an NXdata group (falling back to its signal's). Data errors give no
 * hint (with a note); transport errors are thrown (cf. `getHintSafely`). */
export async function getViewHint(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
  signal?: ProvidedEntity,
): Promise<ViewHint> {
  for (const candidate of [entity, signal]) {
    if (!candidate || (!isDataset(candidate) && !isGroup(candidate))) {
      continue;
    }

    const attr = findStrAttr(candidate, VIEW_HINT_ATTR);
    if (attr) {
      let value: unknown;
      try {
        value = await getAttributeValue(candidate, attr, dataContext); // eslint-disable-line no-await-in-loop -- signal only if group has no hint
      } catch (error) {
        if (isTransportError(error)) {
          throw error; // transient: not cached, fetched again later
        }
        // e.g. another attribute of the entity can't be decoded: open the entity without hint
        return {
          ...EMPTY_HINT,
          notes: [`${VIEW_HINT_ATTR} could not be read`],
        };
      }

      const str = Array.isArray(value) ? (value[0] as unknown) : value;
      if (typeof str === 'string') {
        const anchor = isGroup(candidate)
          ? `${candidate.path.replace(/\/$/u, '')}/.`
          : candidate.path;
        return { ...parseViewHint(str), anchor };
      }
    }
  }

  return EMPTY_HINT;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types -- prefer automatic type inference
export function viewHintQuery(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
  signal?: ProvidedEntity,
) {
  return queryOptions({
    queryKey: [dataContext.filepath, 'viewHint', entity.path] as const,
    queryFn: async () => getViewHint(entity, dataContext, signal),
  });
}

/* Names of the visualizations (core, then NeXus) that a hinted vis id stands for */
const VIS_NAMES: Record<HintVis, string[]> = {
  [HintVis.Scalar]: ['Scalar'],
  [HintVis.Matrix]: ['Matrix'],
  [HintVis.Line]: ['Line', 'NX Line'],
  [HintVis.Heatmap]: ['Heatmap', 'NX Heatmap'],
  [HintVis.Surface]: ['Surface', 'NX Surface', 'Heatmap', 'NX Heatmap'], // parametric if `coordinates`
  [HintVis.ComplexSurface]: ['Heatmap', 'NX Heatmap'],
  [HintVis.ParamSurface]: ['Surface', 'NX Surface'],
  [HintVis.ComplexLine]: ['Line', 'NX Line'],
  [HintVis.ComplexHeatmap]: ['Heatmap', 'NX Heatmap'],
  [HintVis.ComplexCurve]: ['Complex Curve', 'NX Complex Curve'],
  [HintVis.Volume]: ['Volume', 'NX Volume'],
  [HintVis.Curve]: ['Curve', 'NX Curve', 'Complex Curve', 'NX Complex Curve'],
  [HintVis.RGB]: ['RGB', 'NX RGB'],
  [HintVis.Scatter]: ['NX Scatter'],
  [HintVis.Compound]: ['Compound'],
};

/* Supported visualization asked for by the hint, if any */
export function findHintVis<T extends VisDef>(
  hint: ViewHint,
  supportedVis: T[],
): T | undefined {
  if (!hint.vis) {
    return undefined;
  }

  for (const name of VIS_NAMES[hint.vis]) {
    const vis = supportedVis.find((v) => v.name === name);
    if (vis) {
      return vis;
    }
  }

  return undefined;
}

/* Whether the hint asks for a heatmap in 3D (`undefined` if it doesn't say) */
export function isSurfaceHint(hint: ViewHint): boolean | undefined {
  if (!hint.vis) {
    return undefined;
  }
  if (hint.vis === HintVis.Surface || hint.vis === HintVis.ComplexSurface) {
    return true;
  }
  return hint.vis === HintVis.Heatmap || hint.vis === HintVis.ComplexHeatmap
    ? false
    : undefined;
}

/* Hint for resolving the vis to open: a hint that can't be fetched (e.g. network error) must not
 * prevent opening the entity, and is fetched again by the vis (cf. `useViewHint`) */
export async function getHintSafely(
  ...args: Parameters<typeof viewHintQuery>
): Promise<ViewHint> {
  const [entity, dataContext] = args;
  try {
    return await dataContext.queryClient.query(viewHintQuery(...args));
  } catch {
    return {
      ...EMPTY_HINT,
      notes: [`${VIEW_HINT_ATTR} of ${entity.name} could not be fetched`],
    };
  }
}

/* Notes about a hint in a vis that doesn't draw overlays (e.g. line, volume) */
export function getHintNotes(hint: ViewHint): string[] {
  return hint.overlays.length > 0
    ? [...hint.notes, 'overlays are drawn on heatmaps only']
    : hint.notes;
}

/* Note about overlay features not drawn on 3D surfaces, if the hint uses any */
export function getNotesIn3D(hint: ViewHint): string[] {
  const unsupported = [
    hint.overlays.some(({ kind }) => kind === 'text') && 'text',
    hint.overlays.some(({ dash }) => dash) && 'dashes',
    hint.overlays.some(({ labelMode }) => labelMode === 'inline') &&
      'inline labels',
  ].filter((feature) => typeof feature === 'string');

  return unsupported.length > 0
    ? [`not drawn in 3D: ${unsupported.join(', ')}`]
    : [];
}
