import {
  hasArrayShape,
  hasNumericType,
  hasStringType,
  isDataset,
  isGroup,
} from '@h5web/shared/guards';
import {
  type AttributeValues,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';

import { hasAttribute } from '../../../utils';
import {
  createAttrReader,
  isCssColor,
  isScatterHint,
  splitNames,
  toRgbaColor,
} from '../../view-hints/attrs';
import { HintVis } from '../../view-hints/models';
import { type OverlayContext } from '../../view-hints/overlays';
import {
  type CoordinateRole,
  COORDINATES_ATTR,
  FEATURE_TYPE_ATTR,
  getAxisLabel,
  identifyRole,
  type NumDataset,
  parseCoordinatesAttr,
  resolveCoordinate,
} from '../geometry/utils';

/* Points (`H5WEB_vis = "scatter"` / `"scatter3d"`), cf. `H5WEB_VIEW_SCHEMA.md`, in three forms:
 * - columns of an (n, k) dataset (`H5WEB_scatter_columns`, default x y [z] [color] [size]);
 * - 1D dataset of values at CF `coordinates` (1D, same length), coloured by its values - also
 *   without hint when its CF `featureType` is `point`;
 * - group naming 1D datasets of the same length (`H5WEB_x`, `_y`, `_z`, `_color`, `_size`). */

export type ScatterChannel = 'x' | 'y' | 'z' | 'color' | 'size';

const CHANNELS = new Map<string, ScatterChannel | null>([
  ['x', 'x'],
  ['y', 'y'],
  ['z', 'z'],
  ['color', 'color'],
  ['colour', 'color'],
  ['size', 'size'],
  ['-', null], // skipped column
  ['_', null],
]);

export interface ChannelDef {
  dataset: NumDataset;
  column?: number; // of an (n, k) dataset
  label: string;
}

export interface ScatterSource {
  form: 'columns' | 'coordinates' | 'group';
  count: number;
  channels: { x: ChannelDef; y: ChannelDef } & Partial<
    Record<'z' | 'color' | 'size', ChannelDef>
  >;
  solidColor?: string; // CSS colour of all points (`H5WEB_color`), without colour channel
  sizeRange?: [number, number]; // `H5WEB_size_range`: diameters in CSS pixels
  pointSize?: number; // `H5WEB_point_size`: diameter without size channel
  opacity?: number; // `H5WEB_point_opacity`
  notes: string[];
}

export const POINT_FEATURE_TYPE = 'point';
const MAX_POINT_SIZE = 100; // CSS pixels

/**
 * Channel of each column from `H5WEB_scatter_columns`: space-separated, one per column, among
 * `x`, `y`, `z`, `color`, `size`, or `-` to skip a column (columns beyond the list are skipped).
 * `undefined` if invalid: unknown name, channel repeated, more names than columns, no x or y.
 */
export function parseScatterColumns(
  val: string,
  columnCount: number,
): (ScatterChannel | undefined)[] | undefined {
  const names = splitNames(val.toLowerCase());
  const channels = names.map((name) => CHANNELS.get(name));
  const used = channels.filter((c) => c !== null);

  return names.length <= columnCount &&
    channels.every((c) => c !== undefined) &&
    new Set(used).size === used.length &&
    used.includes('x') &&
    used.includes('y')
    ? channels.map((c) => c ?? undefined)
    : undefined;
}

/** Default channels of the columns: x y, then z (3D) or colour, colour, size. */
export function getDefaultColumns(
  columnCount: number,
  is3D: boolean,
): ScatterChannel[] {
  const order: ScatterChannel[] = is3D
    ? ['x', 'y', 'z', 'color', 'size']
    : ['x', 'y', 'color', 'size'];
  return order.slice(0, columnCount);
}

/** Column labels from `H5WEB_column_labels`: array of strings, or space-separated string. */
export function parseColumnLabels(
  value: unknown,
  columnCount: number,
): string[] | undefined {
  const labels =
    typeof value === 'string'
      ? splitNames(value)
      : Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? value.map((label) => label.trim())
        : undefined;
  return labels?.length === columnCount ? labels : undefined;
}

function isNumDataset(
  entity: ProvidedEntity | undefined,
): entity is NumDataset {
  return (
    !!entity &&
    isDataset(entity) &&
    hasArrayShape(entity) &&
    hasNumericType(entity)
  );
}

function isVector(
  entity: ProvidedEntity | undefined,
  length?: number,
): entity is NumDataset {
  return (
    isNumDataset(entity) &&
    entity.shape.dims.length === 1 &&
    (length === undefined || entity.shape.dims[0] === length)
  );
}

async function getLabel(
  dataset: NumDataset,
  ctx: OverlayContext,
): Promise<string> {
  const [longName, units] = await Promise.all([
    ctx.getStrAttr(dataset, 'long_name'),
    ctx.getStrAttr(dataset, 'units'),
  ]);
  return getAxisLabel(dataset.name, longName || undefined, units || undefined);
}

function isSize(v: number): boolean {
  return Number.isFinite(v) && v > 0 && v <= MAX_POINT_SIZE;
}

function readStyle(
  entity: ProvidedEntity,
  values: AttributeValues,
  notes: string[],
): Pick<ScatterSource, 'sizeRange' | 'pointSize' | 'opacity'> {
  const read = createAttrReader(entity, values, notes);
  const range = read.nums(
    'H5WEB_size_range',
    (arr) => arr.length === 2 && arr.every(isSize) && arr[0] <= arr[1],
  );
  return {
    sizeRange: range && [range[0], range[1]],
    pointSize: read.num('H5WEB_point_size', isSize),
    opacity: read.num('H5WEB_point_opacity', (v) => v > 0 && v <= 1),
  };
}

/* 1D dataset of `count` values named by an attribute, resolved like overlay paths (CF
 * `coordinates`: relative to `anchor`'s group, bare names also in ancestor groups) */
async function resolveVector(
  anchor: string,
  name: string,
  count: number | undefined,
  ctx: OverlayContext,
): Promise<NumDataset | undefined> {
  const entity = await resolveCoordinate(anchor, name, ctx);
  return isVector(entity, count) ? entity : undefined;
}

async function toChannel(
  dataset: NumDataset,
  ctx: OverlayContext,
): Promise<ChannelDef> {
  return { dataset, label: await getLabel(dataset, ctx) };
}

/* Group form: `H5WEB_x` and `H5WEB_y` required; other channels skipped with a note if they can't
 * be found; `H5WEB_color` that is not a dataset may be a CSS colour */
async function findGroupSource(
  group: ProvidedEntity,
  ctx: OverlayContext,
): Promise<ScatterSource | undefined> {
  const values = (await ctx.getAttrValues(group)) ?? {};
  const notes: string[] = [];
  const read = createAttrReader(group, values, notes);
  const anchor = `${group.path.replace(/\/$/u, '')}/.`;
  const [xName, yName] = [read.str('H5WEB_x'), read.str('H5WEB_y')];
  if (!xName || !yName) {
    return undefined;
  }

  const x = await resolveVector(anchor, xName, undefined, ctx);
  const count = x?.shape.dims[0];
  const y = await resolveVector(anchor, yName, count, ctx);
  if (!x || !y) {
    return undefined;
  }

  const channels: ScatterSource['channels'] = {
    x: await toChannel(x, ctx),
    y: await toChannel(y, ctx),
  };
  let solidColor: string | undefined;

  for (const channel of ['z', 'color', 'size'] as const) {
    const attrName = `H5WEB_${channel}`;
    const name = read.str(attrName);
    const dataset = name && (await resolveVector(anchor, name, count, ctx)); // eslint-disable-line no-await-in-loop -- few channels
    if (dataset) {
      channels[channel] = await toChannel(dataset, ctx); // eslint-disable-line no-await-in-loop
    } else if (name && channel === 'color' && isCssColor(name)) {
      solidColor = toRgbaColor(name);
    } else if (name) {
      notes.push(`"${attrName}": no (${count},) numeric dataset "${name}"`);
    }
  }

  return {
    form: 'group',
    count: count ?? 0,
    channels,
    solidColor,
    ...readStyle(group, values, notes),
    notes,
  };
}

/* Whether a field's own CF `featureType`, or else the file's, is `point` */
async function isPointFeature(
  field: NumDataset,
  ctx: OverlayContext,
): Promise<boolean> {
  const ownType = await ctx.getStrAttr(field, FEATURE_TYPE_ATTR);
  if (ownType !== undefined) {
    return ownType.trim().toLowerCase() === POINT_FEATURE_TYPE;
  }
  const root = await ctx.getEntity('/');
  const globalType = root && (await ctx.getStrAttr(root, FEATURE_TYPE_ATTR));
  return globalType?.trim().toLowerCase() === POINT_FEATURE_TYPE;
}

const ROLE_ORDER: CoordinateRole[] = ['X', 'Y', 'Z'];

/* Coordinates form: x, y and z among the 1D `coordinates` of the same length as the field (time
 * left out), in X, Y, Z order when all are identified as in CF, else as listed */
async function findCoordinatesSource(
  field: NumDataset,
  isHinted: boolean,
  ctx: OverlayContext,
): Promise<ScatterSource | undefined> {
  const { dims } = field.shape;
  const coordinatesAttr = await ctx.getStrAttr(field, COORDINATES_ATTR);
  if (dims.length !== 1 || !coordinatesAttr) {
    return undefined;
  }
  if (!isHinted && !(await isPointFeature(field, ctx))) {
    return undefined;
  }

  const [count] = dims;
  const entities = await Promise.all(
    parseCoordinatesAttr(coordinatesAttr).map(async (name) =>
      resolveCoordinate(field.path, name, ctx),
    ),
  );
  const candidates = entities.filter(
    (entity): entity is NumDataset =>
      isVector(entity, count) && entity.path !== field.path,
  );
  const roles = await Promise.all(
    candidates.map(async (dataset) => {
      const [axis, standardName, units, positive] = await Promise.all(
        ['axis', 'standard_name', 'units', 'positive'].map(async (name) =>
          ctx.getStrAttr(dataset, name),
        ),
      );
      return identifyRole({ axis, standardName, units, positive });
    }),
  );

  let spatial = candidates
    .map((dataset, i) => ({ dataset, role: roles[i] }))
    .filter(({ role }) => role !== 'T');
  const identified = spatial.map(({ role }) => role);
  if (
    identified.every((role) => role !== undefined) &&
    new Set(identified).size === identified.length
  ) {
    spatial = spatial.toSorted(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role ?? 'X') - ROLE_ORDER.indexOf(b.role ?? 'X'),
    );
  }
  if (spatial.length < 2) {
    return undefined;
  }

  const values = (await ctx.getAttrValues(field)) ?? {};
  const notes: string[] = [];
  const read = createAttrReader(field, values, notes);
  const sizeName = read.str('H5WEB_size');
  const size =
    sizeName && (await resolveVector(field.path, sizeName, count, ctx));
  if (sizeName && !size) {
    notes.push(`"H5WEB_size": no (${count},) numeric dataset "${sizeName}"`);
  }

  const [x, y, z] = await Promise.all(
    spatial.slice(0, 3).map(async ({ dataset }) => toChannel(dataset, ctx)),
  );
  return {
    form: 'coordinates',
    count,
    channels: {
      x,
      y,
      ...(spatial.length > 2 && { z }), // no `undefined` channel
      color: await toChannel(field, ctx),
      ...(size && { size: await toChannel(size, ctx) }),
    },
    ...readStyle(field, values, notes),
    notes,
  };
}

