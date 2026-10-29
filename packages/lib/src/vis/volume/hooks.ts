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
import { type AxisCoords, type DataValues } from '../geometry-worker/models';
import { toAxisCoords, toFloatValues } from '../geometry-worker/utils';
import { type VisScaleType } from '../models';
import { getDecimationStep, type IsosurfaceGeometry } from './marchingCubes';
import { type AxisValues } from './models';
import { getEnclosedVolume, type PassBounds } from './passRegion';
import { remapIsosurface } from './utils';

/* Above this many cells, the grid is decimated before extracting isosurfaces */
export const DEFAULT_CELL_BUDGET = 2 ** 24; // e.g. 256³

/* Memory allowed for surfaces kept for levels that are no longer requested */
export const DEFAULT_CACHE_BUDGET = 256 * 1024 * 1024;

/* Surfaces kept for levels that are no longer requested (e.g. to toggle a level back and forth) */
const MAX_HISTORY = 4;

/* Grids with at most this many cells get smooth surfaces by default (cf. `smoothIsosurfaceSteps`),
 * so that changing a level stays interactive: smoothing takes ~0.9 s at 64³ for the (very curved)
 * Marschner-Lobb signal, about a quarter of that at 40³ */
export const SMOOTH_CELL_BUDGET = 2 ** 16; // e.g. 40³

/* Grids with more cells are never smoothed (~3 s and hundreds of MB at 128³) */
export const MAX_SMOOTH_CELLS = 2 ** 21; // e.g. 128³

/* Largest extraction done on the main thread when the worker is unavailable */
export const FALLBACK_CELL_BUDGET = 2 ** 21; // e.g. 128³

export interface IsosurfacesState {
  /* Surfaces aligned with the requested levels; `undefined` while being extracted */
  geometries: (IsosurfaceGeometry | undefined)[];
  /* Overall extraction progress in [0, 1], or `undefined` when idle */
  progress: number | undefined;
  /* Grid stride used for extraction (1 = full resolution) */
  step: number;
  /* Whether surfaces are smoothed, and can be (cf. `MAX_SMOOTH_CELLS`) */
  smooth: boolean;
  canSmooth: boolean;
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
  /* Smooth surfaces (cf. `smoothIsosurfaceSteps`), up to `MAX_SMOOTH_CELLS`; by default, if the grid
   * has at most `SMOOTH_CELL_BUDGET` cells and the worker runs */
  smooth?: boolean;
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
 * of levels that are no longer requested are cancelled. Bounds in place of a level extract the
 * closed surface of a pass region (cf. `passRegionSteps`). If the worker can't run (e.g. because of
 * a Content Security Policy), small volumes are processed on the main thread instead.
 */
export function useIsosurfaces(
  dataArray: NdArray<NumArray>,
  levels: (number | PassBounds)[],
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
  const loadFailure = getWorkerLoadFailure();
  const canSmooth = cells <= MAX_SMOOTH_CELLS;
  const smooth =
    canSmooth && (opts.smooth ?? (!loadFailure && cells <= SMOOTH_CELL_BUDGET));
  const scaleKey = JSON.stringify(scaleType ?? null);
  const levelsKey = JSON.stringify(levels);

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
    values: DataValues;
  }>(undefined);

  const sourceId = useMemo(() => {
    nextSourceId += 1;
    return nextSourceId;
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  function getKey(level: number | PassBounds): string {
    return `${sourceId}|${JSON.stringify(level)}|${scaleKey}|${step}|${smooth}`;
  }

  // Extraction on the main thread, for when the worker can't be used
  function extractOnMainThread(level: number | PassBounds): IsosurfaceGeometry {
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
        smooth,
      ),
    );
  }

  const lastSourceIdRef = useRef<number>(undefined);

  useEffect(() => {
    // Forget failures when the data changes, so that a new array gets a fresh chance
    if (lastSourceIdRef.current !== sourceId) {
      lastSourceIdRef.current = sourceId;
      failedRef.current.clear();
      retriesRef.current.clear();
      setError(undefined);
    }

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
        { dataId, level, scaleType, step, smooth },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceId,
    dataId,
    generation,
    loadFailure,
    levelsKey,
    scaleKey,
    step,
    smooth,
  ]);

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
    [cache, sourceId, levelsKey, scaleKey, step, smooth], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    geometries,
    progress,
    step,
    smooth,
    canSmooth,
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

export interface PassRegionState {
  geometry: IsosurfaceGeometry;
  /* Fraction of the box filled by the region */
  fraction: number;
}

/* Fraction of the box filled by a closed region, along the axes' coordinates (cf. `remapIsosurface`) */
export function getRegionFraction(
  geometry: IsosurfaceGeometry,
  shape: number[],
  axisValues: AxisValues,
): number {
  const { positions } =
    remapIsosurface(geometry.positions, geometry.normals, shape, axisValues) ??
    geometry;
  const [depth, rows, cols] = shape;
  const volume = getEnclosedVolume(positions, geometry.indices);
  return Math.min(Math.max(volume / (depth * rows * cols), 0), 1);
}

/*
 * Pass region extracted by `useIsosurfaces` (bounds in place of a level), with the fraction of the
 * box it fills. While new bounds are being extracted (`isPending`), the previous region of the
 * same array is kept.
 */
export function usePassRegion(
  bounds: PassBounds | undefined, // nothing shown without bounds
  lastGeometry: IsosurfaceGeometry | undefined,
  isExtracting: boolean,
  dataArray: NdArray<NumArray>,
  axisValues: AxisValues, // voxels of non-uniform axes at their coordinates
): PassRegionState | undefined {
  const { shape } = dataArray;
  const geometry = bounds && lastGeometry;
  const isPending = !!bounds && isExtracting;
  const region = useMemo(
    () =>
      geometry && {
        geometry,
        fraction: getRegionFraction(geometry, shape, axisValues),
      },
    [geometry, shape, axisValues],
  );

  const [last, setLast] = useState({ region, dataArray });
  if (region && region !== last.region) {
    setLast({ region, dataArray }); // derived state, updated during render
  }
  return (
    region ??
    (isPending && last.dataArray === dataArray ? last.region : undefined)
  );
}
