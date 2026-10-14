import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  releaseWorkerVolume,
  requestIsosurface,
  setWorkerVolume,
  type WorkerTask,
} from '../geometry-worker/client';
import { toAxisCoords, toFloatValues } from '../geometry-worker/utils';
import { type VisScaleType } from '../models';
import { getDecimationStep, type IsosurfaceGeometry } from './marchingCubes';

/* Above this many cells, the grid is decimated before extracting isosurfaces */
export const DEFAULT_CELL_BUDGET = 2 ** 24; // e.g. 256³

const MAX_CACHED_SURFACES = 16;

export interface IsosurfacesState {
  /* Surfaces aligned with the requested levels; `undefined` while being extracted */
  geometries: (IsosurfaceGeometry | undefined)[];
  /* Overall extraction progress in [0, 1], or `undefined` when idle */
  progress: number | undefined;
  /* Grid stride used for extraction (1 = full resolution) */
  step: number;
  error: Error | undefined;
}

interface Options {
  scaleType?: VisScaleType;
  ignoreValue?: IgnoreValue;
  /* Coordinates of the grid points along x, y and z (i.e. dimensions 2, 1 and 0) */
  axisValues?: [
    NumArray | undefined,
    NumArray | undefined,
    NumArray | undefined,
  ];
  cellBudget?: number;
}

/*
 * Extract isosurfaces of a 3D array in a web worker.
 * The volume is sent to the worker once; each level is then extracted (and cached) separately,
 * and extractions of levels that are no longer requested are cancelled.
 */
export function useIsosurfaces(
  dataArray: NdArray<NumArray>,
  levels: number[],
  opts: Options = {},
): IsosurfacesState {
  const { scaleType, ignoreValue, axisValues, cellBudget } = opts;
  const [depth, rows, cols] = dataArray.shape;

  const step = getDecimationStep(
    [depth, rows, cols],
    cellBudget ?? DEFAULT_CELL_BUDGET,
  );
  const scaleKey = JSON.stringify(scaleType ?? null);
  const hasLevels = levels.length > 0;

  const axisCoords = useMemo(
    () =>
      [
        toAxisCoords(axisValues?.[0], cols),
        toAxisCoords(axisValues?.[1], rows),
        toAxisCoords(axisValues?.[2], depth),
      ] as const,
    [axisValues, cols, rows, depth],
  );

  // Send volume to worker only once isosurfaces are requested
  const [volumeId, setVolumeId] = useState<number>();
  useEffect(() => {
    if (!hasLevels) {
      return undefined;
    }

    const values = toFloatValues(dataArray, Float32Array, ignoreValue);
    const id = setWorkerVolume(values, [depth, rows, cols], [...axisCoords]);
    setVolumeId(id);

    return () => {
      releaseWorkerVolume(id);
      setVolumeId((current) => (current === id ? undefined : current));
    };
  }, [hasLevels, dataArray, ignoreValue, axisCoords, depth, rows, cols]);

  function getKey(level: number): string {
    return `${volumeId}|${level}|${scaleKey}|${step}`;
  }

  const [cache, setCache] = useState(new Map<string, IsosurfaceGeometry>());
  const [progressByKey, setProgressByKey] = useState(new Map<string, number>());
  const [error, setError] = useState<Error>();
  const tasksRef = useRef(new Map<string, WorkerTask<IsosurfaceGeometry>>());
  const wantedKeysRef = useRef(new Set<string>());

  const levelsKey = levels.join(',');

  useEffect(() => {
    const tasks = tasksRef.current;
    const wantedKeys = new Set(
      volumeId === undefined ? [] : levels.map(getKey),
    );
    wantedKeysRef.current = wantedKeys;

    // Cancel stale extractions (level changed, volume replaced, etc.)
    for (const [key, task] of tasks) {
      if (!wantedKeys.has(key)) {
        task.cancel();
        tasks.delete(key);
      }
    }

    setProgressByKey((prev) => {
      const next = new Map([...prev].filter(([key]) => tasks.has(key)));
      return next.size === prev.size ? prev : next;
    });

    // Drop surfaces of previous volumes
    setCache((prev) => {
      const prefix = `${volumeId}|`;
      const next = new Map([...prev].filter(([key]) => key.startsWith(prefix)));
      return next.size === prev.size ? prev : next;
    });

    if (volumeId === undefined) {
      return;
    }

    for (const level of levels) {
      const key = getKey(level);
      if (cache.has(key) || tasks.has(key)) {
        continue;
      }

      const task = requestIsosurface(
        { volumeId, level, scaleType, step },
        (progress) => {
          setProgressByKey((prev) => new Map(prev).set(key, progress));
        },
      );
      tasks.set(key, task);
      setProgressByKey((prev) => new Map(prev).set(key, 0));
      setError(undefined);

      void (async () => {
        try {
          const geometry = await task.promise;
          setCache((prev) => {
            const next = new Map(prev).set(key, geometry);
            // Keep recent surfaces only, so toggling a level back and forth stays instant,
            // but never evict surfaces that are still requested
            const evictable = [...next.keys()].filter(
              (k) => !wantedKeysRef.current.has(k),
            );
            const overflow = next.size - MAX_CACHED_SURFACES;
            for (const k of evictable.slice(0, Math.max(overflow, 0))) {
              next.delete(k);
            }
            return next;
          });
        } catch (error_) {
          setError(error_ as Error); // worker only rejects with `Error` objects
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
  }, [volumeId, levelsKey, scaleKey, step]); // eslint-disable-line react-hooks/exhaustive-deps

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
    () =>
      levels.map((level) =>
        volumeId === undefined ? undefined : cache.get(getKey(level)),
      ),
    [cache, volumeId, levelsKey, scaleKey, step], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return {
    geometries,
    progress,
    step,
    error,
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
