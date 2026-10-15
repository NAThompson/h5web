import { isNonUniformAxis } from '@h5web/lib';
import {
  hasArrayShape,
  hasNumericType,
  hasScalarShape,
  hasStringType,
  isDataset,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type AttributeValues,
  type Dataset,
  type NumericType,
  type ProvidedEntity,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';

import { type DataContextValue } from '../../providers/DataProvider';
import { type ValueQueryParams } from '../../providers/models';
import { isTransportError } from '../../providers/utils';
import {
  createGeometryContext,
  type GeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import { isPhonyScaleName } from '../dimscales/utils';
import { parseOverlay } from './attrs';
import {
  type CurveOverlay,
  type EllipseOverlay,
  type OverlayHint,
  type PointsOverlay,
  type ReferenceOverlay,
  type TextAnchor,
  type TextOverlay,
  type ViewHint,
} from './models';

/* Also fetches the attributes of overlay objects, and the text of text overlays: `undefined` if
 * they can't be read (rejects on transport errors, as `GeometryContext`) */
export interface OverlayContext extends GeometryContext {
  getAttrValues: (
    entity: ProvidedEntity,
  ) => Promise<AttributeValues | undefined>;
  getValue: (dataset: Dataset<ScalarShape | ArrayShape>) => Promise<unknown>;
}

async function ignoreDataErrors<T>(
  promise: Promise<T>,
): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }
    return undefined;
  }
}

export function createOverlayContext(
  dataContext: DataContextValue,
): OverlayContext {
  const { queryClient, queries } = dataContext;
  return {
    ...createGeometryContext(dataContext),
    getAttrValues: async (entity) =>
      ignoreDataErrors(queryClient.query(queries.attrValues(entity))),
    getValue: async (dataset) =>
      ignoreDataErrors(queryClient.query(queries.value(dataset))),
  };
}

type OverlayDatasetShape = ScalarShape | ArrayShape;
export type OverlayDataset = Dataset<OverlayDatasetShape, NumericType>;

/* Dimension along which datasets are sliced together: a dimension scale shared by the base
 * dataset and the overlays' datasets (e.g. `generation`) */
export interface Link {
  scalePath: string;
  label: string;
  length: number;
  baseDim?: number; // dimension of the base dataset with this scale; else an extra slider
}

export interface OverlayInput {
  dataset: OverlayDataset;
  linkedDim?: number; // dimension sliced at the linked index (none: whole dataset)
}

export interface ResolvedOverlay {
  hint: OverlayHint;
  label: string; // e.g. `overlay 2 (ellipse)`, for notes
  inputs: Partial<Record<string, OverlayInput>>; // by role (`points`, `color`, `mean`...)
  columnOf: Partial<Record<number, number>>; // data column holding coordinates along each base dimension
}

/* Dimensions of the base dataset shown on the x and y axes */
export interface AxisDims {
  x: number;
  y: number;
}

export interface ResolvedOverlays {
  link?: Link;
  overlays: ResolvedOverlay[];
  notes: string[];
}

interface Role {
  role: string;
  path: string;
  rank: number; // rank once sliced at the linked index
  required: boolean;
}

/* Datasets an overlay needs, with their rank once sliced at the linked index */
function getRoles(hint: OverlayHint): Role[] {
  switch (hint.kind) {
    case 'points':
      return [
        { role: 'points', path: hint.points, rank: 2, required: true },
        ...(hint.colorBy
          ? [{ role: 'colorBy', path: hint.colorBy, rank: 1, required: false }]
          : []),
        ...(hint.z && hint.z !== 'value' && hint.z !== 'surface'
          ? [{ role: 'z', path: hint.z, rank: 1, required: false }]
          : []),
      ];
    case 'ellipse':
      return [
        { role: 'mean', path: hint.mean, rank: 1, required: true },
        { role: 'cov', path: hint.cov, rank: 2, required: true },
        ...(hint.scale
          ? [{ role: 'scale', path: hint.scale, rank: 0, required: false }]
          : []),
      ];
    case 'text':
      return []; // no dataset
    case 'hline':
    case 'vline':
    case 'band':
      return [
        {
          role: 'value',
          path: hint.value,
          rank: hint.kind === 'band' ? 1 : 0,
          required: true,
        },
      ];
    case 'curve':
      // A trail is the sequence of the linked dimension: one row per index
      return [
        {
          role: 'curve',
          path: hint.curve,
          rank: hint.trail ? 1 : 2,
          required: true,
        },
      ];
    default:
      return [];
  }
}

