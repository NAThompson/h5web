import { describe, expect, it } from 'vitest';

import {
  getNextFrame,
  getPrefetchCount,
  getUpcomingFrames,
  initPlaybackClock,
  type PlaybackClock,
  type PlaybackMode,
  type PlaybackTiming,
  READY_POLL_INTERVAL,
  tickPlayback,
} from './playback';

function sequence(
  mode: PlaybackMode,
  length: number,
  start = 0,
  stride = 1,
  count = 10,
): number[] {
  return getUpcomingFrames(
    { value: start, direction: 1 },
    { length, stride, mode },
    count,
  ).map(({ value }) => value);
}

describe('getNextFrame', () => {
  it('should loop back to start', () => {
    expect(sequence('loop', 4, 1, 1, 6)).toStrictEqual([2, 3, 0, 1, 2, 3]);
  });

  it('should bounce between edges', () => {
    expect(sequence('bounce', 4, 1, 1, 8)).toStrictEqual([
      2, 3, 2, 1, 0, 1, 2, 3,
    ]);
  });

  it('should stop at the end in once mode', () => {
    expect(sequence('once', 4, 1)).toStrictEqual([2, 3]);
    expect(
      getNextFrame(
        { value: 3, direction: 1 },
        { length: 4, stride: 1, mode: 'once' },
      ),
    ).toBeUndefined();
  });

  it('should respect stride and always visit edges', () => {
    expect(sequence('loop', 10, 1, 3, 6)).toStrictEqual([4, 7, 9, 0, 3, 6]);
    expect(sequence('bounce', 10, 1, 3, 7)).toStrictEqual([
      4, 7, 9, 6, 3, 0, 3,
    ]);
    expect(sequence('once', 10, 1, 4)).toStrictEqual([5, 9]);
  });

  it('should not move in dimensions of length 1', () => {
    expect(sequence('loop', 1)).toStrictEqual([]);
    expect(sequence('bounce', 1)).toStrictEqual([]);
  });
});

describe('getPrefetchCount', () => {
  it('should prefetch about half a second ahead, within bounds', () => {
    expect(getPrefetchCount(1)).toBe(2);
    expect(getPrefetchCount(10)).toBe(5);
    expect(getPrefetchCount(60)).toBe(8);
  });
});

describe('initPlaybackClock', () => {
  it('should start from current value', () => {
    const clock = initPlaybackClock(
      2,
      { length: 5, stride: 1, mode: 'loop' },
      0,
    );
    expect(clock).toStrictEqual({
      cursor: { value: 2, direction: 1 },
      frameTime: 0,
    });
  });

  it('should restart from beginning when at the end in once mode', () => {
    const params = { length: 5, stride: 1, mode: 'once' } as const;
    expect(initPlaybackClock(4, params, 0).cursor.value).toBe(0);
    expect(
      initPlaybackClock(4, { ...params, mode: 'loop' }, 0).cursor.value,
    ).toBe(4);
  });
});

describe('tickPlayback', () => {
  const fps = 10; // 100 ms per frame

  function settings(
    timing: PlaybackTiming = 'wait',
    mode: PlaybackMode = 'loop',
  ) {
    return { fps, mode, timing, length: 20, stride: 1 };
  }

  const clock: PlaybackClock = {
    cursor: { value: 0, direction: 1 },
    frameTime: 0,
  };

  const allReady = () => true;

  it('should wait until next frame is due', () => {
    const res = tickPlayback(clock, 40, settings(), allReady);
    expect(res.clock).toBe(clock);
    expect(res.delay).toBe(60);
    expect(res.ended).toBe(false);
    expect(res.upcoming).toStrictEqual([1, 2, 3, 4, 5]);
  });

  it('should advance one frame when due and ready', () => {
    const res = tickPlayback(clock, 100, settings(), allReady);
    expect(res.clock.cursor.value).toBe(1);
    expect(res.clock.frameTime).toBe(100);
    expect(res.delay).toBe(100);
    expect(res.upcoming).toStrictEqual([2, 3, 4, 5, 6]);
  });

  it('should keep regular pace despite late ticks', () => {
    const res = tickPlayback(clock, 130, settings(), allReady);
    expect(res.clock.frameTime).toBe(100);
    expect(res.delay).toBe(70);
  });

  it('should wait for next frame to be ready', () => {
    const isReady = (val: number) => val !== 1;
    const res = tickPlayback(clock, 100, settings(), isReady);

    expect(res.clock).toBe(clock); // no advance
    expect(res.delay).toBe(READY_POLL_INTERVAL);
    expect(res.upcoming).toStrictEqual([1, 2, 3, 4, 5]); // keep prefetching next frame
  });

  it('should show every frame in wait mode, even when late', () => {
    const res = tickPlayback(clock, 550, settings('wait'), allReady);
    expect(res.clock.cursor.value).toBe(1);
    expect(res.clock.frameTime).toBe(550); // restart pace from when frame is shown
  });

  it('should skip frames to keep real time', () => {
    const res = tickPlayback(clock, 550, settings('realtime'), allReady);
    expect(res.clock.cursor.value).toBe(5);
    expect(res.clock.frameTime).toBe(500);
    expect(res.upcoming).toStrictEqual([6, 7, 8, 9, 10]);
  });

  it('should show furthest ready frame in real-time mode', () => {
    const isReady = (val: number) => val <= 3;
    const res = tickPlayback(clock, 550, settings('realtime'), isReady);
    expect(res.clock.cursor.value).toBe(3);
    expect(res.clock.frameTime).toBe(300);

    // Don't prefetch frames that are already late
    expect(res.upcoming).toStrictEqual([5, 6, 7, 8, 9]);
  });

  it('should not advance in real-time mode when no due frame is ready', () => {
    const isReady = (val: number) => val > 5;
    const res = tickPlayback(clock, 550, settings('realtime'), isReady);
    expect(res.clock).toBe(clock);
    expect(res.upcoming).toStrictEqual([5, 6, 7, 8, 9]);
  });

  it('should end after last frame in once mode', () => {
    const lastClock = {
      cursor: { value: 19, direction: 1 },
      frameTime: 0,
    } as const;
    expect(
      tickPlayback(lastClock, 50, settings('wait', 'once'), allReady).ended,
    ).toBe(false);

    const res = tickPlayback(
      lastClock,
      100,
      settings('wait', 'once'),
      allReady,
    );
    expect(res.ended).toBe(true);
    expect(res.upcoming).toStrictEqual([]);
  });

  it('should prefetch across loop and bounce boundaries', () => {
    const endClock = {
      cursor: { value: 18, direction: 1 },
      frameTime: 0,
    } as const;
    expect(
      tickPlayback(endClock, 0, settings('wait', 'loop'), allReady).upcoming,
    ).toStrictEqual([19, 0, 1, 2, 3]);
    expect(
      tickPlayback(endClock, 0, settings('wait', 'bounce'), allReady).upcoming,
    ).toStrictEqual([19, 18, 17, 16, 15]);
    expect(
      tickPlayback(endClock, 0, settings('wait', 'once'), allReady).upcoming,
    ).toStrictEqual([19]);
  });
});
