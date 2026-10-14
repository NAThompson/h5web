import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  getWorkerLoadFailure,
  requestIsosurface,
  WorkerError,
  type WorkerTask,
} from '../geometry-worker/client';
import {
  useLatch,
  useWorkerData,
  useWorkerGeneration,
} from '../geometry-worker/hooks';
import { isosurfaceSteps, runSteps } from '../geometry-worker/jobs';
import { type AxisCoords } from '../geometry-worker/models';
import { toAxisCoords, toFloatValues } from '../geometry-worker/utils';
import { type VisScaleType } from '../models';
import { getDecimationStep, type IsosurfaceGeometry } from './marchingCubes';

/* Above this many cells, the grid is decimated before extracting isosurfaces */
export const DEFAULT_CELL_BUDGET = 2 ** 24; // e.g. 256³

/* Memory allowed for surfaces kept for levels that are no longer requested */
export const DEFAULT_CACHE_BUDGET = 256 * 1024 * 1024;

/* Surfaces kept for levels that are no longer requested (e.g. to toggle a level back and forth) */
const MAX_HISTORY = 4;

/* Largest extraction done on the main thread when the worker is unavailable */
export const FALLBACK_CELL_BUDGET = 2 ** 21; // e.g. 128³

export interface IsosurfacesState {
  /* Surfaces aligned with the requested levels; `undefined` while being extracted */
  geometries: (IsosurfaceGeometry | undefined)[];
  /* Overall extraction progress in [0, 1], or `undefined` when idle */
  progress: number | undefined;
  /* Grid stride used for extraction (1 = full resolution) */
  step: number;
  /* Last extraction failure, cleared when a new extraction starts */
  error: Error | undefined;
  /* Set when the worker is unavailable and surfaces are extracted on the main thread */
  workerError: Error | undefined;
}

interface Options {
  scaleType?: VisScaleType;
  ignoreValue?: IgnoreValue;
  /* Coordinates of the grid points (or bin edges) along x, y and z (i.e. dimensions 2, 1 and 0),
   * for gradient magnitudes in axis units; omit for gradients per voxel */
  axisValues?: [
    NumArray | undefined,
    NumArray | undefined,
    NumArray | undefined,
  ];
  cellBudget?: number;
  cacheBudget?: number;
}

let nextSourceId = 0;

export function getGeometryBytes(geometry: IsosurfaceGeometry): number {
  const { positions, normals, gradients, indices } = geometry;
  return (
    positions.byteLength +
    normals.byteLength +
    gradients.byteLength +
    indices.byteLength
  );
}

/*
 * Keep every requested surface; of the others, keep only the most recent few within budget.
 * `cache` is in insertion order (oldest first).
 */
export function pruneCache(
  cache: Map<string, IsosurfaceGeometry>,
  wantedKeys: Set<string>,
  budget: number,
): Map<string, IsosurfaceGeometry> {
  const history = [...cache.keys()].filter((key) => !wantedKeys.has(key));
  const kept = new Set(history.slice(-MAX_HISTORY).reverse());

  let bytes = 0;
  for (const key of kept) {
    const geometry = cache.get(key);
    bytes += geometry ? getGeometryBytes(geometry) : 0;
    if (bytes > budget) {
      kept.delete(key);
    }
  }

  const next = new Map(
    [...cache].filter(([key]) => wantedKeys.has(key) || kept.has(key)),
  );
  return next.size === cache.size ? cache : next;
}

/*
 * Extract isosurfaces of a 3D array in a web worker.
 * The array is sent to the worker when the first level is requested, and kept there while
 * the array stays the same; each level is extracted (and cached) separately, and extractions
 * of levels that are no longer requested are cancelled. If the worker can't run (e.g. because of
 * a Content Security Policy), small volumes are processed on the main thread instead.
 */