/* Overlays drawn on line views only */
export function isReference(hint: OverlayHint): hint is ReferenceOverlay {
  return hint.kind === 'hline' || hint.kind === 'vline' || hint.kind === 'band';
}

function isOverlayDataset(
  entity: ProvidedEntity | undefined,
): entity is OverlayDataset {
  return (
    !!entity &&
    isDataset(entity) &&
    (hasScalarShape(entity) || hasArrayShape(entity)) &&
    hasNumericType(entity)
  );
}

function getDims(dataset: OverlayDataset): number[] {
  return hasArrayShape(dataset) ? dataset.shape.dims : [];
}

/* Dimension of a dataset that has the link's scale attached. Datasets with no scale at all
 * (or whose provider can't tell) are linked by their first dimension if its length matches. */
export function findLinkedDim(
  dims: number[],
  scales: string[][] | null,
  link: Link | undefined,
  hasScales = scales?.some((paths) => paths.length > 0) ?? false, // e.g. netCDF phony scales
): number | undefined {
  if (!link) {
    return undefined;
  }

  const dim = scales?.findIndex((paths) => paths.includes(link.scalePath));
  if (dim !== undefined && dim >= 0) {
    return dim;
  }

  return !hasScales && dims[0] === link.length ? 0 : undefined;
}

async function getLink(
  scalePath: string,
  baseScales: string[][] | null,
  ctx: GeometryContext,
): Promise<Link | undefined> {
  const entity = await ctx.getEntity(scalePath);
  if (!isOverlayDataset(entity) || getDims(entity).length !== 1) {
    return undefined;
  }

  const name = await ctx.getStrAttr(entity, 'NAME');
  if (isPhonyScaleName(name)) {
    return undefined; // not a variable: nothing to slice along
  }

  const baseDim = baseScales?.findIndex((paths) => paths.includes(scalePath));
  return {
    scalePath,
    label: name || entity.name,
    length: getDims(entity)[0],
    baseDim: baseDim !== undefined && baseDim >= 0 ? baseDim : undefined,
  };
}

/* Entity at a path resolved like CF `coordinates`; `undefined` if it can't be found or fetched
 * (e.g. network error), so that only overlays that need it are skipped */
async function findEntity(
  anchor: string,
  path: string,
  ctx: GeometryContext,
): Promise<ProvidedEntity | undefined> {
  try {
    return await resolveCoordinate(anchor, path, ctx);
  } catch {
    return undefined;
  }
}

/* Scales without netCDF-4 phony dimensions (scales that are not variables), which never name
 * nor link dimensions */
export async function withoutPhonyScales(
  scales: string[][] | null | undefined,
  ctx: GeometryContext,
): Promise<string[][] | null> {
  if (!scales) {
    return null;
  }
  return Promise.all(
    scales.map(async (paths) => {
      const isPhony = await Promise.all(
        paths.map(async (path) => {
          const entity = await findEntity('/', path, ctx);
          return isPhonyScaleName(
            entity && (await ctx.getStrAttr(entity, 'NAME')),
          );
        }),
      );
      return paths.filter((_, i) => !isPhony[i]);
    }),
  );
}

async function getRawScales(
  dataset: OverlayDataset,
  ctx: GeometryContext,
): Promise<string[][] | null> {
  return hasArrayShape(dataset)
    ? ((await ctx.getDimensionScales(dataset)) ?? null) // cached by the query client
    : null;
}

async function getScales(
  dataset: OverlayDataset,
  ctx: GeometryContext,
): Promise<string[][] | null> {
  return withoutPhonyScales(await getRawScales(dataset, ctx), ctx);
}

interface FoundRole extends Role {
  entity: ProvidedEntity | undefined;
}

interface LoadedOverlay {
  overlay: OverlayHint;
  label: string;
  anchor: string; // paths of the overlay's attributes are resolved relative to this path
}

interface FoundOverlay {
  overlay: OverlayHint;
  label: string;
  roles: FoundRole[];
  sliceByPath?: string | null; // scale named by the overlay's `H5WEB_slice_by` (`null`: not found)
}

