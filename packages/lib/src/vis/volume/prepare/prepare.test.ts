import { assertDefined } from '@h5web/shared/guards';
import { getBounds } from '@h5web/shared/vis-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getPreparedHalfFloats,
  prepareVolume,
  releasePreparedHalfFloats,
  setPrepareWorkerFactory,
} from './client';
import {
  getFloat32Bounds,
  getHalfFloatNormalization,
  mergeBounds,
  toHalfFloatBits,
} from './utils';
import { type PrepareRequest, type PrepareResponse } from './worker';

function randomValues(length: number): Float32Array {
  const values = Float32Array.from(
    { length },
    (_, i) => Math.sin(i * 12.9898) * 1e4 - 2000,
  );
  values[3] = Number.NaN;
  values[7] = Infinity;
  values[11] = -Infinity;
  values[13] = 0;
  return values;
}

describe('getFloat32Bounds', () => {
  it('should match `getBounds`', () => {
    const values = randomValues(1000);
    expect(getFloat32Bounds(values)).toStrictEqual(getBounds(values));

    const positive = Float32Array.from([Infinity, 3, Number.NaN, 0.5]);
    expect(getFloat32Bounds(positive)).toStrictEqual(getBounds(positive));

    const negative = Float32Array.from([-3, -0.5, Infinity]);
    expect(getFloat32Bounds(negative)).toStrictEqual(getBounds(negative));
  });

  it('should return `undefined` if there are no finite values', () => {
    expect(
      getFloat32Bounds(Float32Array.from([Number.NaN, Infinity])),
    ).toBeUndefined();
    expect(getFloat32Bounds(new Float32Array(0))).toBeUndefined();
  });
});

describe('mergeBounds', () => {
  it('should merge bounds of parts', () => {
    const values = randomValues(1000);
    const parts = [
      values.subarray(0, 10),
      values.subarray(10, 600),
      Float32Array.from([Number.NaN]),
      values.subarray(600),
    ];
    expect(mergeBounds(parts.map(getFloat32Bounds))).toStrictEqual(
      getBounds(values),
    );
    expect(mergeBounds([undefined])).toBeUndefined();
  });
});

describe('toHalfFloatBits', () => {
  it('should normalize values over bounds', () => {
    const values = Float32Array.from([10, 12, Number.NaN, 14, -Infinity]);
    const normalization = getHalfFloatNormalization(getFloat32Bounds(values));
    expect(normalization).toStrictEqual({ offset: 10, scale: 4 });

    const halfFloats = new Float16Array(
      toHalfFloatBits(values, normalization).buffer,
    );
    expect([...halfFloats]).toStrictEqual([0, 0.5, Number.NaN, 1, -Infinity]);
  });

  it('should not scale constant or empty volumes', () => {
    expect(
      getHalfFloatNormalization(getFloat32Bounds(Float32Array.from([5, 5]))),
    ).toStrictEqual({ offset: 5, scale: 1 });
    expect(getHalfFloatNormalization(undefined)).toStrictEqual({
      offset: 0,
      scale: 1,
    });
  });
});

/* Runs the worker's logic in the same thread */
class FakeWorker extends EventTarget {
  public static instances = 0;
  public static failing = false;

  private part: Float32Array | undefined;

  public constructor() {
    super();
    FakeWorker.instances += 1;
  }

  public postMessage(msg: PrepareRequest): void {
    queueMicrotask(() => {
      if (FakeWorker.failing) {
        this.dispatchEvent(
          Object.assign(new Event('error'), { message: 'blocked' }),
        );
        return;
      }

      let response: PrepareResponse;
      if (msg.type === 'bounds') {
        this.part = new Float32Array(msg.buffer);
        response = { type: 'bounds', bounds: getFloat32Bounds(this.part) };
      } else {
        const { buffer } = toHalfFloatBits(
          this.part!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          msg.normalization,
        );
        response = { type: 'halfFloats', buffer };
      }
      this.dispatchEvent(new MessageEvent('message', { data: response }));
    });
  }

  public terminate(): void {
    // nothing to do
  }
}

describe('prepareVolume', () => {
  afterEach(() => {
    FakeWorker.instances = 0;
    FakeWorker.failing = false;
    vi.restoreAllMocks();
  });

  setPrepareWorkerFactory(() => new FakeWorker() as unknown as Worker);

  it('should compute bounds in workers', async () => {
    const values = randomValues(2 ** 24 + 1000); // 2 parts
    const prepared = await prepareVolume(values);

    expect(FakeWorker.instances).toBeGreaterThan(1);
    expect(prepared.bounds).toStrictEqual(getBounds(values));
    expect(prepared.halfFloats).toBeUndefined(); // small enough for 32-bit float texture

    // Same promise for same array
    expect(prepareVolume(values)).toBe(prepareVolume(values));
  });

  it('should prepare half floats for volumes larger than 1 GiB', async () => {
    const values = new Float32Array(2 ** 28 + 16);
    values[0] = -1;
    values[values.length - 1] = 3;
    values[2 ** 27] = Number.NaN;

    const prepared = await prepareVolume(values);
    expect(prepared.bounds).toMatchObject({ min: -1, max: 3 });

    const halfFloats = getPreparedHalfFloats(values);
    assertDefined(halfFloats);
    expect(halfFloats).toMatchObject({ offset: -1, scale: 4 });
    const floats = new Float16Array(halfFloats.values.buffer);
    expect(floats[0]).toBe(0);
    expect(floats[1]).toBe(0.25);
    expect(floats[2 ** 27]).toBeNaN();
    expect(floats.at(-1)).toBe(1);

    releasePreparedHalfFloats(values);
    expect(getPreparedHalfFloats(values)).toBeUndefined();
    const preparedAgain = await prepareVolume(values);
    expect(preparedAgain.halfFloats).toBeUndefined();
  });

  it('should fall back to main thread if workers fail', async () => {
    FakeWorker.failing = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const values = randomValues(2 ** 24);
    const prepared = await prepareVolume(values);
    expect(prepared.bounds).toStrictEqual(getBounds(values));
    expect(console.warn).toHaveBeenCalledOnce(); // eslint-disable-line no-console
  });
});
