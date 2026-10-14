import {
  resetGeometryWorker,
  useContours,
  useIsosurfaces,
  WorkerError,
} from '@h5web/lib';
import ndarray, { type NdArray } from 'ndarray';
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from 'vitest-browser-react';

function sphere(n: number, centre = (n - 1) / 2): NdArray<Float32Array> {
  const values = new Float32Array(n ** 3);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        values[k * n * n + j * n + i] = Math.hypot(
          i - centre,
          j - centre,
          k - centre,
        );
      }
    }
  }
  return ndarray(values, [n, n, n]);
}

function ramp(rows: number, cols: number): NdArray<Float64Array> {
  return ndarray(
    Float64Array.from({ length: rows * cols }, (_, i) => i % cols),
    [rows, cols],
  );
}

/* Worker whose script fails to load, like one blocked by a Content Security Policy */
function failingWorker(): Worker {
  return new Worker('/does-not-exist/geometry-worker.js');
}

/* Worker that starts, then crashes on the first message */
function crashingWorker(): Worker {
  const blob = new Blob(
    [
      'postMessage({ type: "ready" });',
      'addEventListener("message", () => { throw new Error("out of memory"); });',
    ],
    { type: 'text/javascript' },
  );
  return new Worker(URL.createObjectURL(blob));
}

interface IsoProps {
  data: NdArray<Float32Array>;
  levels: number[];
}

async function renderIsosurfaces(initialProps: IsoProps) {
  return renderHook(
    (props?: IsoProps) =>
      useIsosurfaces(props?.data ?? initialProps.data, props?.levels ?? []),
    { initialProps },
  );
}

afterEach(() => {
  resetGeometryWorker();
});

describe('useIsosurfaces', () => {
  it('extract surfaces in the worker and keep requested ones cached', async () => {
    const data = sphere(24);
    const { result, rerender } = await renderIsosurfaces({ data, levels: [5] });

    expect(result.current.geometries).toStrictEqual([undefined]);
    await expect.poll(() => result.current.geometries[0]?.level).toBe(5);
    expect(result.current.progress).toBeUndefined();
    expect(result.current.geometries[0]?.indices.length).toBeGreaterThan(0);

    // Add a level: the first surface is kept
    const [first] = result.current.geometries;
    await rerender({ data, levels: [5, 8] });
    expect(result.current.geometries[0]).toBe(first);
    await expect.poll(() => result.current.geometries[1]?.level).toBe(8);

    // Hide and show a level again: no new extraction (nor data copy)
    const [, second] = result.current.geometries;
    await rerender({ data, levels: [5] });
    await rerender({ data, levels: [5, 8] });
    expect(result.current.geometries[1]).toBe(second);
    expect(result.current.progress).toBeUndefined();

    // Hiding every level keeps the data and surfaces: showing them again is instant
    await rerender({ data, levels: [] });
    await rerender({ data, levels: [5, 8] });
    expect(result.current.geometries).toStrictEqual([first, second]);
  });

  it('only show surfaces of the latest levels and data', async () => {
    const data = sphere(32);
    const { result, rerender } = await renderIsosurfaces({ data, levels: [4] });

    // Change the level quickly, as when dragging a slider: stale extractions are cancelled
    await rerender({ data, levels: [6] });
    await rerender({ data, levels: [9] });
    await expect.poll(() => result.current.geometries[0]?.level).toBe(9);

    // Replace the data: surfaces of the previous array are not shown
    const shifted = sphere(32, 10);
    await rerender({ data: shifted, levels: [9] });
    expect(result.current.geometries).toStrictEqual([undefined]);
    await expect.poll(() => result.current.geometries[0]?.level).toBe(9);

    const { positions } = result.current.geometries[0] ?? {};
    const xs = positions?.filter((_, i) => i % 3 === 0) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(1, 0); // centred on 10, radius 9
  });

  it('extract small volumes on the main thread when the worker cannot load', async () => {
    resetGeometryWorker(failingWorker);

    const { result } = await renderIsosurfaces({
      data: sphere(16),
      levels: [5],
    });

    await expect.poll(() => result.current.geometries[0]?.level).toBe(5);
    expect(result.current.workerError).toBeInstanceOf(WorkerError);
    expect(result.current.workerError?.message).toMatch(/could not start/u);
    expect(result.current.error).toBeUndefined();
  });

  it('report an error when the worker cannot load and the volume is large', async () => {
    resetGeometryWorker(failingWorker);

    const { result } = await renderIsosurfaces({
      data: sphere(140), // more cells than allowed on the main thread
      levels: [50],
    });

    await expect
      .poll(() => result.current.error?.message)
      .toMatch(/too large to extract isosurfaces on the main thread/u);
    expect(result.current.progress).toBeUndefined();
    expect(result.current.geometries).toStrictEqual([undefined]);
  });

  it('give up on a worker that keeps crashing and fall back to the main thread', async () => {
    resetGeometryWorker(crashingWorker);

    const { result } = await renderIsosurfaces({
      data: sphere(16),
      levels: [5],
    });

    await expect
      .poll(() => result.current.workerError?.message, { timeout: 5000 })
      .toMatch(/crashed repeatedly/u);
    await expect.poll(() => result.current.geometries[0]?.level).toBe(5);
    expect(result.current.error).toBeUndefined();
    expect(result.current.progress).toBeUndefined();
  });
});

interface ContourProps {
  data: NdArray<Float64Array>;
  levels: number[];
}

describe('useContours', () => {
  it('compute contours of large images in the worker, for the current image only', async () => {
    const big = ramp(1100, 1000); // more cell visits than computed synchronously
    const { result, rerender } = await renderHook(
      (props?: ContourProps) =>
        useContours(props?.data ?? big, props?.levels ?? []),
      { initialProps: { data: big, levels: [100.5] } },
    );

    expect(result.current.contours).toBeUndefined();
    await expect.poll(() => result.current.contours?.[0]?.level).toBe(100.5);

    // New levels, same image: sent again? No, only the levels; previous contours stay until replaced
    await rerender({ data: big, levels: [200.5] });
    expect(result.current.contours?.[0]?.level).toBe(100.5);
    await expect.poll(() => result.current.contours?.[0]?.level).toBe(200.5);

    // Another image (e.g. the next slice), even of the same shape: previous contours are not drawn on it
    const other = ramp(1100, 1000);
    await rerender({ data: other, levels: [200.5] });
    expect(result.current.contours).toBeUndefined();
    await expect.poll(() => result.current.contours?.[0]?.level).toBe(200.5);

    // No levels: nothing to compute
    await rerender({ data: other, levels: [] });
    expect(result.current.contours).toStrictEqual([]);
    expect(result.current.error).toBeUndefined();
  });

  it('report an error when the worker cannot load and the image is too large', async () => {
    resetGeometryWorker(failingWorker);
    const huge = ramp(2100, 2000);

    const { result } = await renderHook(() =>
      useContours(huge, [1.5, 2.5, 3.5, 4.5]),
    );

    await expect
      .poll(() => result.current.error?.message)
      .toMatch(/could not start/u);
    expect(result.current.contours).toBeUndefined();
  });
});