/* Overlay drawn by an object listed in `H5WEB_overlays` (from its attributes), or why not */
async function loadOverlay(
  anchor: string,
  path: string,
  ctx: OverlayContext,
  notes: string[],
): Promise<LoadedOverlay | string> {
  const label = `overlay "${path}"`;
  const entity = await findEntity(anchor, path, ctx);
  if (!entity) {
    return `${label}: not found`;
  }

  const values = await ctx.getAttrValues(entity);
  if (!values) {
    return `${label}: attributes could not be read`;
  }

  // Text overlay: a scalar string dataset
  const isText =
    isDataset(entity) &&
    hasStringType(entity) &&
    (hasScalarShape(entity) ||
      (hasArrayShape(entity) && entity.shape.dims.join(',') === '1'));
  const value = isText ? await ctx.getValue(entity) : undefined;
  const text: unknown = Array.isArray(value) ? value[0] : value;

  const overlay = parseOverlay(
    entity,
    values,
    notes,
    `${label}: `,
    typeof text === 'string' ? text : undefined,
  );
  if (typeof overlay === 'string') {
    return `${label}: ${overlay}`;
  }

  return {
    overlay,
    label,
    anchor: entity.path, // relative to the group holding the overlay object
  };
}

/* Link: declared scale, else a scale shared by an overlay's dataset and a sliced dimension of the
 * base dataset, else the scale of the first dimension of a dataset that needs slicing (e.g.
 * `generation`). Scales of the base's axes (last two dimensions) are never guessed as links: a
 * curve along the x axis, say, is drawn whole. */
async function findLink(
  hint: ViewHint,
  anchor: string,
  found: FoundOverlay[],
  baseScales: string[][] | null,
  ctx: GeometryContext,
): Promise<Link | undefined> {
  if (hint.sliceBy) {
    const entity = await findEntity(
      hint.sliceByAnchor ?? anchor,
      hint.sliceBy,
      ctx,
    );
    return entity && getLink(entity.path, baseScales, ctx);
  }

  // Scale named by an overlay (first one)
  const declared = found.find(({ sliceByPath }) => sliceByPath)?.sliceByPath;
  const declaredLink = declared && (await getLink(declared, baseScales, ctx));
  if (declaredLink) {
    return declaredLink;
  }

  const axisDimsCount = 2;
  const slicedScales = baseScales?.slice(0, -axisDimsCount) ?? [];
  const axisScales = new Set(baseScales?.slice(-axisDimsCount).flat());

  const datasets = found.flatMap(({ roles }) =>
    roles.flatMap(({ entity, rank }) =>
      isOverlayDataset(entity) ? [{ dataset: entity, rank }] : [],
    ),
  );
  const allScales = await Promise.all(
    datasets.map(async ({ dataset }) => getScales(dataset, ctx)),
  );

  const shared = allScales
    .flatMap((scales) => scales?.flat() ?? [])
    .find((path) => slicedScales.some((paths) => paths.includes(path)));
  const leading = datasets
    .map(({ dataset, rank }, i) =>
      getDims(dataset).length === rank + 1 ? allScales[i]?.[0]?.[0] : undefined,
    )
    .find((path) => path !== undefined && !axisScales.has(path));

  const scalePath = shared ?? leading;
  return scalePath ? getLink(scalePath, slicedScales, ctx) : undefined;
}

/* Names of each dimension of the base dataset: names of its scales (dataset name and `NAME`) */
export async function getDimNames(
  baseScales: string[][] | null,
  ctx: GeometryContext,
): Promise<string[][]> {
  return Promise.all(
    (baseScales ?? []).map(async (paths) => {
      const names = await Promise.all(
        paths.map(async (path) => {
          const entity = await findEntity('/', path, ctx);
          const name = entity && (await ctx.getStrAttr(entity, 'NAME'));
          return [path.slice(path.lastIndexOf('/') + 1), name ?? ''];
        }),
      );
      return names.flat().filter(Boolean);
    }),
  );
}

/* Data column holding coordinates along each dimension of the base dataset: by default, columns
 * 0 and 1 hold the last and second-to-last dimensions (x and y, as first shown); named columns
 * hold the dimensions whose scales have these names. `undefined` if names don't match. */
export function getColumnOf(
  overlay: OverlayHint,
  base: Dataset<ArrayShape>,
  dimNames: string[][],
): ResolvedOverlay['columnOf'] | undefined {
  const rank = base.shape.dims.length;
  if (!overlay.columnNames) {
    return { [rank - 1]: 0, [rank - 2]: 1 };
  }

  // Other columns (e.g. third coordinate of a Gaussian) are not drawn
  const columnOf: ResolvedOverlay['columnOf'] = {};
  for (const [col, name] of overlay.columnNames.entries()) {
    const dim = dimNames.findIndex((names) => names.includes(name));
    if (dim !== -1) {
      columnOf[dim] = col;
    }
  }
  return Object.keys(columnOf).length >= 2 ? columnOf : undefined;
}

