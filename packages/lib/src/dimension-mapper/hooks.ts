import { createMemo } from '@h5web/shared/createMemo';
import { useSyncedRef, useUnmountEffect } from '@react-hookz/web';
import {
  type DependencyList,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  initPlaybackClock,
  type PlaybackSettings,
  tickPlayback,
} from './playback';
import { getSlicedDimsAndMapping } from './utils';

export const useSlicedDimsAndMapping = createMemo(getSlicedDimsAndMapping);

// Debounced callback with a delay that can be adjusted on every invocation
export function useDynamicDebouncedCallback<
  Fn extends (...args: any[]) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
>(
  callback: Fn,
  deps: DependencyList,
  getDelay: (...args: Parameters<Fn>) => number,
): (...args: Parameters<Fn>) => void {
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cb = useRef(callback);
  const getDelayRef = useSyncedRef(getDelay);
  const lastCallArgs = useRef<Parameters<Fn>>(undefined);

  function clear() {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = undefined;
    }
  }

  // Cancel scheduled execution on unmount
  useUnmountEffect(clear);

  useEffect(() => {
    cb.current = callback;
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    function execute() {
      clear();

      if (!lastCallArgs.current) {
        return;
      }

      const context = lastCallArgs.current;
      lastCallArgs.current = undefined;

      cb.current(...context);
    }

    return (...args) => {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }

      lastCallArgs.current = args;

      // Plan regular execution
      timeout.current = setTimeout(execute, getDelayRef.current(...args));
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export type PlaybackWaiting = 'loading' | 'blocked';

// Don't flag short waits, to avoid flickering
const WAITING_DELAY = 300; // ms

interface PlaybackParams {
  isPlaying: boolean;
  value: number;
  length: number;
  stride: number;
  settings: PlaybackSettings;
  isReady: (value: number) => boolean;
  isSkipped?: (value: number) => boolean; // e.g. slices known to be empty
  onFrame: (value: number) => void;
  onEnd: () => void;
  // Returns `false` if upcoming frames can't be fetched automatically (e.g. need confirmation)
  onPrefetch?: (values: number[], current: number) => boolean;
}

/* Advance a slicing value over time while `isPlaying` is true, and report whether playback is
 * waiting for data. Without `onPrefetch`, nothing loads frames ahead of time, so wait for the
 * current frame to be ready before moving on (instead of waiting for the next frame, which
 * would never be fetched). */
export function usePlayback(
  params: PlaybackParams,
): PlaybackWaiting | undefined {
  const { isPlaying } = params;
  const paramsRef = useSyncedRef(params);
  const [waiting, setWaiting] = useState<PlaybackWaiting>();

  useEffect(() => {
    if (!isPlaying) {
      return undefined;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let lastOnPrefetch: PlaybackParams['onPrefetch'];
    let waitingSince: number | undefined;

    const initial = paramsRef.current;
    let clock = initPlaybackClock(
      initial.value,
      { ...initial, mode: initial.settings.mode },
      Date.now(),
    );

    function tick() {
      const { settings, length, stride, isReady, onFrame, onEnd, onPrefetch } =
        paramsRef.current;
      const { isSkipped } = paramsRef.current;

      const now = Date.now();
      const current = clock.cursor.value;
      const result = tickPlayback(
        clock,
        now,
        { ...settings, length, stride, isSkipped },
        onPrefetch ? isReady : () => isReady(current),
      );

      // Call on every tick, even if upcoming values haven't changed, since the slices they
      // refer to may have (e.g. when another dimension gets sliced during playback)
      let isBlocked = false;
      if (onPrefetch) {
        lastOnPrefetch = onPrefetch;
        isBlocked = !onPrefetch(result.upcoming, current);
      }

      waitingSince = result.waiting ? (waitingSince ?? now) : undefined;
      const isWaiting =
        waitingSince !== undefined && now - waitingSince >= WAITING_DELAY;
      setWaiting(isWaiting ? (isBlocked ? 'blocked' : 'loading') : undefined);

      if (result.ended) {
        onEnd();
        return;
      }

      if (result.clock.cursor.value !== current) {
        onFrame(result.clock.cursor.value);
      }

      ({ clock } = result);
      timeout = setTimeout(tick, result.delay);
    }

    tick();

    return () => {
      clearTimeout(timeout);
      setWaiting(undefined);

      /* Let consumer cancel pending prefetches, except for the slice now selected (which may
       * have just been picked by the user, thus stopping playback). `paramsRef` is a synced
       * ref, not a DOM ref: reading its latest value on cleanup is intended. */
      // eslint-disable-next-line react-hooks/exhaustive-deps
      lastOnPrefetch?.([], paramsRef.current.value);
    };
  }, [isPlaying, paramsRef]);

  return isPlaying ? waiting : undefined;
}
