import { assertDefined } from '@h5web/shared/guards';
// eslint-disable-next-line import-x/no-namespace -- same as `worker.ts`
import * as h5wasm from 'h5wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDirectRead,
  copyChunkSelection,
  executeDirectRead,
  planDirectRead,
  type RangeReader,
} from './direct-read';

const FILE_NAME = 'direct-read.test.h5';
const SHAPE = [20, 30, 40];
const SIZE = SHAPE[0] * SHAPE[1] * SHAPE[2];
const VALUES = Float32Array.from({ length: SIZE }, (_, i) => i - 100.5);

let file: h5wasm.File;
let reader: RangeReader;
let reads: [number, number][] = [];

beforeAll(async () => {
  const { FS } = await h5wasm.ready;

  const f = new h5wasm.File(FILE_NAME, 'w');
  f.create_dataset({ name: 'contiguous', data: VALUES, shape: SHAPE });
  f.create_dataset({
    name: 'chunked',
    data: VALUES,
    shape: SHAPE,
    chunks: [7, 16, 9], // partial edge chunks along every dimension
  });
  f.create_dataset({
    name: 'slabs', // chunks spanning entire trailing dimensions, as in image stacks
    data: VALUES,
    shape: SHAPE,
    chunks: [3, 30, 40],
  });
  f.create_dataset({
    name: 'int16_4d',
    data: Int16Array.from(
      { length: 3 * SIZE },
      (_, i) => (i % 60_000) - 30_000,
    ),
    shape: [3, ...SHAPE],
    chunks: [1, 10, 30, 40],
  });
  f.create_dataset({
    name: 'int64',
    data: BigInt64Array.from({ length: SIZE }, (_, i) => BigInt(i) * 3n ** 30n),
    shape: SHAPE,
    chunks: [5, 30, 40],
  });
  f.create_dataset({
    name: 'compressed',
    data: VALUES,
    shape: SHAPE,
    chunks: [5, 30, 40],
    compression: 'gzip',
  });
  f.create_dataset({
    name: 'unallocated', // first chunk only, after resizing
    data: VALUES.subarray(0, 5 * 30 * 40),
    shape: [5, 30, 40],
    maxshape: SHAPE,
    chunks: [5, 30, 40],
  }).resize(SHAPE);
  f.close();

  const bytes = FS.readFile(FILE_NAME);
  reader = {
    readRange: async (start, end, dest) => {
      reads.push([start, end]);
      dest.set(bytes.subarray(start, end));
    },
  };

  file = new h5wasm.File(FILE_NAME, 'r');
});

afterAll(async () => {
  file?.close(); // eslint-disable-line @typescript-eslint/no-unnecessary-condition
  const { FS } = await h5wasm.ready;
  FS.unlink(FILE_NAME);
});

function getDataset(name: string): h5wasm.Dataset {
  return file.get(name) as h5wasm.Dataset;
}

async function readDirectly(
  name: string,
  ranges: [number, number][],
  maxRequestBytes?: number,
) {
  const dataset = getDataset(name);
  const plan = planDirectRead(dataset, ranges, {
    minBytes: 0,
    maxRequestBytes,
  });
  if (!plan) {
    return undefined;
  }

  reads = [];
  const value = await executeDirectRead(plan, reader);
  return { value, expected: dataset.slice(ranges), plan };
}