/* Unlinked dataset of the expected rank; also a single point `(c,)` where rows `(N, c)` are
 * expected, and a scalar stored as `(1,)` */
function canUseWhole(dims: number[], rank: number, role: string): boolean {
  return (
    dims.length === rank ||
    (rank === 2 && role !== 'cov' && dims.length === 1) ||
    (rank === 0 && dims.length === 1 && dims[0] === 1)
  );
}

/* Check the datasets of an overlay once sliced at the linked index: inputs, or why not */
async function checkOverlay(
  { overlay, label, roles, sliceByPath }: FoundOverlay,
  columnOf: ResolvedOverlay['columnOf'],
  link: Link | undefined,
  ctx: GeometryContext,
  notes: string[],
): Promise<ResolvedOverlay | string> {
  const inputs: Partial<Record<string, OverlayInput>> = {};

  for (const { role, path, rank, required, entity } of roles) {
    if (!isOverlayDataset(entity)) {
      const reason = entity
        ? `"${path}" is not a numeric dataset`
        : `"${path}" not found`;
      if (required) {
        return reason;
      }
      notes.push(`${label}: ignored ${reason}`); // optional (e.g. colour): drawn without it
      continue;
    }

    const dims = getDims(entity);
    const rawScales = await getRawScales(entity, ctx); // eslint-disable-line no-await-in-loop -- cached
    const scales = await withoutPhonyScales(rawScales, ctx); // eslint-disable-line no-await-in-loop -- cached
    // An overlay's `H5WEB_slice_by` links its leading dimension, scale attached or not
    const isDeclared =
      !!link && sliceByPath === link.scalePath && dims[0] === link.length;
    const linkedDim =
      findLinkedDim(
        dims,
        scales,
        link,
        rawScales?.some((paths) => paths.length > 0),
      ) ?? (isDeclared ? 0 : undefined);
    const isLinked = linkedDim !== undefined && dims.length === rank + 1;
    // A dataset with the link's scale must be sliced; others may be used whole
    const hasLinkScale =
      !!link && !!scales?.some((p) => p.includes(link.scalePath));
    const fitsWhole = !hasLinkScale && canUseWhole(dims, rank, role);

    if (overlay.kind === 'curve' && overlay.trail && !isLinked) {
      return `"${path}" has no dimension linked to slicing, needed for a trail`;
    }
    if (!isLinked && !fitsWhole) {
      return `"${path}" has unexpected shape [${dims.join(', ')}]`;
    }

    inputs[role] = {
      dataset: entity,
      linkedDim: isLinked ? linkedDim : undefined,
    };
  }

  return { hint: overlay, label, inputs, columnOf };
}

/**
 * Resolve the overlays of a hint: find the objects listed in `H5WEB_overlays` and their datasets
 * (paths resolved like CF `coordinates`), read their attributes, find the dimension that links
 * them to the base dataset, and check their shapes. Overlays that can't be drawn are left out,
 * with a note saying why; never throws on data errors.
 */
