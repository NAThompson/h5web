import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useDataContext } from '../../providers/DataProvider';
import {
  createGeometryContext,
  resolveCoordinate,
} from '../core/geometry/utils';
import { getLabels, isLabelsDataset } from '../dimscales/slice-labels';
import { type ViewHint } from './models';

/* Colours of the curves of a multi-plot, cycled in curve order; with labels, curves with the same
 * label share a colour (in order of first appearance) */
export function getPaletteColors(
  palette: readonly string[],
  count: number,
  labels?: string[],
): string[] {
  const groups = new Map<string, number>();
  labels?.forEach((label) => {
    if (!groups.has(label)) {
      groups.set(label, groups.size);
    }
  });
  return Array.from(
    { length: count },
    (_, i) =>
      palette[(labels ? (groups.get(labels[i]) ?? 0) : i) % palette.length],
  );
}

/* Colours of the slices of a multi-plot (`H5WEB_palette`), grouped by the labels of
 * `H5WEB_palette_by` if it is a 1D string dataset along the multi-plotting dimension (else with a
 * note); `undefined` without a palette, or while the labels load */
export function usePaletteColors(
  hint: ViewHint,
  basePath: string,
  multiDim: number | undefined, // multi-plotting dimension
  sliceCount: number | undefined, // its length
): { colors?: string[]; notes: string[] } {
  const dataContext = useDataContext();
  const { palette, paletteBy, paletteByAnchor = basePath } = hint;
  // Labels are along the hinted dimension: not used once another one is multi-plotted
  const usesLabels =
    !!paletteBy && (hint.multiDim === undefined || hint.multiDim === multiDim);

  const { data, isPending, isError } = useQuery({
    queryKey: [
      dataContext.cacheScope,
      'paletteBy',
      paletteByAnchor,
      paletteBy,
      sliceCount,
    ],
    queryFn: async () => {
      const dataset = await resolveCoordinate(
        paletteByAnchor,
        paletteBy ?? '',
        createGeometryContext(dataContext),
      );
      if (!dataset) {
        return { problem: 'was not found' };
      }
      return isLabelsDataset(dataset, sliceCount)
        ? { labels: await getLabels(dataset, dataContext) }
        : { problem: 'is not a 1D string dataset along the curves' };
    },
    enabled: usesLabels && sliceCount !== undefined,
  });

  return useMemo(() => {
    if (!palette || sliceCount === undefined) {
      return { notes: [] };
    }
    if (!usesLabels) {
      return { colors: getPaletteColors(palette, sliceCount), notes: [] };
    }
    if (isPending) {
      return { notes: [] };
    }
    const problem = isError ? 'could not be loaded' : data.problem;
    return problem
      ? {
          colors: getPaletteColors(palette, sliceCount),
          notes: [`"H5WEB_palette_by" "${paletteBy}" ${problem}: ignored`],
        }
      : {
          colors: getPaletteColors(palette, sliceCount, data?.labels),
          notes: [],
        };
  }, [palette, sliceCount, usesLabels, isPending, isError, data, paletteBy]);
}
