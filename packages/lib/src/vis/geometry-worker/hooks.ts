import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  getWorkerGeneration,
  getWorkerLoadFailure,
  releaseWorkerData,
  setWorkerData,
  subscribeWorker,
} from './client';
import { type WorkerData } from './models';

/* `value` once it has been true, until `resetKey` changes */
export function useLatch(value: boolean, resetKey: unknown): boolean {
  const [latch, setLatch] = useState({ key: resetKey, isOn: value });

  if (latch.key !== resetKey) {
    const next = { key: resetKey, isOn: value };
    setLatch(next); // derived state, updated during render
    return next.isOn;
  }

  if (value && !latch.isOn) {
    setLatch({ key: resetKey, isOn: true });
    return true;
  }

  return latch.isOn;
}

export function useWorkerGeneration(): number {
  return useSyncExternalStore(subscribeWorker, getWorkerGeneration);
}

interface WorkerDataState {
  dataId: number | undefined;
  generation: number;
  key: unknown;
  error: Error | undefined;
}

/*
 * Register an array in the worker while `enabled`, and keep it there until the array
 * changes or the component unmounts. Re-registered if the worker restarts after a crash.
 * `key` identifies the data (a new object whenever it changes); `prepare` must return
 * a fresh copy, since it is transferred to the worker.
 */
export function useWorkerData(
  enabled: boolean,
  key: object,
  prepare: () => WorkerData,
): { dataId: number | undefined; error: Error | undefined } {
  const generation = useWorkerGeneration();
  const [state, setState] = useState<WorkerDataState>({
    dataId: undefined,
    generation,
    key: undefined,
    error: undefined,
  });

  useEffect(() => {
    if (!enabled || getWorkerLoadFailure()) {
      setState({ dataId: undefined, generation, key, error: undefined });
      return undefined;
    }

    let dataId: number;
    try {
      dataId = setWorkerData(prepare());
    } catch (error) {
      setState({ dataId: undefined, generation, key, error: error as Error });
      return undefined;
    }

    setState({ dataId, generation, key, error: undefined });
    return () => {
      releaseWorkerData(dataId);
    };
  }, [enabled, generation, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never hand out the ID of data that was released or belongs to a dead worker
  return state.generation === generation && state.key === key
    ? { dataId: state.dataId, error: state.error }
    : { dataId: undefined, error: undefined };
}