export async function resolveOverlays(
  hint: ViewHint,
  base: Dataset<ArrayShape>,
  ctx: OverlayContext,
): Promise<ResolvedOverlays> {
  const notes = [...hint.notes];
  if (hint.overlayPaths.length === 0) {
    return { overlays: [], notes };
  }

  const anchor = hint.anchor ?? base.path;
  const baseScales = await withoutPhonyScales(
    await ctx.getDimensionScales(base),
    ctx,
  );

  const loaded = await Promise.all(
    hint.overlayPaths.map(async (path) => {
      const overlayNotes: string[] = [];
      const result = await loadOverlay(anchor, path, ctx, overlayNotes);
      return { result, overlayNotes };
    }),
  );
  // Datasets of the overlays, found in parallel; notes are kept in order
  const allFound = await Promise.all(
    loaded.map(async ({ result }) => {
      if (typeof result === 'string') {
        return undefined;
      }
      const { overlay, label, anchor: overlayAnchor } = result;
      const [roles, sliceBy] = await Promise.all([
        Promise.all(
          getRoles(overlay).map(async (role) => ({
            ...role,
            entity: await findEntity(overlayAnchor, role.path, ctx),
          })),
        ),
        overlay.sliceBy
          ? findEntity(overlayAnchor, overlay.sliceBy, ctx)
          : undefined,
      ]);
      return {
        overlay,
        label,
        roles,
        sliceByPath: overlay.sliceBy ? (sliceBy?.path ?? null) : undefined,
      };
    }),
  );
  const found: FoundOverlay[] = [];
  loaded.forEach(({ result, overlayNotes }, i) => {
    notes.push(...overlayNotes);
    const item = allFound[i];
    if (typeof result === 'string') {
      notes.push(result);
    }
    if (!item) {
      return;
    }
    if (item.sliceByPath === null) {
      notes.push(
        `${item.label}: "H5WEB_slice_by" dimension scale "${item.overlay.sliceBy}" not found`,
      );
    }
    found.push(item);
  });

  const link = await findLink(hint, anchor, found, baseScales, ctx);
  const dimNames = found.some(({ overlay }) => overlay.columnNames)
    ? await getDimNames(baseScales, ctx)
    : [];
  if (hint.sliceBy && !link) {
    notes.push(`"H5WEB_slice_by" dimension scale "${hint.sliceBy}" not found`);
  }
  for (const { label, overlay, sliceByPath } of found) {
    if (sliceByPath && link?.scalePath !== sliceByPath) {
      notes.push(
        `${label}: not linked by "H5WEB_slice_by" "${overlay.sliceBy}" (not a usable dimension scale, or another link is used)`,
      );
    }
  }

  const overlays: ResolvedOverlay[] = [];
  for (const item of found) {
    const columnOf = getColumnOf(item.overlay, base, dimNames);
    if (!columnOf) {
      notes.push(
        `${item.label}: "H5WEB_columns" "${item.overlay.columnNames?.join(' ')}" don't name dimensions of "${base.name}"`,
      );
      continue;
    }

    const result = await checkOverlay(item, columnOf, link, ctx, notes); // eslint-disable-line no-await-in-loop -- keep notes in order
    if (typeof result === 'string') {
      notes.push(`${item.label}: ${result}`);
    } else {
      overlays.push(result);
    }
  }

  return { link, overlays, notes };
}

/* Selection of a dataset at the linked index (`undefined`: whole dataset) */
export function getLinkedSelection(
  input: OverlayInput,
  index: number,
): string | undefined {
  const { dataset, linkedDim } = input;
  if (linkedDim === undefined) {
    return undefined;
  }
  return getDims(dataset)
    .map((_, i) => (i === linkedDim ? index : ':'))
    .join(',');
}

function isTrail(overlay: ResolvedOverlay): boolean {
  return overlay.hint.kind === 'curve' && overlay.hint.trail;
}

/* Value to fetch for an input of an overlay at a linked index (trails are fetched whole, once);
 * `undefined` if the input is linked but no index is given (e.g. dimension mapped to an axis) */
export function getInputRequest(
  overlay: ResolvedOverlay,
  input: OverlayInput,
  index: number | undefined,
): ValueQueryParams | undefined {
  if (input.linkedDim !== undefined && index === undefined) {
    return undefined;
  }

  const selection =
    isTrail(overlay) || index === undefined
      ? undefined
      : getLinkedSelection(input, index);
  return { dataset: input.dataset, selection };
}

export function getRequestKey({
  dataset,
  selection,
}: ValueQueryParams): string {
  return `${dataset.path}|${selection ?? ''}`;
}

/* Values to fetch to draw the overlays at a linked index */
export function getOverlayRequests(
  resolved: ResolvedOverlays | undefined,
  index: number | undefined,
): ValueQueryParams[] {
  const requests = new Map<string, ValueQueryParams>();
  for (const overlay of resolved?.overlays ?? []) {
    for (const input of Object.values(overlay.inputs)) {
      const request = input && getInputRequest(overlay, input, index);
      if (request) {
        requests.set(getRequestKey(request), request);
      }
    }
  }

  return [...requests.values()];
}

/* Index along the linked dimension of the base dataset, read from a slice selection */
export function getIndexFromSelection(
  selection: string | undefined,
  baseDim: number,
): number | undefined {
  const index = Number(selection?.split(',')[baseDim]);
  return Number.isInteger(index) ? index : undefined;
}

