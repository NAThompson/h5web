import { type DimensionMapping, type IgnoreValue } from '@h5web/lib';
import { hasArrayShape, hasNumericType, isDataset } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import ndarray, { type NdArray } from 'ndarray';
import { useMemo } from 'react';

import {
  type DataContextValue,
  useDataContext,
} from '../../providers/DataProvider';
import { resolveCoordinate } from '../core/geometry/utils';
import { toNumArray } from '../core/utils';
import { ignoreValueQuery, packingQuery } from '../netcdf/hooks';
import { type Packing, unpackNumArray } from '../netcdf/utils';
import { parseSeriesStyle, toUnicodeScripts } from './attrs';
import { isAffordable, useStableArray } from './hooks';
import { type SeriesStyle, type ViewHint } from './models';
import {
  createOverlayContext,
  type OverlayContext,
  withoutPhonyScales,
} from './overlays';

type SeriesDataset = Dataset<ArrayShape, NumericType>;

export interface ResolvedSeries {
  dataset: SeriesDataset;
  name: string; // path as written, for notes
  style: SeriesStyle;
  // Dimension of the base dataset along each dimension of the series (`x`: the x axis, whichever
  // it is, for a 1D series without dimension scales)
  baseDims: (number | 'x')[];
  packing?: Packing;
  ignoreValue?: IgnoreValue;
}

export interface SeriesCurve extends SeriesStyle {
  label: string;
  array: NdArray<NumArray>;
  ignoreValue?: IgnoreValue;
}

/* Base dimension of each dimension of a series: the one with the same dimension scale, else the
 * same dimension of a dataset of the same shape; a 1D series without scales goes along x */
function matchDims(
  dims: number[],
  scales: string[][] | null,
  baseDims: number[],
  baseScales: string[][] | null,
): ResolvedSeries['baseDims'] | undefined {
  const hasScales = scales?.some((paths) => paths.length > 0) ?? false;
  if (!hasScales && dims.length === 1 && baseDims.length > 1) {
    return ['x'];
  }

  const matched = dims.map((size, j) => {
    const shared = baseScales?.findIndex((paths) =>
      paths.some((path) => scales?.[j]?.includes(path)),
    );
    if (shared !== undefined && shared >= 0) {
      return baseDims[shared] === size ? shared : undefined;
    }
    return dims.length === baseDims.length && baseDims[j] === size
      ? j
      : undefined;
  });
  return matched.every((dim) => dim !== undefined) ? matched : undefined;
}

async function resolveOne(
  anchor: string,
  name: string,
  base: Dataset<ArrayShape>,
  baseScales: string[][] | null,
  ctx: OverlayContext,
  dataContext: DataContextValue,
  notes: string[],
): Promise<ResolvedSeries | string> {
  let entity;
  try {
    entity = await resolveCoordinate(anchor, name, ctx);
  } catch {
    return 'could not be fetched';
  }
  if (!entity) {
    return 'not found';
  }
  if (!isDataset(entity) || !hasArrayShape(entity) || !hasNumericType(entity)) {
    return 'not a numeric array';
  }

  const values = await ctx.getAttrValues(entity);
  const scales = await withoutPhonyScales(
    await ctx.getDimensionScales(entity),
    ctx,
  );
  const baseDims = matchDims(
    entity.shape.dims,
    scales,
    base.shape.dims,
    baseScales,
  );
  if (!baseDims) {
    return `shape [${entity.shape.dims.join(', ')}] doesn't match "${base.name}"`;
  }

  const { queryClient } = dataContext;
  const [packing, ignoreValue] = await Promise.all([
    queryClient.query(packingQuery(entity, dataContext)),
    queryClient.query(ignoreValueQuery(entity, dataContext)),
  ]);
  return {
    dataset: entity,
    name,
    style: parseSeriesStyle(entity, values ?? {}, notes, `series "${name}": `),
    baseDims,
    packing: packing ?? undefined,
    ignoreValue: ignoreValue ?? undefined,
  };
}

/* Series of a line hint (`H5WEB_series`), resolved like overlays; those that can't be drawn are
 * left out with a note */
