import { createMemo } from '@h5web/shared/createMemo';
import { useSyncedRef, useUnmountEffect } from '@react-hookz/web';
import {
  type DependencyList,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { download } from '../toolbar/controls/utils';
import { type GifWriter } from '../vis/snapshot/gif';
import { findVisElement, renderSnapshot } from '../vis/snapshot/render';
import { getSnapshotFilename } from '../vis/snapshot/utils';
import {
  getPrefetchCount,
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
): ((...args: Parameters<Fn>) => void) & { cancel: () => void } {
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
    function cancel() {
      clear();
      lastCallArgs.current = undefined;
    }

    function execute() {
      clear();

      if (!lastCallArgs.current) {
        return;
      }

      const context = lastCallArgs.current;
      lastCallArgs.current = undefined;

      cb.current(...context);
    }

    function debounced(...args: Parameters<Fn>) {
      if (timeout.current) {
        clearTimeout(timeout.current);
      }

      lastCallArgs.current = args;

      // Plan regular execution
      timeout.current = setTimeout(execute, getDelayRef.current(...args));
    }

    return Object.assign(debounced, { cancel });
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

export type RecordingStatus =
  | { current: number; total: number } // `current` is 1-based
  | { error: string };

interface RecordingParams {
  isPlaying: boolean;
  value: number;
  shownValue: number; // value echoed by the consumer, once it has rendered the slice
  fps: number;
  isReady: (value: number) => boolean;
  onFrame: (value: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onPrefetch?: (values: number[], current: number) => boolean;
  beforeSnapshot?: () => Promise<void> | void; // e.g. load panels out of view
}

const FRAME_TIMEOUT = 60_000; // ms to wait for a slice to load
const PLAYING_TIMEOUT = 1000; // ms to wait for playback to turn on before recording anyway

/* Screen resolution like PNG snapshots, at most 2× to keep GIFs small */
function getGifScale(): number {
  return Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
}

async function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/* Record a sequence of slices as an animated GIF, frame by frame: show each slice once its data is
 * ready (as playback does), wait for the visualization to render it, snapshot it and encode it at
 * the playback speed. Playback is on while recording (e.g. for the range of the whole sequence);
 * turning it off (e.g. user picks a slice) cancels recording. Otherwise, the slice shown before
 * recording is shown again after. `from` is an element next to the visualization (cf.
 * `findVisElement`) that stays mounted while recording. */
export function useRecording(params: RecordingParams): {
  status: RecordingStatus | undefined;
  isRecording: boolean;
  record: (from: Element, values: number[]) => void;
  cancel: () => void; // or dismiss error
} {
  const paramsRef = useSyncedRef(params);
  const [status, setStatus] = useState<RecordingStatus>();
  const recording = useRef<{
    controller: AbortController;
    restore: boolean;
    isUnmounted?: boolean;
  }>(undefined);

  useUnmountEffect(() => {
    if (recording.current) {
      recording.current.isUnmounted = true;
      recording.current.controller.abort();
    }
  });

  async function record(from: Element, values: number[]) {
    if (values.length === 0) {
      setStatus({ error: 'Nothing to record (all slices empty)' });
      return;
    }

    const controller = new AbortController();
    const state: NonNullable<typeof recording.current> = {
      controller,
      restore: true,
    };
    recording.current = state;
    const { signal } = controller;
    const { value: initialValue, isPlaying: wasPlaying } = paramsRef.current;
    let writer: GifWriter | undefined;
    let filename = '';
    let hasStarted = false;
    const blocked = new Error(
      // shown to the user, like other errors starting with `Recording`
      'Recording stopped: next slices need confirmation to load',
    );

    // Not once unmounted, or once another recording has started (after cancelling this one)
    function isLatest(): boolean {
      return recording.current === state && !state.isUnmounted;
    }

    function report(newStatus: RecordingStatus | undefined) {
      if (isLatest()) {
        setStatus(newStatus);
      }
    }

    // Checked on every animation frame, so canvases have rendered once true
    async function until(
      condition: () => boolean,
      timeoutError?: Error,
    ): Promise<void> {
      const deadline = performance.now() + FRAME_TIMEOUT;
      for (;;) {
        if (timeoutError && performance.now() > deadline) {
          throw timeoutError;
        }
        if (hasStarted && !paramsRef.current.isPlaying) {
          state.restore = false; // e.g. user picked a slice
          controller.abort();
        }
        signal.throwIfAborted();
        if (condition()) {
          return;
        }
        await nextAnimationFrame(); // eslint-disable-line no-await-in-loop
      }
    }

    report({ current: 0, total: values.length });
    try {
      paramsRef.current.onPlayingChange(true);
      const deadline = performance.now() + PLAYING_TIMEOUT;
      await until(
        () => paramsRef.current.isPlaying || performance.now() > deadline,
      );
      hasStarted = paramsRef.current.isPlaying;

      /* eslint-disable no-await-in-loop -- one frame after the other */
      for (const [index, val] of values.entries()) {
        report({ current: index + 1, total: values.length });
        const { fps } = paramsRef.current;
        const upcoming = values.slice(index, index + getPrefetchCount(fps));
        const timeout = new Error(
          `Recording failed: slice ${val} did not load`,
        );
        if (paramsRef.current.onPrefetch) {
          // Prefetch on every check, as playback does, since slices may change meanwhile (e.g.
          // other dimension sliced)
          await until(() => {
            const { onPrefetch, shownValue, isReady } = paramsRef.current;
            if (onPrefetch && !onPrefetch(upcoming, shownValue)) {
              throw blocked;
            }
            return isReady(val);
          }, timeout);
        }

        // Without prefetching, slices only load once shown
        paramsRef.current.onFrame(val);
        await until(
          () =>
            paramsRef.current.shownValue === val &&
            paramsRef.current.isReady(val),
          timeout,
        );
        await nextAnimationFrame(); // canvases render on demand once slice is shown
        await nextAnimationFrame();

        await paramsRef.current.beforeSnapshot?.();
        const elem = findVisElement(from);
        if (!elem) {
          throw new Error('No visualization found');
        }
        const frame = await renderSnapshot(elem, { scale: getGifScale() });
        signal.throwIfAborted();
        if (!writer) {
          const { createGifWriter } = await import('../vis/snapshot/gif');
          writer = createGifWriter(frame.width, frame.height, fps);
          filename = getSnapshotFilename(
            elem.getAttribute('aria-label') ?? '',
            'gif',
          );
        }
        writer.addFrame(frame);
      }
      /* eslint-enable no-await-in-loop */

      signal.throwIfAborted();
      const blob = writer?.finish();
      if (blob) {
        await download(async () => blob, filename);
      }
      report(undefined);
    } catch (error) {
      if (signal.aborted) {
        report(undefined);
      } else {
        console.error('Recording failed:', error); // eslint-disable-line no-console
        report({
          error:
            error instanceof Error && error.message.startsWith('Recording')
              ? error.message
              : 'Recording failed',
        });
      }
    } finally {
      const isLast = isLatest();
      if (recording.current === state) {
        recording.current = undefined;
      }
      if (isLast) {
        const { value, onPrefetch, onFrame, onPlayingChange } =
          paramsRef.current;
        const isRestored = state.restore && !wasPlaying; // else playback goes on
        onPrefetch?.([], isRestored ? initialValue : value); // release others
        if (isRestored) {
          onFrame(initialValue);
          onPlayingChange(false);
        }
      }
    }
  }

  return {
    status,
    isRecording: !!status && !('error' in status),
    record: (from, values) => {
      void record(from, values);
    },
    cancel: () => {
      recording.current?.controller.abort();
      setStatus(undefined);
    },
  };
}