/* Points of an ellipse of a 2D Gaussian: mean + k √(eigenvalues of s² C) along its axes */
export function getEllipsePoints(
  mean: [number, number],
  cov: [[number, number], [number, number]],
  scale: number,
  nsigma: number,
  segments = 72,
): { x: number[]; y: number[] } {
  const [[a, b], [, d]] = cov;
  // Eigen decomposition of the symmetric matrix [[a, b], [b, d]]
  const half = (a + d) / 2;
  const diff = Math.hypot((a - d) / 2, b);
  const l1 = Math.max(half + diff, 0);
  const l2 = Math.max(half - diff, 0);
  const theta = b === 0 && a >= d ? 0 : Math.atan2(l1 - a, b);
  const [r1, r2] = [Math.sqrt(l1), Math.sqrt(l2)].map(
    (r) => r * scale * nsigma,
  );
  const [cos, sin] = [Math.cos(theta), Math.sin(theta)];

  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = (2 * Math.PI * i) / segments;
    const [u, v] = [r1 * Math.cos(t), r2 * Math.sin(t)];
    x.push(mean[0] + u * cos - v * sin);
    y.push(mean[1] + u * sin + v * cos);
  }
  return { x, y };
}

export interface OverlayPoints {
  x: number[];
  y: number[];
  z?: number[]; // heights (values of the base dataset); on the surface if undefined
  values?: number[]; // coloured with the base colour map
  fill: string;
  stroke?: string; // outline (default: halo contrasting with the fill)
  size: number;
  halo: boolean;
  label?: string;
}

export interface OverlayLine {
  x: number[];
  y: number[];
  stroke: string;
  width: number;
  dash: boolean;
  halo: boolean;
  label?: string;
  head: boolean; // marker at the last point (e.g. current position of a trail)
}

export interface OverlayText {
  x: number;
  y: number;
  text: string;
  anchor: TextAnchor; // side of the position where the text goes
  color: string;
  halo: boolean;
  isInline?: boolean; // label of an overlay: moved to stay inside the canvas
}

export interface OverlayShapes {
  points: OverlayPoints[];
  lines: OverlayLine[];
  texts: OverlayText[]; // text overlays and inline labels
}

type ValueGetter = (
  overlay: ResolvedOverlay,
  input: OverlayInput,
) => number[] | undefined;

export type ShapeBuilder<T> = (
  overlays: ResolvedOverlay[],
  getValues: ValueGetter,
  index: number | undefined,
  axes: AxisDims,
) => T;

/* Dimensions of an input once sliced at the linked index (or of a trail's rows) */
function getSlicedDims({ dataset, linkedDim }: OverlayInput): number[] {
  return getDims(dataset).filter((_, i) => i !== linkedDim);
}

/* Columns shown along the x and y axes; `undefined` if an axis shows a dimension that no column
 * holds (e.g. linked dimension mapped to an axis) */
function getColumns(
  overlay: ResolvedOverlay,
  axes: AxisDims,
): [number, number] | undefined {
  const cx = overlay.columnOf[axes.x];
  const cy = overlay.columnOf[axes.y];
  return cx === undefined || cy === undefined ? undefined : [cx, cy];
}

/* Notes about overlays not drawn because an axis shows a dimension that none of their columns
 * holds (e.g. a sliced dimension mapped to an axis); `dimLabels` name the dimensions */
export function getMissingAxisNotes(
  overlays: ResolvedOverlay[],
  axes: AxisDims,
  dimLabels: (string | undefined)[],
): string[] {
  return overlays.flatMap(({ label, columnOf }) => {
    const missing = (['x', 'y'] as const)
      .filter((axis) => columnOf[axes[axis]] === undefined)
      .map(
        (axis) => `${axis} axis (${dimLabels[axes[axis]] ?? `D${axes[axis]}`})`,
      );
    return missing.length > 0
      ? [
          `${label}: not drawn, "H5WEB_columns" don't name the ${missing.join(' or ')}`,
        ]
      : [];
  });
}

function getLineStyle(
  hint: OverlayHint,
): Pick<OverlayLine, 'stroke' | 'width' | 'dash' | 'halo' | 'label'> {
  return {
    stroke: hint.color ?? 'white',
    width: hint.width ?? 1.5,
    dash: hint.dash ?? false,
    halo: hint.halo ?? true,
    label: hint.label,
  };
}

function buildText(
  overlay: ResolvedOverlay,
  hint: TextOverlay,
  axes: AxisDims,
): OverlayText | undefined {
  const columns = getColumns(overlay, axes);
  if (!columns || Math.max(columns[0], columns[1]) >= hint.at.length) {
    return undefined;
  }
  return {
    x: hint.at[columns[0]],
    y: hint.at[columns[1]],
    text: hint.text,
    anchor: hint.anchor,
    color: hint.color ?? 'white',
    halo: hint.halo ?? true,
  };
}

