import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { getValidDomainForScale } from '@h5web/shared/vis-utils';
import { type NdArray } from 'ndarray';
import { use, useMemo } from 'react';

import { useDomain } from '../../hooks';
import { MIN_WORKER_VALUES, prepareVolume } from './client';

const NO_VALUES: number[] = [];

/* Domain of a volume, like `useDomain`, but computed off the main thread for large
 * `Float32Array` volumes (suspends meanwhile), which also prepares their half floats if they
 * are too large to be uploaded as 32-bit floats (cf. `VolumeMesh`). */
export function useVolumeDomain(
  dataArray: NdArray<NumArray>,
  opts: { scaleType?: ScaleType; ignoreValue?: IgnoreValue } = {},
): Domain | undefined {
  const { scaleType = ScaleType.Linear, ignoreValue } = opts;
  const { data } = dataArray;

  const usesWorkers =
    data instanceof Float32Array &&
    data.length >= MIN_WORKER_VALUES &&
    !ignoreValue; // `ignoreValue` is a function, which can't be sent to workers

  const prepared = usesWorkers ? use(prepareVolume(data)) : undefined;
  const mainThreadDomain = useDomain(usesWorkers ? NO_VALUES : dataArray, {
    scaleType,
    ignoreValue,
  });

  return useMemo(
    () =>
      prepared
        ? getValidDomainForScale(prepared.bounds, scaleType)
        : mainThreadDomain,
    [prepared, scaleType, mainThreadDomain],
  );
}
