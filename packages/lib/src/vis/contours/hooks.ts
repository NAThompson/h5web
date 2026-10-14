import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo, useState } from 'react';

import { requestContours } from '../geometry-worker/client';
import { contoursSteps, runSteps } from '../geometry-worker/jobs';
import {
  type ContourResult,
  type LabelOptions,
} from '../geometry-worker/models';
import { toFloatValues } from '../geometry-worker/utils';
import { type VisScaleType } from '../models';

/* Below this many cell visits (cells × levels), contours are computed synchronously */
const SYNC_BUDGET = 2 ** 20;

export interface ContoursState {
  contours: ContourResult[] | undefined;
  progress: number | undefined; // defined while contours are being computed in the worker
}

export function getLabelOptions(shape: number[]): LabelOptions {
  const size = Math.max(...shape);
  return { minLength: size / 12, spacing: size / 2.5, maxCount: 8 };
}

export function useContours(
  dataArray: NdArray<NumArray>,
  levels: number[],
  opts: {
    scaleType?: VisScaleType;
    ignoreValue?: IgnoreValue;
    withLabels?: boolean;
  } = {},
): ContoursState {
  const { scaleType, ignoreValue, withLabels = false } = opts;
  const [rows, cols] = dataArray.shape;

  const values = useMemo(
    () => toFloatValues(dataArray, Float64Array, ignoreValue),
    [dataArray, ignoreValue],
  );

  // Stable dependency for arrays of levels recreated on every render
  const levelsKey = levels.join(',');
  const stableLevels = useMemo(() => levels, [levelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const labels = withLabels ? getLabelOptions([rows, cols]) : undefined;
  const labelsKey = labels && JSON.stringify(labels);

  const isSync = rows * cols * levels.length <= SYNC_BUDGET;

  const syncContours = useMemo(
    () =>
      isSync
        ? runSteps(
            contoursSteps(
              values,
              [rows, cols],
              stableLevels,
              scaleType,
              labels,
            ),
          )
        : undefined,
    [isSync, values, rows, cols, stableLevels, scaleType, labelsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [asyncContours, setAsyncContours] = useState<ContourResult[]>();
  const [progress, setProgress] = useState<number>();

  useEffect(() => {
    if (isSync) {
      return undefined;
    }

    setProgress(0);
    const task = requestContours(
      {
        values: values.slice(), // eslint-disable-line unicorn/prefer-spread -- copy is transferred
        shape: [rows, cols],
        levels: stableLevels,
        scaleType,
        labels,
      },
      setProgress,
    );

    const status = { isActive: true };
    void (async () => {
      let contours: ContourResult[];
      try {
        contours = await task.promise;
      } catch {
        contours = []; // contours are an overlay: don't break the visualization
      }
      if (status.isActive) {
        setAsyncContours(contours);
        setProgress(undefined);
      }
    })();

    return () => {
      status.isActive = false;
      task.cancel();
    };
  }, [isSync, values, rows, cols, stableLevels, scaleType, labelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return isSync
    ? { contours: syncContours, progress: undefined }
    : { contours: asyncContours, progress };
}
