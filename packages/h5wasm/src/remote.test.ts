import { describe, expect, it, vi } from 'vitest';

import { createLazyRemote } from './remote';

describe('createLazyRemote', () => {
  it('should reject calls when worker fails to load, then retry', async () => {
    const loadWorker = vi
      .fn<() => Promise<Worker>>()
      .mockRejectedValue(new Error('Failed to fetch chunk'));

    const remote = createLazyRemote(loadWorker);

    await expect(remote.closeFile(1n)).rejects.toThrow('Failed to fetch chunk');
    await expect(remote.closeFile(1n)).rejects.toThrow('Failed to fetch chunk');
    expect(loadWorker).toHaveBeenCalledTimes(2); // failure not cached
  });

  it('should not be thenable', async () => {
    const remote = createLazyRemote(vi.fn());
    expect('then' in remote && remote.then).toBe(false);
  });
});