export function useIsosurfaces(
  dataArray: NdArray<NumArray>,
  levels: number[],
  opts: Options = {},
): IsosurfacesState {
  const { scaleType, ignoreValue, axisValues, cellBudget, cacheBudget } = opts;
  const [depth, rows, cols] = dataArray.shape;
  const shape: [number, number, number] = [depth, rows, cols];

  const step = getDecimationStep(shape, cellBudget ?? DEFAULT_CELL_BUDGET);
  const cells = shape.reduce(
    (acc, size) => acc * Math.max(Math.ceil((size - 1) / step), 1),
    1,
  );
  const scaleKey = JSON.stringify(scaleType ?? null);
  const levelsKey = levels.join(',');

  const axisCoords = useMemo(
    (): AxisCoords => [
      toAxisCoords(axisValues?.[0], cols),
      toAxisCoords(axisValues?.[1], rows),
      toAxisCoords(axisValues?.[2], depth),
    ],
    [axisValues, cols, rows, depth],
  );

  // Identity of the data: surfaces are cached per identity
  const source = useMemo(
    () => ({ dataArray, ignoreValue, axisCoords }),
    [dataArray, ignoreValue, axisCoords],
  );

  const generation = useWorkerGeneration();
  const loadFailure = getWorkerLoadFailure();

  const isRequested = useLatch(levels.length > 0, source);
  const { dataId, error: dataError } = useWorkerData(
    isRequested,
    source,
    () => ({
      values: toFloatValues(dataArray, ignoreValue),
      shape,
      axisValues: axisCoords,
    }),
  );

  const [cache, setCache] = useState(
    () => new Map<string, IsosurfaceGeometry>(),
  );
  const [progressByKey, setProgressByKey] = useState(new Map<string, number>());
  const [error, setError] = useState<Error>();

  const tasksRef = useRef(new Map<string, WorkerTask<IsosurfaceGeometry>>());
  const failedRef = useRef(new Set<string>());
  const retriesRef = useRef(new Map<string, number>());
  const fallbackValuesRef = useRef<{
    source: object;
    values: ArrayLike<number>;
  }>(undefined);

  const sourceId = useMemo(() => {
    nextSourceId += 1;
    return nextSourceId;
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  function getKey(level: number): string {
    return `${sourceId}|${level}|${scaleKey}|${step}`;
  }

  // Extraction on the main thread, for when the worker can't be used
  function extractOnMainThread(level: number): IsosurfaceGeometry {
    if (fallbackValuesRef.current?.source !== source) {
      fallbackValuesRef.current = {
        source,
        values: toFloatValues(dataArray, ignoreValue),
      };
    }
    return runSteps(
      isosurfaceSteps(
        fallbackValuesRef.current.values,
        shape,
        axisCoords,
        level,
        scaleType,
        step,
      ),
    );
  }

  useEffect(() => {
    const tasks = tasksRef.current;
    const wantedKeys = new Set(levels.map(getKey));

    // Cancel stale extractions (level changed, data replaced, etc.) and drop surfaces beyond budget
    for (const [key, task] of tasks) {
      if (!wantedKeys.has(key)) {
        task.cancel();
        tasks.delete(key);
      }
    }
    setCache((prev) =>
      pruneCache(
        new Map([...prev].filter(([key]) => key.startsWith(`${sourceId}|`))),
        wantedKeys,
        cacheBudget ?? DEFAULT_CACHE_BUDGET,
      ),
    );
    setProgressByKey((prev) => {
      const next = new Map([...prev].filter(([key]) => tasks.has(key)));
      return next.size === prev.size ? prev : next;
    });

    function storeGeometry(key: string, geometry: IsosurfaceGeometry): void {
      setCache((prev) =>
        pruneCache(
          new Map(prev).set(key, geometry),
          new Set(levels.map(getKey)),
          cacheBudget ?? DEFAULT_CACHE_BUDGET,
        ),
      );
    }

    function fail(key: string, err: Error): void {
      failedRef.current.add(key);
      setError(err);
    }

    for (const level of levels) {
      const key = getKey(level);
      if (cache.has(key) || tasks.has(key) || failedRef.current.has(key)) {
        continue;
      }

      if (loadFailure) {
        if (cells > FALLBACK_CELL_BUDGET) {
          fail(
            key,
            new Error(
              `${loadFailure.message}; volume too large to extract isosurfaces on the main thread`,
            ),
          );
          continue;
        }
        setError(undefined);
        try {
          storeGeometry(key, extractOnMainThread(level));
        } catch (error_) {
          fail(key, error_ as Error);
        }
        continue;
      }

      if (dataId === undefined) {
        continue; // data not sent yet
      }

      const task = requestIsosurface(
        { dataId, level, scaleType, step },
        (progress) => {
          setProgressByKey((prev) => new Map(prev).set(key, progress));
        },
      );
      tasks.set(key, task);
      setProgressByKey((prev) => new Map(prev).set(key, 0));
      setError(undefined);

      void (async () => {
        try {
          storeGeometry(key, await task.promise);
        } catch (error_) {
          // Worker crashed: the data is sent again to a new worker and extraction is retried once
          const retries = retriesRef.current.get(key) ?? 0;
          const isRetryable =
            error_ instanceof WorkerError && !error_.isLoadFailure;
          const isLoadFailure =
            error_ instanceof WorkerError && error_.isLoadFailure;
          if (isLoadFailure) {
            // Worker can't run here: the effect runs again and falls back to the main thread
          } else if (isRetryable && retries < 1) {
            retriesRef.current.set(key, retries + 1);
          } else {
            fail(key, error_ as Error);
          }
        } finally {
          if (tasks.get(key) === task) {
            tasks.delete(key);
          }
          setProgressByKey((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
          });
        }
      })();
    }
  }, [sourceId, dataId, generation, loadFailure, levelsKey, scaleKey, step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Forget failures when the data changes, so that a new array gets a fresh chance
  useEffect(() => {
    failedRef.current.clear();
    retriesRef.current.clear();
    setError(undefined);
  }, [source]);

  // Cancel everything on unmount
  useEffect(() => {
    const tasks = tasksRef.current;
    return () => {
      for (const task of tasks.values()) {
        task.cancel();
      }
      tasks.clear();
    };
  }, []);

  const progressValues = [...progressByKey.values()];
  const progress =
    progressValues.length > 0
      ? progressValues.reduce((acc, val) => acc + val, 0) /
        progressValues.length
      : undefined;

  // Keep the same array while surfaces don't change, e.g. for memoizing their gradient domain
  const geometries = useMemo(
    () => levels.map((level) => cache.get(getKey(level))),
    [cache, sourceId, levelsKey, scaleKey, step], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    geometries,
    progress,
    step,
    error: error ?? dataError,
    workerError: loadFailure,
  };
}

/* Range of gradient magnitudes over several surfaces */
export function getGradientDomain(
  geometries: (IsosurfaceGeometry | undefined)[],
): [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const geometry of geometries) {
    if (!geometry) {
      continue;
    }
    for (const val of geometry.gradients) {
      if (val < min) {
        min = val;
      }
      if (val > max) {
        max = val;
      }
    }
  }
  return min <= max ? [min, max] : undefined;
}