describe('direct reads', () => {
  // Selections, and whether they can be read directly from each dataset
  // (not if requiring too many small requests, or fetching much more than selected)
  const selections: [[number, number][], Record<string, boolean>][] = [
    [
      SHAPE.map((dim) => [0, dim]),
      { contiguous: true, chunked: true, slabs: true },
    ],
    [
      [
        [0, 1],
        [0, 30],
        [0, 40],
      ],
      { contiguous: true, chunked: false, slabs: true },
    ],
    [
      [
        [13, 14],
        [0, 30],
        [0, 40],
      ],
      { contiguous: true, chunked: false, slabs: true },
    ],
    [
      [
        [0, 20],
        [11, 12],
        [0, 40],
      ],
      { contiguous: false, chunked: false, slabs: false },
    ],
    [
      [
        [2, 19],
        [3, 29],
        [5, 38],
      ],
      { contiguous: false, chunked: false, slabs: false },
    ],
    [
      [
        [0, 14],
        [0, 16],
        [0, 36],
      ],
      { contiguous: false, chunked: true, slabs: false },
    ],
    [
      [
        [7, 14],
        [0, 30],
        [0, 40],
      ],
      { contiguous: true, chunked: true, slabs: true },
    ],
  ];

  const cases = ['contiguous', 'chunked', 'slabs'].flatMap((name) =>
    selections.map(
      ([ranges, canReadDirectly]) =>
        [name, JSON.stringify(ranges), ranges, canReadDirectly[name]] as const,
    ),
  );

  it.each(cases.filter((testCase) => testCase[3]))(
    'should read %s datasets like HDF5 (selection %s)',
    async (name, _, ranges) => {
      const result = await readDirectly(name, ranges);
      assertDefined(result);
      expect(result.value).toBeInstanceOf(Float32Array);
      expect(result.value).toEqual(result.expected);
    },
  );

  it.each(cases.filter((testCase) => !testCase[3]))(
    'should leave %s datasets to HDF5 (selection %s)',
    (name, _, ranges) => {
      expect(
        planDirectRead(getDataset(name), ranges, { minBytes: 0 }),
      ).toBeUndefined();
    },
  );

  it('should read chunks spanning trailing dimensions in place', async () => {
    const result = await readDirectly(
      'slabs',
      SHAPE.map((dim) => [0, dim]),
    );
    expect(result?.plan.ops.every((op) => op.outPos !== undefined)).toBe(true);
    expect(reads).toHaveLength(Math.ceil(SHAPE[0] / 3));
  });

  it('should split large reads into several requests', async () => {
    const result = await readDirectly(
      'contiguous',
      SHAPE.map((dim) => [0, dim]),
      10_000,
    );
    expect(result?.value).toEqual(result?.expected);
    expect(reads).toHaveLength(Math.ceil((SIZE * 4) / 10_000));
  });

  it.each([
    [
      [1, 2],
      [0, 20],
      [0, 30],
      [0, 40],
    ],
    [
      [0, 3],
      [10, 20],
      [0, 30],
      [0, 40],
    ],
  ] satisfies [number, number][][])(
    'should read slices of 4D integer datasets',
    async (...ranges) => {
      const result = await readDirectly('int16_4d', ranges);
      expect(result?.value).toBeInstanceOf(Int16Array);
      expect(result?.value).toEqual(result?.expected);
    },
  );

  it('should read 64-bit integers as bigints', async () => {
    const result = await readDirectly(
      'int64',
      SHAPE.map((dim) => [0, dim]),
    );
    expect(result?.value).toBeInstanceOf(BigInt64Array);
    expect(result?.value).toEqual(result?.expected);
  });

  it('should leave datasets that need decoding to HDF5', () => {
    const all = SHAPE.map<[number, number]>((dim) => [0, dim]);
    const opts = { minBytes: 0 };
    expect(planDirectRead(getDataset('compressed'), all, opts)).toBeUndefined();
    expect(
      planDirectRead(getDataset('unallocated'), all, opts),
    ).toBeUndefined();

    // h5wasm can't write big-endian datasets, so fake one
    const slabs = getDataset('slabs');
    const bigEndian = {
      metadata: { ...slabs.metadata, littleEndian: false },
      storage: slabs.storage,
    } as unknown as h5wasm.Dataset;
    expect(planDirectRead(slabs, all, { minBytes: 0 })).toBeDefined();
    expect(planDirectRead(bigEndian, all, { minBytes: 0 })).toBeUndefined();
  });

  it('should leave small selections to HDF5', () => {
    const all = SHAPE.map<[number, number]>((dim) => [0, dim]);
    expect(planDirectRead(getDataset('chunked'), all)).toBeUndefined();
  });

  it('should avoid reading much more than selected', () => {
    // A single row of `slabs` would require fetching entire chunks
    const row: [number, number][] = [
      [0, 20],
      [4, 5],
      [6, 7],
    ];
    expect(
      planDirectRead(getDataset('slabs'), row, { minBytes: 0 }),
    ).toBeUndefined();
  });

  it('should check values against HDF5', async () => {
    const ranges = SHAPE.map<[number, number]>((dim) => [0, dim]);
    const result = await readDirectly('chunked', ranges);
    assertDefined(result);
    const { value } = result;

    expect(checkDirectRead(getDataset('chunked'), ranges, value)).toBe(true);

    const corrupted = Float32Array.from(value as Float32Array);
    corrupted[corrupted.length - 1] += 1;
    expect(checkDirectRead(getDataset('chunked'), ranges, corrupted)).toBe(
      false,
    );
  });

  it('should abort pending requests', async () => {
    const plan = planDirectRead(
      getDataset('slabs'),
      SHAPE.map((dim) => [0, dim]),
      { minBytes: 0 },
    );
    assertDefined(plan);

    const controller = new AbortController();
    const slowReader: RangeReader = {
      readRange: async (_start, _end, _dest, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('cancelled'));
          });
        }),
    };

    const promise = executeDirectRead(plan, slowReader, controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow('cancelled');
  });

  it('should fail if any request fails', async () => {
    const plan = planDirectRead(
      getDataset('slabs'),
      SHAPE.map((dim) => [0, dim]),
      { minBytes: 0 },
    );
    assertDefined(plan);

    let count = 0;
    const flakyReader: RangeReader = {
      readRange: async (start, end, dest, signal) => {
        count += 1;
        if (count === 3) {
          throw new Error('network error');
        }
        return reader.readRange(start, end, dest, signal);
      },
    };

    await expect(executeDirectRead(plan, flakyReader)).rejects.toThrow(
      'network error',
    );
  });
});

describe('copyChunkSelection', () => {
  it('should copy the intersection of a chunk with the selection', () => {
    // 4x4 dataset of bytes, chunk [2, 3] at offset [2, 3] (clipped to [2, 1]), select rows 1-3, cols 2-3
    const chunk = Uint8Array.from([1, 2, 3, 4, 5, 6]); // 2 x 3
    const out = new Uint8Array(3 * 2);
    copyChunkSelection(
      chunk,
      { offset: [2, 3], shape: [2, 3] },
      out,
      [1, 2],
      [3, 2],
      1,
    );
    // Only column 3 of rows 2-3 falls in both: chunk values 1 and 4
    expect([...out]).toEqual([0, 0, 0, 1, 0, 4]);
  });
});
