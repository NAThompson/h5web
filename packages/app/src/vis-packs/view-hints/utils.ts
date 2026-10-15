import { hasArrayShape, isDataset, isGroup } from '@h5web/shared/guards';
import {
  type Attribute,
  type AttributeValues,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { queryOptions } from '@tanstack/react-query';

import { type DataContextValue } from '../../providers/DataProvider';
import { isTransportError } from '../../providers/utils';
import { findScalarStrAttr, getAttributeValue } from '../../utils';
import { createGeometryContext } from '../core/geometry/utils';
import { type VisDef } from '../models';
import { hasViewAttrs, parseViewHint } from './attrs';
import { EMPTY_HINT, HintVis, type OverlayHint, type ViewHint } from './models';
import { getDimNames, withoutPhonyScales } from './overlays';

/* `DIMENSION_LABELS` of a dataset; empty if it can't be read (transport errors are thrown) */
async function getDimLabels(
  dataset: ProvidedEntity,
  dataContext: DataContextValue,
  values?: AttributeValues,
): Promise<unknown[]> {
  try {
    const attrs =
      values ??
      (await dataContext.queryClient.query(
        dataContext.queries.attrValues(dataset),
      ));
    const labels: unknown = attrs.DIMENSION_LABELS;
    return Array.isArray(labels) ? (labels as unknown[]) : [];
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }
    return [];
  }
}

const DIM_ATTRS = ['H5WEB_x_dim', 'H5WEB_multi_dim', 'H5WEB_probe_dim'];

/* Hint of a dataset, or of an NXdata group (falling back to its signal's), from their `H5WEB_*`
 * attributes. Data errors give no hint (with a note); transport errors are thrown (cf.
 * `getHintSafely`). */
export async function getViewHint(
  entity: ProvidedEntity,
  dataContext: DataContextValue,
  signal?: ProvidedEntity,
): Promise<ViewHint> {
  const { queryClient, queries } = dataContext;

  // NXdata group: its signal's attributes, overridden attribute by attribute by the group's
  const sources = (
    signal && signal !== entity ? [signal, entity] : [entity]
  ).filter(hasViewAttrs);
  if (sources.length === 0) {
    return isDataset(entity)
      ? getCfHint(entity, dataContext, false)
      : getCfHint(signal, dataContext, true);
  }

  let sourceValues: AttributeValues[];
  try {
    sourceValues = await Promise.all(
      sources.map(async (source) =>
        queryClient.query(queries.attrValues(source)),
      ),
    );
  } catch (error) {
    if (isTransportError(error)) {
      throw error; // transient: not cached, fetched again later
    }
    // e.g. another attribute of the entity can't be decoded: open the entity without hint
    return { ...EMPTY_HINT, notes: ['H5WEB_* attributes could not be read'] };
  }

  const attributes = new Map<string, Attribute>();
  const owners = new Map<string, ProvidedEntity>();
  const values: AttributeValues = {};
  sources.forEach((source, i) => {
    for (const attr of source.attributes) {
      attributes.set(attr.name, attr);
      owners.set(attr.name, source);
      values[attr.name] = sourceValues[i][attr.name];
    }
  });
  const merged = { ...entity, attributes: [...attributes.values()] };

  // Dimensions named by `H5WEB_x_dim`, `_multi_dim`, `_probe_dim`: scale names or dimension labels
  const dataset = isDataset(entity) ? entity : signal;
  let dimNames: string[][] = [];
  if (
    DIM_ATTRS.some((name) => attributes.has(name)) &&
    dataset &&
    isDataset(dataset) &&
    hasArrayShape(dataset)
  ) {
    const ctx = createGeometryContext(dataContext);
    const scales = await withoutPhonyScales(
      await ctx.getDimensionScales(dataset),
      ctx,
    );
    const [scaleNames, labels] = await Promise.all([
      getDimNames(scales, ctx),
      getDimLabels(
        dataset,
        dataContext,
        sourceValues[sources.indexOf(dataset)],
      ),
    ]);
    dimNames = dataset.shape.dims.map((_, i) => {
      const label = labels[i];
      return [
        ...(scaleNames[i] ?? []),
        ...(typeof label === 'string' && label ? [label] : []),
      ];
    });
  }

  // Paths are relative to the object that holds the attribute
  function getAnchor(name: string): string {
    const owner = owners.get(name) ?? entity;
    return isGroup(owner) ? `${owner.path.replace(/\/$/u, '')}/.` : owner.path;
  }
  const parsed = parseViewHint(merged, values, dimNames);
  return {
    ...parsed,
    valueLabel: getValueLabel(values, parsed.title),
    anchor: getAnchor('H5WEB_overlays'),
    sliceByAnchor: getAnchor('H5WEB_slice_by'),
    contourOfAnchor: getAnchor('H5WEB_contour_of'),
  };
}

