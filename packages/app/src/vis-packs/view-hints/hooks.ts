import { type DimensionMapping, type VisScaleType } from '@h5web/lib';
import {
  hasArrayShape,
  hasNumericLikeType,
  isDataset,
} from '@h5web/shared/guards';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericLikeType,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import { type ColorScaleType, ScaleType } from '@h5web/shared/vis-models';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { type ComponentProps, useMemo, useRef, useState } from 'react';

import {
  type DataContextValue,
  useDataContext,
} from '../../providers/DataProvider';
import { type ValueQueryParams } from '../../providers/models';
import { isValueInCache } from '../../utils';
import {
  createGeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import { useDimHints } from '../dimscales/hooks';
import { useSlicingProps } from '../slicing';
import { formatBytes, getValueSize, MAX_AUTO_FETCH_SIZE } from '../utils';
import { toNumbers } from './attrs';
import { getContourOfSlicing } from './contours';
import type LinkedDimMapper from './LinkedDimMapper';
import { EMPTY_HINT, type ViewHint } from './models';
import {
  type AxisDims,
  buildOverlayShapes,
  createOverlayContext,
  getIndexFromSelection,
  getInputRequest,
  getMissingAxisNotes,
  getOverlayRequests,
  getRequestKey,
  type OverlayShapes,
  type ResolvedOverlays,
  resolveOverlays,
} from './overlays';
import { getNotesIn3D, viewHintQuery } from './utils';

/* `H5WEB_*` view hint of a dataset or NXdata group (usually in cache once the entity is resolved).
 * Never suspends nor throws: no hint until fetched, or if it can't be fetched (with a note). */
export function useViewHint(
  entity: ProvidedEntity,
  signal?: ProvidedEntity,
): ViewHint {
  const dataContext = useDataContext();
  const { data, error } = useQuery(viewHintQuery(entity, dataContext, signal));
  if (error) {
    return {
      ...EMPTY_HINT,
      notes: [`H5WEB_* attributes could not be fetched: ${error.message}`],
    };
  }
  return data ?? EMPTY_HINT;
}

/* Overlays are fetched without confirmation (cf. `LargeValueGuard`): values above the limit
 * are skipped, unless already in cache */
export function isAffordable(
  dataContext: DataContextValue,
  { dataset, selection }: ValueQueryParams,
): boolean {
  return (
    getValueSize(dataset, selection) <= MAX_AUTO_FETCH_SIZE ||
    isValueInCache(dataContext, dataset, selection)
  );
}

/* Same array as on previous render if its elements haven't changed */
function useStableArray<T>(arr: T[]): T[] {
  const ref = useRef(arr);
  const prev = ref.current;
  if (
    prev.length !== arr.length ||
    prev.some((val, i) => !Object.is(val, arr[i]))
  ) {
    ref.current = arr;
  }
  return ref.current;
}

/* Overlays of a hint, resolved in the background: `undefined` until then, so they never hold up
 * nor break the base dataset's vis */
export function useResolvedOverlays(
  base: Dataset<ArrayShape>,
  hint: ViewHint,
): ResolvedOverlays | undefined {
  const dataContext = useDataContext();
  const { data, error } = useQuery({
    queryKey: [dataContext.filepath, 'overlays', base.path, hint.anchor],
    queryFn: async () =>
      resolveOverlays(hint, base, createOverlayContext(dataContext)),
    enabled: hint.overlayPaths.length > 0 || hint.notes.length > 0,
  });

  if (error) {
    return {
      overlays: [],
      notes: [`overlays could not be loaded: ${error.message}`],
    };
  }
  return data;
}

/* Shapes of the overlays at a linked index, and notes about what can't be drawn. While the
 * values of a new index load, shapes of the previous index are kept (smooth playback). */
export function useOverlayShapes(
  resolved: ResolvedOverlays | undefined,
  index: number | undefined,
  axes: AxisDims,
): { shapes: OverlayShapes | undefined; notes: string[] } {
  const dataContext = useDataContext();
  const { queries } = dataContext;
  const allRequests = getOverlayRequests(resolved, index);
  const requests = allRequests.filter((req) => isAffordable(dataContext, req));
  const tooLarge = allRequests.filter((req) => !requests.includes(req));

  const results = useQueries({
    queries: requests.map(({ dataset, selection }) => ({
      ...queries.value(dataset, selection),
      placeholderData: keepPreviousData,
    })),
  });

  const data = useStableArray(results.map((result) => result.data));
  const shapes = useMemo(() => {
    if (!resolved) {
      return undefined;
    }

    const values = new Map(
      requests.map((request, i) => [getRequestKey(request), data[i]]),
    );
    return buildOverlayShapes(
      resolved.overlays,
      (overlay, input) => {
        const request = getInputRequest(overlay, input, index);
        return request && toNumbers(values.get(getRequestKey(request)));
      },
      index,
      axes,
    );
  }, [resolved, index, axes.x, axes.y, data]); // eslint-disable-line react-hooks/exhaustive-deps -- `requests` follow from `resolved` and `index`

  const notes = [...(resolved?.notes ?? [])];
  for (const { dataset, selection } of tooLarge) {
    notes.push(
      `"${dataset.name}" is too large to fetch for an overlay (${formatBytes(getValueSize(dataset, selection))})`,
    );
  }
  results.forEach(({ error }, i) => {
    if (error) {
      notes.push(`"${requests[i].dataset.name}" could not be loaded`);
    }
  });

  const hasLinkedInputs = resolved?.overlays.some((overlay) =>
    Object.values(overlay.inputs).some(
      (input) => input?.linkedDim !== undefined,
    ),
  );
  if (resolved?.link && index === undefined && hasLinkedInputs) {
    notes.push(`slice along "${resolved.link.label}" to see overlays`);
  }

  return { shapes, notes };
}

export interface LegendItem {
  label: string;
  color: string;
  kind: 'points' | 'line';
  dash: boolean;
}

export interface LinkedOverlays {
  shapes: OverlayShapes | undefined;
  notes: string[];
  legend: LegendItem[]; // labelled overlays, unless the hint hides the legend
  notesIn3D: string[]; // overlay features not drawn on 3D surfaces
  // values of the overlays to fetch with a slice of the base dataset (when the link is one of its dimensions)
  getSliceRequests: (selection: string | undefined) => ValueQueryParams[];
  // extra slider for a linked dimension the base dataset doesn't have
  extraSlider?: Omit<ComponentProps<typeof LinkedDimMapper>, 'children'>;
}

/* Overlays declared by a hint, sliced along the dimension that links them to the base dataset:
 * one of its dimensions (sliced by its own slider), or an extra slider */
export function useLinkedOverlays(
  base: Dataset<ArrayShape>,
  hint: ViewHint,
  dimMapping: DimensionMapping,
): LinkedOverlays {
  const dataContext = useDataContext();
  const resolved = useResolvedOverlays(base, hint);
  const link = resolved?.link;
  const baseDim = link?.baseDim;

  const [extraIndex, setExtraIndex] = useState(0);
  const baseIndex = baseDim === undefined ? undefined : dimMapping[baseDim];
  const index = !link
    ? undefined
    : baseDim === undefined
      ? Math.min(extraIndex, link.length - 1)
      : typeof baseIndex === 'number'
        ? baseIndex
        : undefined;

  const axes = { x: dimMapping.indexOf('x'), y: dimMapping.indexOf('y') };
  const { shapes, notes } = useOverlayShapes(resolved, index, axes);
  const dimHints = useDimHints(base);

  // Extra slider: prefetch overlays of upcoming indices during playback, as slicing does
  const { slicingProps } = useSlicingProps(() => [], [extraIndex], {
    getExtraRequests: (selection) =>
      getOverlayRequests(
        resolved,
        selection === undefined ? undefined : Number(selection),
      ).filter((req) => isAffordable(dataContext, req)),
  });

  const legend: LegendItem[] =
    hint.legend === false
      ? []
      : (resolved?.overlays ?? []).flatMap(({ hint: overlay }) =>
          overlay.label &&
          overlay.labelMode !== 'inline' &&
          overlay.kind !== 'text'
            ? [
                {
                  label: overlay.label,
                  color: overlay.color ?? 'white',
                  kind: overlay.kind === 'points' ? 'points' : 'line',
                  dash: overlay.dash ?? false,
                },
              ]
            : [],
        );

  return {
    shapes,
    notes: [
      ...notes,
      ...getMissingAxisNotes(resolved?.overlays ?? [], axes, dimHints),
    ],
    legend,
    notesIn3D: getNotesIn3D(
      resolved?.overlays.map(({ hint: overlay }) => overlay) ?? [],
    ),
    getSliceRequests: (selection) =>
      baseDim === undefined
        ? []
        : getOverlayRequests(
            resolved,
            getIndexFromSelection(selection, baseDim),
          ).filter((req) => isAffordable(dataContext, req)),
    extraSlider:
      link && baseDim === undefined
        ? { link, index: extraIndex, onChange: setExtraIndex, slicingProps }
        : undefined,
  };
}

/* Scale with the width of its linear band around 0 when symlog (`H5WEB_symlog_threshold`) */
export function useSymlogThreshold(
  scaleType: ColorScaleType,
  threshold: number | undefined,
): VisScaleType {
  return useMemo(
    () =>
      scaleType === ScaleType.SymLog && threshold
        ? [ScaleType.SymLog, threshold]
        : scaleType,
    [scaleType, threshold],
  );
}

export interface ContourSource {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  value: ArrayValue<NumericLikeType> | undefined; // `undefined` while loading
  mapping: DimensionMapping; // of the dataset's dimensions
}

function getContourOfNote(
  path: string,
  status: Record<
    'isFound' | 'isDataset' | 'isOnGrid' | 'isTooLarge' | 'isError',
    boolean
  >,
): string | undefined {
  const problem = !status.isDataset
    ? status.isFound
      ? 'is not a numeric dataset'
      : 'was not found'
    : !status.isOnGrid
      ? 'is not on the same grid'
      : status.isTooLarge
        ? 'is too large to fetch'
        : status.isError
          ? 'could not be loaded'
          : undefined;
  return problem && `"H5WEB_contour_of" "${path}" ${problem}: not contoured`;
}

/* Dataset contoured instead of the base (`H5WEB_contour_of`), on the same grid, sliced along with
 * the base; `undefined` without one; `null` while resolving, or if it can't be used (with a note):
 * no contours then, rather than contours of the base */
export function useContourSource(
  base: Dataset<ArrayShape>,
  hint: ViewHint,
  dimMapping: DimensionMapping,
): { source?: ContourSource | null; notes: string[] } {
  const dataContext = useDataContext();
  const { contourOf, contourOfAnchor = base.path } = hint;

  const { data: entity, isPending } = useQuery({
    queryKey: [dataContext.filepath, 'contourOf', contourOfAnchor, contourOf],
    queryFn: async () =>
      (await resolveCoordinate(
        contourOfAnchor,
        contourOf ?? '',
        createGeometryContext(dataContext),
      )) ?? null,
    enabled: !!contourOf,
  });
  const dataset =
    entity &&
    isDataset(entity) &&
    hasArrayShape(entity) &&
    hasNumericLikeType(entity)
      ? entity
      : undefined;

  const { dims } = base.shape;
  const slicing = useMemo(
    () => dataset && getContourOfSlicing(dims, dataset.shape.dims, dimMapping),
    [dataset, dims, dimMapping],
  );
  const request = dataset &&
    slicing && { dataset, selection: slicing.selection };
  const isTooLarge = !!request && !isAffordable(dataContext, request);
  const requests = request && !isTooLarge ? [request] : [];
  const results = useQueries({
    queries: requests.map((req) => ({
      ...dataContext.queries.value(req.dataset, req.selection),
      placeholderData: keepPreviousData,
    })),
  });

  if (!contourOf) {
    return { notes: [] };
  }
  if (isPending) {
    return { source: null, notes: [] };
  }
  const note = getContourOfNote(contourOf, {
    isFound: !!entity,
    isDataset: !!dataset,
    isOnGrid: !!slicing,
    isTooLarge,
    isError: !!results.at(0)?.error,
  });
  if (note || !dataset || !slicing) {
    return { source: null, notes: note ? [note] : [] };
  }

  return {
    source: {
      dataset,
      value: results.at(0)?.data as ArrayValue<NumericLikeType> | undefined,
      mapping: slicing.mapping,
    },
    notes: [],
  };
}
