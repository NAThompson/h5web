import { type DimensionMapping } from '@h5web/lib';
import {
  type ArrayShape,
  type Dataset,
  type ProvidedEntity,
} from '@h5web/shared/hdf5-models';
import {
  keepPreviousData,
  useQueries,
  useQuery,
  useSuspenseQuery,
} from '@tanstack/react-query';
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useDataContext } from '../../providers/DataProvider';
import { type ValueQueryParams } from '../../providers/models';
import { createGeometryContext } from '../core/geometry/utils';
import { type VolumeConfig } from '../core/volume/config';
import { useSlicingProps } from '../slicing';
import type LinkedDimMapper from './LinkedDimMapper';
import { type ViewHint } from './models';
import {
  type AxisDims,
  buildOverlayShapes,
  getIndexFromSelection,
  getInputRequest,
  getOverlayRequests,
  getRequestKey,
  type OverlayShapes,
  type ResolvedOverlays,
  resolveOverlays,
  toNumbers,
} from './overlays';
import { viewHintQuery } from './utils';

/* `H5WEB_view` hint of a dataset or NXdata group (already in cache once the entity is resolved) */
export function useViewHint(
  entity: ProvidedEntity,
  signal?: ProvidedEntity,
): ViewHint {
  const dataContext = useDataContext();
  return useSuspenseQuery(viewHintQuery(entity, dataContext, signal)).data;
}

/* Iso levels suggested by a hint replace the current ones when the volume is opened (they
 * depend on the dataset); the user may then change them freely */
export function useSuggestedIsoLevels(
  hint: ViewHint,
  config: Pick<VolumeConfig, 'isoLevels' | 'addIsoLevel' | 'removeIsoLevel'>,
): void {
  const isApplied = useRef(false);
  const initial = useRef({ levels: hint.isoLevels, config });

  useEffect(() => {
    const { levels, config: initialConfig } = initial.current;
    if (!levels || isApplied.current) {
      return;
    }

    isApplied.current = true;
    for (const { id } of initialConfig.isoLevels) {
      initialConfig.removeIsoLevel(id);
    }
    for (const value of levels) {
      initialConfig.addIsoLevel(value);
    }
  }, []);
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
    queryKey: [dataContext.filepath, 'overlays', base.path],
    queryFn: async () =>
      resolveOverlays(hint, base, createGeometryContext(dataContext)),
    enabled: hint.overlays.length > 0 || hint.notes.length > 0,
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
  const { queries } = useDataContext();
  const requests = getOverlayRequests(resolved, index);

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

export interface LinkedOverlays {
  shapes: OverlayShapes | undefined;
  notes: string[];
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

  // Extra slider: prefetch overlays of upcoming indices during playback, as slicing does
  const { slicingProps } = useSlicingProps(
    (selection) =>
      getOverlayRequests(
        resolved,
        selection === undefined ? undefined : Number(selection),
      ),
    [extraIndex],
  );

  return {
    shapes,
    notes,
    getSliceRequests: (selection) =>
      baseDim === undefined
        ? []
        : getOverlayRequests(
            resolved,
            getIndexFromSelection(selection, baseDim),
          ),
    extraSlider:
      link && baseDim === undefined
        ? { link, index: extraIndex, onChange: setExtraIndex, slicingProps }
        : undefined,
  };
}