/* Label drawn next to the last finite point of a shape (`labelMode: "inline"`) */
function getInlineLabel(
  hint: OverlayHint,
  { x, y }: { x: number[]; y: number[] },
  color: string,
): OverlayText[] {
  if (!hint.label || hint.labelMode !== 'inline') {
    return [];
  }

  // Middle of the finite points (e.g. of a line along an edge of the domain)
  const finite = x.flatMap((v, j) =>
    Number.isFinite(v) && Number.isFinite(y[j]) ? [[v, y[j]]] : [],
  );
  if (finite.length === 0) {
    return [];
  }
  const [x0, y0] = finite[Math.floor((finite.length - 1) / 2)];
  const [x1, y1] = finite[Math.ceil((finite.length - 1) / 2)];
  return [
    {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      text: hint.label,
      anchor: 'right',
      color,
      halo: hint.halo ?? true,
      isInline: true,
    },
  ];
}

/* Column `col` of a row-major (rows x cols) array */
function column(
  values: number[],
  cols: number,
  col: number,
  rows?: number,
): number[] {
  const count = rows ?? Math.floor(values.length / cols);
  return Array.from({ length: count }, (_, i) => values[i * cols + col]);
}

function buildPoints(
  overlay: ResolvedOverlay,
  hint: PointsOverlay,
  getValues: ValueGetter,
  axes: AxisDims,
): OverlayPoints | undefined {
  const { points, colorBy, z } = overlay.inputs;
  const values = points && getValues(overlay, points);
  const columns = getColumns(overlay, axes);
  if (!points || !values || !columns) {
    return undefined;
  }

  const [cx, cy] = columns;
  const cols = getSlicedDims(points).at(-1) ?? values.length; // single point: `(c,)`
  if (Math.max(cx, cy) >= cols) {
    return undefined;
  }

  // Heights: from a dataset, the third column, or else on the surface
  // Third column as height only when the columns aren't named (else: `H5WEB_z`, or on the surface)
  const zColumn =
    cols === 3 && !hint.columnNames
      ? [0, 1, 2].find((c) => c !== cx && c !== cy)
      : undefined;
  const colorValues = colorBy && getValues(overlay, colorBy);
  const zValues = z
    ? getValues(overlay, z)
    : hint.z === 'value'
      ? colorValues
      : zColumn === undefined || hint.z === 'surface'
        ? undefined
        : column(values, cols, zColumn);

  return {
    x: column(values, cols, cx),
    y: column(values, cols, cy),
    z: zValues,
    values: colorValues,
    fill: hint.color ?? 'white',
    stroke: hint.stroke,
    size: hint.size ?? 5,
    halo: hint.halo ?? true,
    label: hint.label,
  };
}

function buildEllipses(
  overlay: ResolvedOverlay,
  hint: EllipseOverlay,
  getValues: ValueGetter,
  axes: AxisDims,
): OverlayLine[] {
  const { mean: meanInput, cov: covInput, scale: scaleInput } = overlay.inputs;
  const mean = meanInput && getValues(overlay, meanInput);
  const cov = covInput && getValues(overlay, covInput);
  const scale = scaleInput ? getValues(overlay, scaleInput)?.[0] : 1;
  const columns = getColumns(overlay, axes);
  const d = mean?.length ?? 0;
  if (!mean || !cov || scale === undefined || !columns) {
    return [];
  }

  const [cx, cy] = columns;
  if (Math.max(cx, cy) >= d) {
    return [];
  }

  // Marginal of the Gaussian on the two columns: sub-block of the covariance matrix
  const sub: [[number, number], [number, number]] = [
    [cov[cx * d + cx], cov[cx * d + cy]],
    [cov[cy * d + cx], cov[cy * d + cy]],
  ];
  return hint.nsigma.map((k) => ({
    ...getEllipsePoints([mean[cx], mean[cy]], sub, scale, k),
    ...getLineStyle(hint),
    head: false,
  }));
}

