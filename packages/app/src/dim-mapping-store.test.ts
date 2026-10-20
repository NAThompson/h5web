import { DEFAULT_PLAYBACK_SETTINGS } from '@h5web/lib';
import { expect, test } from 'vitest';

import { sanitizePlaybackSettings } from './dim-mapping-store';

test('keep valid playback settings, with the range of the whole sequence', () => {
  expect(
    sanitizePlaybackSettings({ fps: 25, mode: 'bounce', range: 'frame' }),
  ).toStrictEqual({ fps: 25, mode: 'bounce', range: 'sequence' });
});

test('clamp speed and replace invalid playback settings with defaults', () => {
  expect(
    sanitizePlaybackSettings({ fps: 1000, mode: 'shuffle', range: 42 }),
  ).toStrictEqual({ ...DEFAULT_PLAYBACK_SETTINGS, fps: 60 });

  expect(sanitizePlaybackSettings({ fps: 0 }).fps).toBe(0.5);
  expect(sanitizePlaybackSettings({ fps: Number.NaN }).fps).toBe(10);
  expect(sanitizePlaybackSettings(undefined)).toStrictEqual(
    DEFAULT_PLAYBACK_SETTINGS,
  );
  expect(sanitizePlaybackSettings('fast')).toStrictEqual(
    DEFAULT_PLAYBACK_SETTINGS,
  );
});

test('drop obsolete playback settings', () => {
  expect(
    sanitizePlaybackSettings({ fps: 25, timing: 'realtime' }),
  ).toStrictEqual({ ...DEFAULT_PLAYBACK_SETTINGS, fps: 25 });
});
