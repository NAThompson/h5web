import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerResponse } from './models';
import { getWorkerState, handleRequest } from './worker';

function sphere(n: number): Float32Array {
  const c = (n - 1) / 2;
  const values = new Float32Array(n ** 3);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        values[k * n * n + j * n + i] = Math.hypot(i - c, j - c, k - c);
      }
    }
  }
  return values;
}

let messages: WorkerResponse[] = [];

beforeEach(() => {
  messages = [];
  vi.stubGlobal('postMessage', (msg: WorkerResponse) => {
    messages.push(msg);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (let dataId = 1; dataId < 100; dataId += 1) {
    handleRequest({ type: 'releaseData', dataId });
  }
});

function responsesFor(jobId: number): WorkerResponse[] {
  return messages.filter((msg) => 'jobId' in msg && msg.jobId === jobId);
}

describe('geometry worker protocol', () => {
  it('should resample fields of a registered mesh', async () => {
    // Corner tetrahedron of the unit cube, sampled every 0.5
    handleRequest({
      type: 'setMesh',
      dataId: 2,
      mesh: {
        points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
        connectivity: [0, 1, 2, 3],
        offsets: [0, 4],
        types: [10],
      },
    });
    const grid = { shape: [3, 3, 3], min: [0, 0, 0], max: [1, 1, 1] } as const;

    for (const [jobId, values] of [
      [20, [0, 1, 2, 3]],
      [21, [1, 1, 1, 1]],
    ] as const) {
      handleRequest({
        type: 'resample',
        jobId,
        dataId: 2,
        field: { values: [...values], association: 'point', components: 1 },
        grid: {
          shape: [...grid.shape],
          min: [...grid.min],
          max: [...grid.max],
        },
      });
    }

    await vi.waitFor(() => {
      expect(responsesFor(21).at(-1)?.type).toBe('resampled');
    });
    const [first, second] = [20, 21].map((jobId) => {
      const msg = responsesFor(jobId).at(-1);
      return msg?.type === 'resampled' ? msg.values : undefined;
    });
    expect(first?.[(0 * 3 + 1) * 3 + 1]).toBe(1.5); // (0.5, 0.5, 0): 0.5 + 2 × 0.5
    expect(first?.[26]).toBeNaN(); // (1, 1, 1)
    expect(second?.filter(Number.isFinite)).toHaveLength(10);
  });

  it('should extract isosurfaces of registered data', async () => {
    handleRequest({
      type: 'setData',
      dataId: 1,
      values: sphere(16),
      shape: [16, 16, 16],
    });
    expect(getWorkerState().dataCount).toBe(1);

    handleRequest({
      type: 'isosurface',
      jobId: 10,
      dataId: 1,
      level: 5,
      scaleType: undefined,
      step: 1,
    });

    await vi.waitFor(() => {
      expect(responsesFor(10).at(-1)?.type).toBe('isosurface');
    });
    const result = responsesFor(10).at(-1);
    expect(result?.type).toBe('isosurface');
    expect(
      result?.type === 'isosurface' ? result.geometry.indices.length : 0,
    ).toBeGreaterThan(0);
  });

  it('should compute contours of registered 2D data, several times', async () => {
    const values = Float64Array.from({ length: 100 }, (_, i) => i % 10);
    handleRequest({ type: 'setData', dataId: 2, values, shape: [10, 10] });

    handleRequest({
      type: 'contours',
      jobId: 20,
      dataId: 2,
      levels: [2.5, 6.5],
      scaleType: undefined,
      labels: undefined,
    });
    handleRequest({
      type: 'contours',
      jobId: 21,
      dataId: 2,
      levels: [4.5],
      scaleType: undefined,
      labels: undefined,
    });

    await vi.waitFor(() => {
      expect(responsesFor(21).at(-1)?.type).toBe('contours');
    });
    const first = responsesFor(20).at(-1);
    const second = responsesFor(21).at(-1);
    expect(first?.type === 'contours' && first.contours).toHaveLength(2);
    expect(second?.type === 'contours' && second.contours).toHaveLength(1);
  });

  it('should drop cancelled jobs, including queued ones', async () => {
    handleRequest({
      type: 'setData',
      dataId: 3,
      values: sphere(64),
      shape: [64, 64, 64],
    });

    for (const jobId of [30, 31, 32]) {
      handleRequest({
        type: 'isosurface',
        jobId,
        dataId: 3,
        level: 20,
        scaleType: undefined,
        step: 1,
      });
    }
    // 30 is running (until its first slice ends), 31 is queued
    handleRequest({ type: 'cancel', jobId: 30 });
    handleRequest({ type: 'cancel', jobId: 31 });

    await vi.waitFor(
      () => {
        expect(responsesFor(32).at(-1)?.type).toBe('isosurface');
      },
      { timeout: 5000 },
    );
    expect(responsesFor(31)).toHaveLength(0);
    expect(responsesFor(30).some((msg) => msg.type === 'isosurface')).toBe(
      false,
    );
    expect(getWorkerState().queued).toBe(0);
  });

  it('should report errors for released or mismatched data', async () => {
    handleRequest({
      type: 'setData',
      dataId: 4,
      values: new Float64Array(4),
      shape: [2, 2],
    });

    handleRequest({
      type: 'isosurface',
      jobId: 40,
      dataId: 4,
      level: 0,
      scaleType: undefined,
      step: 1,
    });
    handleRequest({ type: 'releaseData', dataId: 4 });
    handleRequest({
      type: 'contours',
      jobId: 41,
      dataId: 4,
      levels: [0],
      scaleType: undefined,
      labels: undefined,
    });

    await vi.waitFor(() => {
      expect(responsesFor(41)).toHaveLength(1);
    });
    expect(responsesFor(40)).toStrictEqual([
      { type: 'error', jobId: 40, message: 'Expected 3D data' },
    ]);
    expect(responsesFor(41)).toStrictEqual([
      { type: 'error', jobId: 41, message: 'Data no longer available' },
    ]);
  });
});
