/* Pure state machine behind slice playback (see `usePlayback`).
 * Kept free of React and timers so it can be unit-tested deterministically. */

export type PlaybackMode = 'loop' | 'bounce' | 'once';

/* - `wait`: show every frame, advancing only once the next frame's data is loaded
 *   (playback slows down when data arrives slower than the requested frame rate);
 * - `realtime`: keep to the requested frame rate by skipping frames that are not
 *   loaded in time (still never shows a frame before its data is loaded). */
export type PlaybackTiming = 'wait' | 'realtime';

export interface PlaybackSettings {
  fps: number;
  mode: PlaybackMode;
  timing: PlaybackTiming;
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  fps: 10,
  mode: 'loop',
  timing: 'wait',
};

export const MIN_FPS = 0.5;
export const MAX_FPS = 60;

const MAX_PREFETCH_COUNT = 8;
const MIN_PREFETCH_COUNT = 2;
const PREFETCH_SECONDS = 0.5; // how far ahead of the current frame to prefetch

// Re-check readiness this often while waiting for data
export const READY_POLL_INTERVAL = 25; // ms

export interface SequenceParams {
  length: number;
  stride: number;
  mode: PlaybackMode;
}

export interface PlaybackCursor {
  value: number;
  direction: 1 | -1;
}

export interface PlaybackClock {
  cursor: PlaybackCursor;
  frameTime: number; // time at which the current frame was due
  window?: number[]; // real-time mode: frames being prefetched since the last advance
}

export interface TickResult {
  clock: PlaybackClock;
  ended: boolean; // `once` mode reached the last frame
  upcoming: number[]; // values to prefetch, in playback order
  delay: number; // ms until next tick
}

export function clampFps(fps: number): number {
  return Math.min(Math.max(fps, MIN_FPS), MAX_FPS);
}

export function getPrefetchCount(fps: number): number {
  return Math.min(
    Math.max(Math.ceil(fps * PREFETCH_SECONDS), MIN_PREFETCH_COUNT),
    MAX_PREFETCH_COUNT,
  );
}

/* Next frame in playback order, or `undefined` once the end is reached in `once` mode.
 * Edges are always visited, even when they are not a multiple of the stride away. */
export function getNextFrame(
  cursor: PlaybackCursor,
  params: SequenceParams,
): PlaybackCursor | undefined {
  const { length, stride, mode } = params;
  const { value, direction } = cursor;
  const max = length - 1;

  if (max <= 0) {
    return undefined;
  }

  const edge = direction > 0 ? max : 0;

  if (value !== edge) {
    return { value: clampValue(value + direction * stride, max), direction };
  }

  if (mode === 'once') {
    return undefined;
  }

  if (mode === 'loop') {
    return { value: direction > 0 ? 0 : max, direction };
  }

  const reversed = direction > 0 ? -1 : 1;
  return {
    value: clampValue(value + reversed * stride, max),
    direction: reversed,
  };
}

export function getUpcomingFrames(
  cursor: PlaybackCursor,
  params: SequenceParams,
  count: number,
): PlaybackCursor[] {
  const frames: PlaybackCursor[] = [];
  let current: PlaybackCursor | undefined = cursor;

  while (frames.length < count) {
    current = getNextFrame(current, params);
    if (!current) {
      break;
    }
    frames.push(current);
  }

  return frames;
}

export function initPlaybackClock(
  value: number,
  params: SequenceParams,
  now: number,
): PlaybackClock {
  // When starting at the end in `once` mode, restart from the beginning
  const atEnd = value >= params.length - 1;
  return {
    cursor: {
      value: params.mode === 'once' && atEnd ? 0 : value,
      direction: 1,
    },
    frameTime: now,
  };
}

/* Advance the clock to `now`. `isReady` tells whether a frame can be shown without waiting
 * for data. Frames are never shown before they are ready, so requests can't pile up faster
 * than data arrives. */
export function tickPlayback(
  clock: PlaybackClock,
  now: number,
  settings: PlaybackSettings & SequenceParams,
  isReady: (value: number) => boolean,
): TickResult {
  const { fps, timing } = settings;
  const interval = 1000 / clampFps(fps);
  const prefetchCount = getPrefetchCount(fps);

  const elapsed = now - clock.frameTime;
  const dueSteps = Math.floor(elapsed / interval);

  if (dueSteps < 1) {
    return {
      clock,
      ended: false,
      upcoming:
        clock.window ??
        toValues(getUpcomingFrames(clock.cursor, settings, prefetchCount)),
      delay: Math.max(interval - elapsed, 1),
    };
  }

  // In real-time mode, consider all frames that are due (capped to one full cycle)
  const maxSteps =
    timing === 'realtime' ? Math.min(dueSteps, settings.length * 2) : 1;
  const candidates = getUpcomingFrames(
    clock.cursor,
    settings,
    maxSteps + prefetchCount,
  );

  if (candidates.length === 0) {
    return { clock, ended: true, upcoming: [], delay: 0 };
  }

  // Show the furthest frame that is due and ready
  const dueCandidates = candidates.slice(0, maxSteps);
  let shownIndex = -1;
  for (let i = dueCandidates.length - 1; i >= 0; i -= 1) {
    if (isReady(dueCandidates[i].value)) {
      shownIndex = i;
      break;
    }
  }

  const steps = shownIndex + 1; // 0 if nothing can be shown yet

  // Prefetch the frames that will be due next (skipping, in real-time mode, those already late,
  // but keeping at least the last frame in `once` mode)
  const firstUpcoming =
    timing === 'realtime'
      ? Math.max(Math.min(maxSteps, candidates.length) - 1, steps)
      : steps;
  const upcoming = toValues(
    candidates.slice(firstUpcoming, firstUpcoming + prefetchCount),
  );

  if (steps === 0) {
    if (timing === 'wait') {
      return { clock, ended: false, upcoming, delay: READY_POLL_INTERVAL };
    }

    /* In real-time mode, the frames being prefetched may become late before they finish loading;
     * keep prefetching them anyway (rather than cancelling them in favour of later frames, which
     * may never finish loading either), until one of them can be shown. Only drop them if they
     * are no longer part of the sequence (e.g. after changing the mode). */
    const candidateValues = new Set(toValues(candidates));
    const isWindowValid = clock.window?.some((val) => candidateValues.has(val));
    const window = isWindowValid && clock.window ? clock.window : upcoming;

    return {
      clock: window === clock.window ? clock : { ...clock, window },
      ended: false,
      upcoming: window,
      delay: READY_POLL_INTERVAL,
    };
  }

  const isLate = timing === 'wait' && elapsed >= 2 * interval;
  const frameTime = isLate ? now : clock.frameTime + steps * interval;

  return {
    clock: {
      cursor: candidates[shownIndex],
      frameTime,
      window: timing === 'realtime' ? upcoming : undefined,
    },
    ended: false,
    upcoming,
    delay: Math.max(frameTime + interval - now, 1),
  };
}

function clampValue(val: number, max: number): number {
  return Math.min(Math.max(val, 0), max);
}

function toValues(frames: PlaybackCursor[]): number[] {
  return frames.map(({ value }) => value);
}
