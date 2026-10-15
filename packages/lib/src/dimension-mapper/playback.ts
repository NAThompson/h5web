/* Pure state machine behind slice playback (see `usePlayback`).
 * Kept free of React and timers so it can be unit-tested deterministically. */

export type PlaybackMode = 'loop' | 'bounce' | 'once';

/* Value range (axis or colour domain) to use while playing:
 * - `sequence`: range of the whole sequence of slices being played, so it stays fixed;
 * - `frame`: range of each slice (autoscale). */
export type PlaybackRange = 'sequence' | 'frame';

export interface PlaybackSettings {
  fps: number;
  mode: PlaybackMode;
  range: PlaybackRange;
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  fps: 10,
  mode: 'loop',
  range: 'sequence',
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
  restart?: boolean; // `once` mode started on last frame: go back to first frame
}

export interface TickResult {
  clock: PlaybackClock;
  ended: boolean; // `once` mode reached the last frame
  waiting: boolean; // a frame is due but can't be shown yet (data not ready)
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
  const restart = params.mode === 'once' && value >= params.length - 1;
  return {
    cursor: { value, direction: 1 },
    frameTime: now,
    ...(restart && { restart }),
  };
}

/* When restarting in `once` mode, the sequence is the same as in `loop` mode until the end */
function getSequenceParams(
  clock: PlaybackClock,
  params: SequenceParams,
): SequenceParams {
  return clock.restart ? { ...params, mode: 'loop' } : params;
}

/* Advance the clock to `now`, showing every frame in turn. `isReady` tells whether a frame can
 * be shown without waiting for data. Frames are never shown before they are ready, so requests
 * can't pile up faster than data arrives. */
export function tickPlayback(
  clock: PlaybackClock,
  now: number,
  settings: Pick<PlaybackSettings, 'fps'> & SequenceParams,
  isReady: (value: number) => boolean,
): TickResult {
  const { fps, length } = settings;
  const interval = 1000 / clampFps(fps);
  const prefetchCount = getPrefetchCount(fps);
  const elapsed = now - clock.frameTime;

  // Next frame followed by frames to prefetch (when restarting, don't go round twice)
  const candidates = getUpcomingFrames(
    clock.cursor,
    getSequenceParams(clock, settings),
    clock.restart ? Math.min(prefetchCount + 1, length) : prefetchCount + 1,
  );
  const next = candidates.at(0);

  const isDue = elapsed >= interval;

  // Not due yet, or waiting for next frame to be ready
  if (!isDue || (next && !isReady(next.value))) {
    return {
      clock,
      ended: false,
      waiting: isDue,
      upcoming: toValues(candidates.slice(0, prefetchCount)),
      delay: isDue ? READY_POLL_INTERVAL : Math.max(interval - elapsed, 1),
    };
  }

  if (!next) {
    return { clock, ended: true, waiting: false, upcoming: [], delay: 0 };
  }

  // When late, restart pace from when the frame is shown
  const frameTime = elapsed >= 2 * interval ? now : clock.frameTime + interval;

  return {
    clock: { cursor: next, frameTime },
    ended: false,
    waiting: false,
    upcoming: toValues(candidates.slice(1)),
    delay: Math.max(frameTime + interval - now, 1),
  };
}

function clampValue(val: number, max: number): number {
  return Math.min(Math.max(val, 0), max);
}

function toValues(frames: PlaybackCursor[]): number[] {
  return frames.map(({ value }) => value);
}