export async function resolveSeries(
  hint: ViewHint,
  base: Dataset<ArrayShape>,
  dataContext: DataContextValue,
): Promise<{ series: ResolvedSeries[]; notes: string[] }> {
  const ctx = createOverlayContext(dataContext);
  const anchor = hint.seriesAnchor ?? base.path;
  const baseScales = await withoutPhonyScales(
    await ctx.getDimensionScales(base),
    ctx,
  );

  const notes: string[] = [];
  const results = await Promise.all(
    (hint.seriesPaths ?? []).map(async (name) => {
      const seriesNotes: string[] = [];
      const result = await resolveOne(
        anchor,
        name,
        base,
        baseScales,
        ctx,
        dataContext,
        seriesNotes,
      );
      return { name, result, seriesNotes };
    }),
  );

  const series: ResolvedSeries[] = [];
  for (const { name, result, seriesNotes } of results) {
    notes.push(...seriesNotes);
    if (typeof result === 'string') {
      notes.push(`series "${name}": ${result}`);
    } else {
      series.push(result);
    }
  }
  return { series, notes };
}

/* Selection of a series along the x axis at the base's slicing indices; why not if it can't be
 * drawn (e.g. dimension plotted as several curves) */
export function getSeriesSelection(
  { baseDims, dataset }: ResolvedSeries,
  mapping: DimensionMapping,
  baseDimsSizes: number[],
): { selection: string | undefined } | string {
  const xDim = mapping.indexOf('x');
  const axes = baseDims.map((dim) => (dim === 'x' ? xDim : dim));
  if (axes.some((dim) => mapping[dim] === 'y')) {
    return 'not drawn while plotting all slices along one of its dimensions';
  }
  if (
    !axes.includes(xDim) ||
    (baseDims[0] === 'x' && dataset.shape.dims[0] !== baseDimsSizes[xDim])
  ) {
    return "doesn't span the x axis";
  }

  const selection = axes.map((dim) => (dim === xDim ? ':' : mapping[dim]));
  return {
    selection: selection.every((idx) => idx === ':')
      ? undefined
      : selection.join(','),
  };
}

/* Curves of the series of a line hint at the base's slicing indices: none until resolved and
 * fetched, so that they never hold up the base dataset's line */
export function useLineSeries(
  base: Dataset<ArrayShape>,
  hint: ViewHint,
  mapping: DimensionMapping,
): { curves: SeriesCurve[]; notes: string[] } {
  const dataContext = useDataContext();
  const hasSeries = (hint.seriesPaths?.length ?? 0) > 0;
  const { data: resolved, error } = useQuery({
    queryKey: [dataContext.filepath, 'series', base.path, hint.seriesAnchor],
    queryFn: async () => resolveSeries(hint, base, dataContext),
    enabled: hasSeries,
  });

  const notes = [...(resolved?.notes ?? [])];
  if (error) {
    notes.push(`series could not be loaded: ${error.message}`);
  }

  const drawn = (resolved?.series ?? []).flatMap((series) => {
    const result = getSeriesSelection(series, mapping, base.shape.dims);
    if (typeof result === 'string') {
      notes.push(`series "${series.name}": ${result}`);
      return [];
    }
    const request = { dataset: series.dataset, selection: result.selection };
    if (!isAffordable(dataContext, request)) {
      notes.push(`series "${series.name}": too large to fetch`);
      return [];
    }
    return [{ series, request }];
  });

  const results = useQueries({
    queries: drawn.map(({ request }) => ({
      ...dataContext.queries.value(request.dataset, request.selection),
      placeholderData: keepPreviousData,
    })),
  });
  results.forEach(({ error: valueError }, i) => {
    if (valueError) {
      notes.push(`series "${drawn[i].series.name}" could not be loaded`);
    }
  });

  const values = useStableArray(results.map(({ data }) => data));
  const length = base.shape.dims[mapping.indexOf('x')];
  const curves = useMemo(
    () =>
      drawn.flatMap(({ series }, i) => {
        const value = values[i] as ArrayValue<NumericType> | undefined;
        // Values of another slicing may be shown while loading, not of another x axis
        if (value?.length !== length) {
          return [];
        }
        const { dataset, style, packing, ignoreValue } = series;
        const array = toNumArray(unpackNumArray(value, packing));
        return [
          {
            ...style,
            label: toUnicodeScripts(style.label) ?? dataset.name, // plain text in the legend
            array: ndarray(array),
            ignoreValue,
          },
        ];
      }),
    [resolved, values, length], // eslint-disable-line react-hooks/exhaustive-deps -- `drawn` follows from `resolved`
  );

  return { curves, notes };
}