/* Name of each column: `H5WEB_column_labels`, else string dimension scale of the columns */
async function getColumnLabels(
  dataset: NumDataset,
  values: AttributeValues,
  columnCount: number,
  notes: string[],
  ctx: OverlayContext,
): Promise<string[] | undefined> {
  if (hasAttribute(dataset, 'H5WEB_column_labels')) {
    const labels = parseColumnLabels(values.H5WEB_column_labels, columnCount);
    if (!labels) {
      notes.push('ignored invalid "H5WEB_column_labels"');
    }
    return labels;
  }

  const allScalePaths = await ctx.getDimensionScales(dataset);
  const scalePaths = allScalePaths?.[1] ?? [];
  for (const path of scalePaths) {
    const scale = await ctx.getEntity(path); // eslint-disable-line no-await-in-loop -- usually one scale
    if (
      scale &&
      isDataset(scale) &&
      hasArrayShape(scale) &&
      hasStringType(scale) &&
      scale.shape.dims.length === 1 &&
      scale.shape.dims[0] === columnCount
    ) {
      const labels = parseColumnLabels(await ctx.getValue(scale), columnCount); // eslint-disable-line no-await-in-loop
      if (labels) {
        return labels;
      }
    }
  }
  return undefined;
}

async function findColumnsSource(
  dataset: NumDataset,
  is3D: boolean,
  ctx: OverlayContext,
): Promise<ScatterSource | undefined> {
  const { dims } = dataset.shape;
  if (dims.length !== 2 || dims[1] < 2) {
    return undefined;
  }

  const values = (await ctx.getAttrValues(dataset)) ?? {};
  const [count, columnCount] = dims;
  const notes: string[] = [];
  const read = createAttrReader(dataset, values, notes);
  const roles =
    read.oneOf('H5WEB_scatter_columns', (val) =>
      parseScatterColumns(val, columnCount),
    ) ?? getDefaultColumns(columnCount, is3D);

  const labels = await getColumnLabels(
    dataset,
    values,
    columnCount,
    notes,
    ctx,
  );
  const units = await ctx.getStrAttr(dataset, 'units');
  const channels: Partial<ScatterSource['channels']> = {};
  roles.forEach((role, column) => {
    if (role) {
      const label =
        labels?.[column] ?? (role === 'color' ? dataset.name : role);
      const withUnits = role === 'x' || role === 'y' || role === 'z';
      channels[role] = {
        dataset,
        column,
        label:
          withUnits && units ? getAxisLabel(label, undefined, units) : label,
      };
    }
  });

  const { x, y } = channels;
  if (!x || !y) {
    return undefined; // cannot happen: x and y are required
  }

  const colorName = read.str('H5WEB_color', isCssColor);
  return {
    form: 'columns',
    count,
    channels: { ...channels, x, y },
    solidColor: channels.color ? undefined : toRgbaColor(colorName),
    ...readStyle(dataset, values, notes),
    notes,
  };
}

/**
 * Points an entity describes, according to its view hint (`hintVis`); `undefined` if it does not
 * describe any. Rejects on transport errors (cf. `GeometryContext`).
 */
export async function findScatterSource(
  entity: ProvidedEntity,
  hintVis: HintVis | undefined,
  ctx: OverlayContext,
): Promise<ScatterSource | undefined> {
  const isHinted = isScatterHint(hintVis);
  if (isGroup(entity)) {
    return isHinted && hasAttribute(entity, 'H5WEB_x')
      ? findGroupSource(entity, ctx)
      : undefined;
  }
  if (!isNumDataset(entity)) {
    return undefined;
  }
  const coordinatesSource =
    hasAttribute(entity, COORDINATES_ATTR) &&
    (await findCoordinatesSource(entity, isHinted, ctx));
  if (coordinatesSource) {
    return coordinatesSource;
  }
  return isHinted
    ? findColumnsSource(entity, hintVis === HintVis.Scatter3D, ctx)
    : undefined;
}
