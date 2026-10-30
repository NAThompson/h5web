import { type AxisParams, type AxisTicks } from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { hashKey, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { useDataContext } from '../../providers/DataProvider';
import { type DimScale, getDimScales, getUniqueLabels } from './utils';

export interface DimScaleAxes {
  axisLabels: AxisMapping<string>;
  axisValues: AxisMapping<ArrayValue<NumericType>>;
  axisTicks: AxisMapping<AxisTicks>; // from the scales' `H5WEB_ticks`
  axisScales: AxisMapping<AxisScaleHint>; // `H5WEB_axis_scale`, labels of string-valued scales
}

export type AxisScaleHint = Pick<
  AxisParams,
  'scaleType' | 'symlogConstant' | 'tickLabels'
>;

function getQueryKey(cacheScope: string, dataset: Dataset) {
  return [cacheScope, 'dimScales', dataset.path];
}

/* Resolve the HDF5 dimension scales attached to a dataset's dimensions into
 * axis labels and, where a usable scale is attached, the values to plot against.
 * NeXus metadata takes precedence, so this is used by the core vis pack only.
 * Fetching may fail like any value fetch (e.g. network error), so call it
 * within a `VisBoundary` (cf. `DimScalesFetcher`).
 * See https://support.hdfgroup.org/documentation/hdf5/latest/_h5_d_s__u_g.html */
export function useDimScales(dataset: Dataset<ArrayShape>): DimScaleAxes {
  const dataContext = useDataContext();

  const dimScales = useSuspenseQuery({
    queryKey: getQueryKey(dataContext.cacheScope, dataset),
    queryFn: async () => getDimScales(dataset, dataContext),
  }).data;

  return {
    axisLabels: dimScales.map((scale) => scale?.label),
    axisValues: dimScales.map((scale) => scale?.value),
    axisTicks: dimScales.map((scale) => scale?.ticks),
    axisScales: dimScales.map(
      (scale) =>
        scale?.value
          ? scale.scaleType && {
              scaleType: scale.scaleType,
              symlogConstant: scale.symlogConstant,
            }
          : scale?.sliceLabels && { tickLabels: scale.sliceLabels }, // index axis
    ),
  };
}

export interface DimInfo {
  dimHints: AxisMapping<string>; // full labels (with units), e.g. as hints of the dimension mapper
  dimLabels: AxisMapping<string>; // unique short names, for the dimension mapper's buttons and sliders
  dimUnits: AxisMapping<string>; // e.g. to suggest whether to keep the ratio
  sliceLabels: AxisMapping<string[]>; // labels of the indices, for sliders
}

/* Labels and units of the dimensions for the dimension mapper and suggestions, which sit outside
 * the `VisBoundary`: read whatever `useDimScales` has resolved so far, without fetching (and thus
 * without suspending or throwing); empty until then. */
export function useDimInfo(dataset: Dataset): DimInfo {
  const dimScales = useCachedDimScales(dataset);
  return useMemo(
    () => ({
      dimHints: dimScales.map((scale) => scale?.label),
      dimLabels: getUniqueLabels(dimScales.map((scale) => scale?.name)),
      dimUnits: dimScales.map((scale) => scale?.unit),
      sliceLabels: dimScales.map((scale) => scale?.sliceLabels),
    }),
    [dimScales],
  );
}

export function useCachedDimScales(dataset: Dataset): AxisMapping<DimScale> {
  const { cacheScope, queryClient } = useDataContext();
  const queryCache = queryClient.getQueryCache();
  const queryKey = getQueryKey(cacheScope, dataset);
  const queryHash = hashKey(queryKey);

  const dimScales = useSyncExternalStore(
    useCallback(
      (onChange) =>
        queryCache.subscribe((event) => {
          /* Only data changes matter. Other events may be fired while other
           * components render (e.g. when queries are added or observed), when
           * updating this component would not be allowed. */
          if (
            event.query.queryHash === queryHash &&
            (event.type === 'removed' ||
              (event.type === 'updated' && event.action.type === 'success'))
          ) {
            onChange();
          }
        }),
      [queryCache, queryHash],
    ),
    () => queryClient.getQueryData<AxisMapping<DimScale>>(queryKey),
  );

  return dimScales ?? [];
}