/* Hint of a dataset without `H5WEB_*` attributes: only the value label from its CF `units` and
 * `long_name` (not a title from `long_name`, which would override e.g. NeXus titles). The long
 * name is left out for signals of NXdata groups, which NeXus already labels by it. None if the
 * attributes can't be read (transport errors are thrown). */
async function getCfHint(
  dataset: ProvidedEntity | undefined,
  dataContext: DataContextValue,
  isNxSignal: boolean,
): Promise<ViewHint> {
  if (!dataset || !isDataset(dataset)) {
    return EMPTY_HINT;
  }
  try {
    const [longName, units] = await Promise.all([
      isNxSignal
        ? undefined
        : getAttributeValue(
            dataset,
            findScalarStrAttr(dataset, 'long_name'),
            dataContext,
          ),
      getAttributeValue(
        dataset,
        findScalarStrAttr(dataset, 'units'),
        dataContext,
      ),
    ]);
    const valueLabel = getValueLabel({ long_name: longName, units }, undefined);
    return valueLabel ? { ...EMPTY_HINT, valueLabel } : EMPTY_HINT;
  } catch (error) {
    if (isTransportError(error)) {
      throw error;
    }
    return EMPTY_HINT;
  }
}

/* Label of the values (colour bar, value axis) from CF `units` and `long_name`; the long name is
 * left out when it is already the title */
export function getValueLabel(
  values: AttributeValues,
  title: string | undefined,
): string | undefined {
  const { long_name: rawName, units: rawUnits } = values;
  const longName = typeof rawName === 'string' && rawName ? rawName : undefined;
  const units = typeof rawUnits === 'string' && rawUnits ? rawUnits : undefined;
  const name = longName === title ? undefined : longName;
  return name && units ? `${name} (${units})` : (name ?? units);
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

/* Note if the visualization asked for by the hint is not available (e.g. volume of a 2D dataset) */
export function getHintVisNotes(
  hint: ViewHint,
  hintVis: VisDef | undefined,
): string[] {
  return hint.vis && !hintVis
    ? [`"H5WEB_vis" "${hint.vis}" is not available for this dataset`]
    : [];
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
      notes: [`H5WEB_* attributes of ${entity.name} could not be fetched`],
    };
  }
}

/* Notes about a hint in a vis that doesn't draw overlays (e.g. line, volume) */
export function getHintNotes(hint: ViewHint): string[] {
  return hint.overlayPaths.length > 0
    ? [...hint.notes, 'overlays are drawn on heatmaps only']
    : hint.notes;
}

/* Note about overlay features not drawn on 3D surfaces, if the overlays use any */
export function getNotesIn3D(overlays: OverlayHint[]): string[] {
  const unsupported = [
    overlays.some(({ kind }) => kind === 'text') && 'text',
    overlays.some(({ dash }) => dash) && 'dashes',
  ].filter((feature) => typeof feature === 'string');

  return unsupported.length > 0
    ? [`not drawn in 3D: ${unsupported.join(', ')}`]
    : [];
}

/* Parts of a label, with `_{...}` and `^{...}` as subscripts and superscripts (e.g. `r_{12} = 0`) */
export function formatLabel(
  label: string,
): { str: string; shift?: 'sub' | 'super' }[] {
  return label
    .split(/([\^_]\{[^}]*\})/u)
    .filter((part) => part.length > 0)
    .map((part) =>
      /^[\^_]\{.*\}$/u.test(part)
        ? {
            str: part.slice(2, -1),
            shift: part.startsWith('_') ? 'sub' : 'super',
          }
        : { str: part },
    );
}
