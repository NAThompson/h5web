import {
  hasArrayShape,
  hasNumericType,
  hasScalarShape,
  isDataset,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type Dataset,
  type NumericType,
  type ProvidedEntity,
  type ScalarShape,
} from '@h5web/shared/hdf5-models';

import { type ValueQueryParams } from '../../providers/models';
import {
  type GeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import {
  type CurveOverlay,
  type EllipseOverlay,
  type OverlayHint,
  type PointsOverlay,
  type ViewHint,
} from './models';

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
        ...(hint.color
          ? [{ role: 'color', path: hint.color, rank: 1, required: false }]
          : []),
        ...(hint.z
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
): number | undefined {
  if (!link) {
    return undefined;
  }

  const dim = scales?.findIndex((paths) => paths.includes(link.scalePath));
  if (dim !== undefined && dim >= 0) {
    return dim;
  }

  const hasScales = scales?.some((paths) => paths.length > 0) ?? false;
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

  const baseDim = baseScales?.findIndex((paths) => paths.includes(scalePath));
  return {
    scalePath,
    label: (await ctx.getStrAttr(entity, 'NAME')) || entity.name,
    length: getDims(entity)[0],
    baseDim: baseDim !== undefined && baseDim >= 0 ? baseDim : undefined,
  };
}

async function getScales(
  dataset: OverlayDataset,
  ctx: GeometryContext,
): Promise<string[][] | null> {
  return hasArrayShape(dataset)
    ? ((await ctx.getDimensionScales(dataset)) ?? null) // cached by the query client
    : null;
}

interface FoundRole extends Role {
  entity: ProvidedEntity | undefined;
}

interface FoundOverlay {
  overlay: OverlayHint;
  label: string;
  roles: FoundRole[];
}

/* Link: declared scale, else a scale shared by an overlay's dataset and the base dataset,
 * else the scale of the first dimension of a dataset that needs slicing (e.g. `generation`) */
async function findLink(
  hint: ViewHint,
  anchor: string,
  found: FoundOverlay[],
  baseScales: string[][] | null,
  ctx: GeometryContext,
): Promise<Link | undefined> {
  if (hint.sliceBy) {
    const entity = await resolveCoordinate(anchor, hint.sliceBy, ctx);
    return entity && getLink(entity.path, baseScales, ctx);
  }

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
    .find((path) => baseScales?.some((paths) => paths.includes(path)));
  const leading = datasets
    .map(({ dataset, rank }, i) =>
      getDims(dataset).length === rank + 1 ? allScales[i]?.[0]?.[0] : undefined,
    )
    .find((path) => path !== undefined);

  const scalePath = shared ?? leading;
  return scalePath ? getLink(scalePath, baseScales, ctx) : undefined;
}

/* Check the datasets of an overlay once sliced at the linked index: inputs, or why not */
async function checkOverlay(
  { overlay, label, roles }: FoundOverlay,
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
    const linkedDim = findLinkedDim(dims, await getScales(entity, ctx), link); // eslint-disable-line no-await-in-loop -- cached
    const isLinked = linkedDim !== undefined && dims.length === rank + 1;
    const fitsWhole =
      dims.length === rank ||
      (rank === 0 && dims.length === 1 && dims[0] === 1);

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

  return { hint: overlay, label, inputs };
}

/**
 * Resolve the overlays of a hint: find their datasets (paths resolved like CF `coordinates`),
 * the dimension that links them to the base dataset, and check their shapes. Overlays that
 * can't be drawn are left out, with a note saying why; never throws on data errors.
 */
export async function resolveOverlays(
  hint: ViewHint,
  base: Dataset<ArrayShape>,
  ctx: GeometryContext,
): Promise<ResolvedOverlays> {
  const notes = [...hint.notes];
  if (hint.overlays.length === 0) {
    return { overlays: [], notes };
  }

  const anchor = hint.anchor ?? base.path;
  const baseScales = (await ctx.getDimensionScales(base)) ?? null;

  const found = await Promise.all(
    hint.overlays.map(async (overlay, index) => ({
      overlay,
      label: `overlay ${index + 1} (${overlay.kind})`,
      roles: await Promise.all(
        getRoles(overlay).map(async (role) => ({
          ...role,
          entity: await resolveCoordinate(anchor, role.path, ctx),
        })),
      ),
    })),
  );

  const link = await findLink(hint, anchor, found, baseScales, ctx);
  if (hint.sliceBy && !link) {
    notes.push(`"sliceBy" dimension scale "${hint.sliceBy}" not found`);
  }

  const overlays: ResolvedOverlay[] = [];
  for (const item of found) {
    const result = await checkOverlay(item, link, ctx, notes); // eslint-disable-line no-await-in-loop -- keep notes in order
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
  stroke: string;
  size: number;
}

export interface OverlayLine {
  x: number[];
  y: number[];
  stroke: string;
  head: boolean; // marker at the last point (e.g. current position of a trail)
}

export interface OverlayShapes {
  points: OverlayPoints[];
  lines: OverlayLine[];
}

type ValueGetter = (
  overlay: ResolvedOverlay,
  input: OverlayInput,
) => number[] | undefined;

/* Columns used as x, y and (optionally) z */
function getColumns(
  hint: OverlayHint,
  swap: boolean,
): [number, number, number | undefined] {
  const [cx, cy, cz] = hint.columns ?? [0, 1];
  return swap ? [cy, cx, cz] : [cx, cy, cz];
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
  swap: boolean,
): OverlayPoints | undefined {
  const { points, color, z } = overlay.inputs;
  const values = points && getValues(overlay, points);
  if (!points || !values) {
    return undefined;
  }

  const [cx, cy, cz] = getColumns(hint, swap);
  const cols = getDims(points.dataset).at(-1) ?? 0;
  if (Math.max(cx, cy, cz ?? 0) >= cols) {
    return undefined;
  }

  // Heights: from a dataset, a third column, or else on the surface
  const zColumn = cz ?? (cols === 3 && !hint.columns ? 2 : undefined);
  const zValues = z
    ? getValues(overlay, z)
    : zColumn === undefined
      ? undefined
      : column(values, cols, zColumn);

  return {
    x: column(values, cols, cx),
    y: column(values, cols, cy),
    z: zValues,
    values: color && getValues(overlay, color),
    fill: hint.fill ?? 'white',
    stroke: hint.stroke ?? '#202020',
    size: hint.size ?? 5,
  };
}

function buildEllipses(
  overlay: ResolvedOverlay,
  hint: EllipseOverlay,
  getValues: ValueGetter,
  swap: boolean,
): OverlayLine[] {
  const { mean: meanInput, cov: covInput, scale: scaleInput } = overlay.inputs;
  const mean = meanInput && getValues(overlay, meanInput);
  const cov = covInput && getValues(overlay, covInput);
  const scale = scaleInput ? getValues(overlay, scaleInput)?.[0] : 1;
  const [cx, cy] = getColumns(hint, swap);
  const d = mean?.length ?? 0;
  if (!mean || !cov || scale === undefined || Math.max(cx, cy) >= d) {
    return [];
  }

  // Marginal of the Gaussian on the two columns: sub-block of the covariance matrix
  const sub: [[number, number], [number, number]] = [
    [cov[cx * d + cx], cov[cx * d + cy]],
    [cov[cy * d + cx], cov[cy * d + cy]],
  ];
  return hint.nsigma.map((k) => ({
    ...getEllipsePoints([mean[cx], mean[cy]], sub, scale, k),
    stroke: hint.stroke ?? 'white',
    head: false,
  }));
}

function buildCurve(
  overlay: ResolvedOverlay,
  hint: CurveOverlay,
  getValues: ValueGetter,
  index: number | undefined,
  swap: boolean,
): OverlayLine | undefined {
  const { curve } = overlay.inputs;
  const values = curve && getValues(overlay, curve);
  const [cx, cy] = getColumns(hint, swap);
  const cols = curve ? (getDims(curve.dataset).at(-1) ?? 0) : 0;
  if (
    !values ||
    Math.max(cx, cy) >= cols ||
    (hint.trail && index === undefined)
  ) {
    return undefined;
  }

  // Trail: rows up to the linked index
  const rows =
    hint.trail && index !== undefined
      ? Math.min(index + 1, Math.floor(values.length / cols))
      : undefined;

  return {
    x: column(values, cols, cx, rows),
    y: column(values, cols, cy, rows),
    stroke: hint.stroke ?? 'white',
    head: hint.trail,
  };
}

/**
 * Shapes of the overlays at a linked index, in the base dataset's data coordinates. `swap`:
 * the base dataset is shown transposed, so first and second columns swap axes.
 * Overlays whose values are not all available (yet) are skipped.
 */
export function buildOverlayShapes(
  overlays: ResolvedOverlay[],
  getValues: ValueGetter,
  index: number | undefined,
  swap = false,
): OverlayShapes {
  const shapes: OverlayShapes = { points: [], lines: [] };

  for (const overlay of overlays) {
    const { hint } = overlay;
    if (hint.kind === 'points') {
      const points = buildPoints(overlay, hint, getValues, swap);
      shapes.points.push(...(points ? [points] : []));
    } else if (hint.kind === 'ellipse') {
      shapes.lines.push(...buildEllipses(overlay, hint, getValues, swap));
    } else {
      const line = buildCurve(overlay, hint, getValues, index, swap);
      shapes.lines.push(...(line ? [line] : []));
    }
  }

  return shapes;
}