function buildCurve(
  overlay: ResolvedOverlay,
  hint: CurveOverlay,
  getValues: ValueGetter,
  index: number | undefined,
  axes: AxisDims,
): OverlayLine | undefined {
  const { curve } = overlay.inputs;
  const values = curve && getValues(overlay, curve);
  const columns = getColumns(overlay, axes);
  if (!curve || !values || !columns || (hint.trail && index === undefined)) {
    return undefined;
  }

  const [cx, cy] = columns;
  const cols = getSlicedDims(curve).at(-1) ?? values.length;
  if (Math.max(cx, cy) >= cols) {
    return undefined;
  }

  if (!hint.trail || index === undefined) {
    return {
      x: column(values, cols, cx),
      y: column(values, cols, cy),
      ...getLineStyle(hint),
      head: false,
    };
  }

  // Trail: whole dataset, one row per index of the linked dimension (first or second), up to
  // the current index
  const steps = getDims(curve.dataset)[curve.linkedDim ?? 0];
  const isTransposed = curve.linkedDim === 1; // (c, G) rather than (G, c)
  const rows = Math.min(index + 1, steps);
  const trailValues = values;
  function get(row: number, col: number): number {
    return isTransposed
      ? trailValues[col * steps + row]
      : trailValues[row * cols + col];
  }

  return {
    x: Array.from({ length: rows }, (_, row) => get(row, cx)),
    y: Array.from({ length: rows }, (_, row) => get(row, cy)),
    ...getLineStyle(hint),
    head: true,
  };
}

/**
 * Shapes of the overlays at a linked index, in the base dataset's data coordinates, given the
 * dimensions of the base dataset shown along the x and y axes.
 * Overlays whose values are not all available (yet) are skipped.
 */
export function buildOverlayShapes(
  overlays: ResolvedOverlay[],
  getValues: ValueGetter,
  index: number | undefined,
  axes: AxisDims,
): OverlayShapes {
  const shapes: OverlayShapes = { points: [], lines: [], texts: [] };

  for (const overlay of overlays) {
    const { hint } = overlay;
    if (isReference(hint)) {
      continue; // line views only
    }
    if (hint.kind === 'points') {
      const points = buildPoints(overlay, hint, getValues, axes);
      if (points) {
        shapes.points.push(points);
        shapes.texts.push(...getInlineLabel(hint, points, points.fill));
      }
    } else if (hint.kind === 'text') {
      const text = buildText(overlay, hint, axes);
      shapes.texts.push(...(text ? [text] : []));
    } else {
      const lines =
        hint.kind === 'ellipse'
          ? buildEllipses(overlay, hint, getValues, axes)
          : [buildCurve(overlay, hint, getValues, index, axes)].filter(
              (line) => line !== undefined,
            );
      shapes.lines.push(...lines);
      if (lines.length > 0) {
        shapes.texts.push(...getInlineLabel(hint, lines[0], lines[0].stroke));
      }
    }
  }

  return shapes;
}

/**
 * Position at which a heatmap draws a sample of an axis: a heatmap draws each of N evenly spaced
 * axis values as the start of its pixel, so a sample at value `v` sits at the centre of its pixel,
 * half a pixel further; with non-uniform values (pixel centres), N + 1 values (bin edges) or no
 * values (indices), see below. Overlay coordinates
 * are sample positions, so they are drawn where the samples are (as on 3D surfaces, whose
 * vertices are the samples).
 */
export function getPixelCentreShift(
  axisValues: NumArray | undefined,
  pixelCount: number,
): (value: number) => number {
  if (!axisValues) {
    return (value) => value + 0.5; // pixel i spans [i, i + 1]
  }
  if (
    axisValues.length > pixelCount ||
    pixelCount < 2 ||
    isNonUniformAxis(axisValues, pixelCount)
  ) {
    return (value) => value; // bin edges or pixel centres: coordinates are used as is
  }

  const step = axisValues[1] - axisValues[0];
  return (value) => value + step / 2;
}

/* Shapes moved to where a heatmap draws the samples of its axes (cf. `getPixelCentreShift`) */
export function toPixelCentres(
  shapes: OverlayShapes,
  shiftX: (x: number) => number,
  shiftY: (y: number) => number,
): OverlayShapes {
  return {
    points: shapes.points.map((p) => ({
      ...p,
      x: p.x.map(shiftX),
      y: p.y.map(shiftY),
    })),
    lines: shapes.lines.map((l) => ({
      ...l,
      x: l.x.map(shiftX),
      y: l.y.map(shiftY),
    })),
    texts: shapes.texts.map((t) => ({ ...t, x: shiftX(t.x), y: shiftY(t.y) })),
  };
}
