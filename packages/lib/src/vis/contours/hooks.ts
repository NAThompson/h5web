import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo, useState } from 'react';

import {
  getWorkerLoadFailure,
  requestContours,
} from '../geometry-worker/client';
import { useLatch, useWorkerData } from '../geometry-worker/hooks';
import { contoursSteps, runSteps } from '../geometry-worker/jobs';
import {
  type ContourResult,
  type LabelOptions,
} from '../geometry-worker/models';
import { toFloatValues } from '../geometry-worker/utils';
import { type VisScaleType } from '../models';

/* Below this many cell visits (cells × levels), contours are computed synchronously */
const SYNC_BUDGET = 2 ** 20;

/* Largest computation done on the main thread when the worker is unavailable */
const FALLBACK_BUDGET = 2 ** 24;

export interface ContoursState {
  contours: ContourResult[] | undefined;
  progress: number | undefined; // defined while contours are being computed in the worker
  error: Error | undefined;
}

export function getLabelOptions(shape: number[]): LabelOptions {
  const size = Math.max(...shape);
  return { minLength: size / 12, spacing: size / 2.5, maxCount: 8 };
}

interface AsyncResult {
  contours: ContourResult[];
  source: object; // image the contours were computed on
}

/*
 * Contour lines of a 2D array at the given levels. Small images are processed synchronously;
 * large ones in the worker, to which the image is sent once (and kept while it doesn't change).
 */
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

  // Stable dependency for arrays of levels recreated on every render
  const levelsKey = levels.join(',');
  const stableLevels = useMemo(() => levels, [levelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const labelsKey = withLabels ? `${rows}x${cols}` : undefined;
  const labels = useMemo(
    () => (labelsKey ? getLabelOptions([rows, cols]) : undefined),
    [labelsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const hasLevels = levels.length > 0;
  const visits = rows * cols * levels.length;
  const loadFailure = getWorkerLoadFailure();
  const isSync =
    hasLevels &&
    (visits <= SYNC_BUDGET || (!!loadFailure && visits <= FALLBACK_BUDGET));

  const source = useMemo(
    () => ({ dataArray, ignoreValue }),
    [dataArray, ignoreValue],
  );

  // Values for synchronous computation, only copied when needed
  const syncValues = useMemo(
    () => (isSync ? toFloatValues(dataArray, ignoreValue) : undefined),
    [isSync, dataArray, ignoreValue],
  );

  const syncContours = useMemo(
    () =>
      syncValues &&
      runSteps(
        contoursSteps(
          syncValues,
          [rows, cols],
          stableLevels,
          scaleType,
          labels,
        ),
      ),
    [syncValues, rows, cols, stableLevels, scaleType, labels],
  );

  // Send the image to the worker once, then only levels and options with each request
  const isWorkerNeeded = useLatch(!isSync && hasLevels, source);
  const { dataId, error: dataError } = useWorkerData(
    isWorkerNeeded,
    source,
    () => ({
      values: toFloatValues(dataArray, ignoreValue),
      shape: [rows, cols],
    }),
  );

  const [asyncResult, setAsyncResult] = useState<AsyncResult>();
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<Error>();

  useEffect(() => {
    if (isSync || !hasLevels) {
      setProgress(undefined);
      setError(undefined);
      return undefined;
    }

    if (loadFailure) {
      setError(
        new Error(
          `${loadFailure.message}; image too large to compute contours on the main thread`,
        ),
      );
      return undefined;
    }

    if (dataId === undefined) {
      return undefined;
    }

    setProgress(0);
    setError(undefined);
    const task = requestContours(
      { dataId, levels: stableLevels, scaleType, labels },
      setProgress,
    );

    const status = { isActive: true };
    void (async () => {
      try {
        const contours = await task.promise;
        if (status.isActive) {
          setAsyncResult({ contours, source });
        }
      } catch (error_) {
        if (status.isActive) {
          setError(error_ as Error); // contours are an overlay: don't break the visualization
        }
      } finally {
        if (status.isActive) {
          setProgress(undefined);
        }
      }
    })();

    return () => {
      status.isActive = false;
      task.cancel();
    };
  }, [
    isSync,
    hasLevels,
    loadFailure,
    dataId,
    source,
    stableLevels,
    scaleType,
    labels,
  ]);

  if (!hasLevels) {
    return { contours: [], progress: undefined, error: undefined };
  }

  if (isSync) {
    return { contours: syncContours, progress: undefined, error: undefined };
  }

  // Never draw contours computed on another image (e.g. a previous slice): only keep them while levels change
  return {
    contours: asyncResult?.source === source ? asyncResult.contours : undefined,
    progress,
    error: error ?? dataError,
  };
}
