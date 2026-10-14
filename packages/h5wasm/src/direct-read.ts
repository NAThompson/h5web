import { H5T_CLASS } from '@h5web/shared/h5t';
import { type BigIntTypedArray } from '@h5web/shared/vis-models';
import { type Dataset as H5WasmDataset } from 'h5wasm';

import { checkFileVersion, type FileVersion } from './lazy-file';

/*
 * Large numeric selections of unfiltered datasets are read straight from the file, bypassing
 * HDF5: the location of the raw data (contiguous offset, or address of each chunk) is obtained
 * from h5wasm, and the corresponding byte ranges are fetched concurrently (asynchronously) into
 * the output array. This is several times faster than HDF5's sequential, synchronous reads
 * (e.g. ~1.1 GB/s instead of ~350 MB/s for a local range server). Anything that requires
 * decoding (filters, non-native byte order, unusual types) still goes through HDF5.
 */

export const MIN_DIRECT_READ_BYTES = 16 * 1024 * 1024; // smaller selections are read with HDF5
export const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const READ_CONCURRENCY = 4;
const MAX_READ_AMPLIFICATION = 1.5; // max ratio of bytes fetched to bytes selected
const MIN_AVG_RUN_BYTES = 64 * 1024; // contiguous layout: avoid many tiny requests

export type DirectValue =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigIntTypedArray;
type DirectValueConstructor = new (buffer: ArrayBuffer) => DirectValue;

/* Reads byte range `[start, end)` of the file into `dest` (of length `end - start`) */
export interface RangeReader {
  readRange: (
    start: number,
    end: number,
    dest: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<void>;
}

export function createUrlReader(
  url: string,
  size: number,
  version: FileVersion,
): RangeReader {
  return {
    readRange: async (start, end, dest, signal) => {
      const range = `${start}-${end - 1}`;
      const response = await fetch(url, {
        headers: { Range: `bytes=${range}` },
        signal,
      });

      if (response.status !== 206 || !response.body) {
        await response.body?.cancel();
        throw new Error(
          `Expected partial content (206) when fetching range ${range} of ${url}, got status ${response.status}`,
        );
      }

      checkFileVersion(url, size, version, start, end, (name) =>
        response.headers.get(name),
      );

      // Stream body straight into destination
      const reader = response.body.getReader();
      let offset = 0;
      for (;;) {
        const { done, value } = await reader.read(); // eslint-disable-line no-await-in-loop
        if (done) {
          break;
        }
        if (offset + value.length > dest.length) {
          await reader.cancel(); // eslint-disable-line no-await-in-loop
          throw new Error(`Too many bytes when fetching range ${range}`);
        }
        dest.set(value, offset);
        offset += value.length;
      }

      if (offset !== dest.length) {
        throw new Error(
          `Expected ${dest.length} bytes when fetching range ${range} of ${url}, got ${offset}`,
        );
      }
    },
  };
}

export function createBlobReader(blob: Blob): RangeReader {
  return {
    readRange: async (start, end, dest, signal) => {
      signal?.throwIfAborted();
      const buffer = await blob.slice(start, end).arrayBuffer();
      signal?.throwIfAborted();
      if (buffer.byteLength !== dest.length) {
        throw new Error(`Could not read bytes ${start}-${end - 1} of file`);
      }
      dest.set(new Uint8Array(buffer));
    },
  };
}

/* One read from the file: `length` bytes at file position `filePos`, either read in place
 * at byte offset `outPos` of the output, or into a temporary buffer from which the selected
 * part of `chunk` is then copied to the output. */
interface ReadOp {
  filePos: number;
  length: number;
  outPos?: number;
  chunk?: { offset: number[]; shape: number[] };
}

export interface DirectReadPlan {
  ops: ReadOp[];
  itemSize: number;
  outShape: number[]; // selected size along each dimension
  outStart: number[]; // start of selection along each dimension
  totalBytes: number; // bytes fetched
  Constructor: DirectValueConstructor;
}

function getConstructor(
  type: number,
  size: number,
  signed: boolean,
): DirectValueConstructor | undefined {
  /* eslint-disable @typescript-eslint/no-unsafe-enum-comparison -- h5wasm types the class as a plain number */
  if (type === H5T_CLASS.INTEGER) {
    switch (size) {
      case 1:
        return signed ? Int8Array : Uint8Array;
      case 2:
        return signed ? Int16Array : Uint16Array;
      case 4:
        return signed ? Int32Array : Uint32Array;
      case 8:
        return signed ? BigInt64Array : BigUint64Array;
      default:
        return undefined;
    }
  }

  if (type === H5T_CLASS.FLOAT) {
    // Half floats are left to h5wasm, which checks that they are IEEE binary16
    return size === 4 ? Float32Array : size === 8 ? Float64Array : undefined;
  }
  /* eslint-enable @typescript-eslint/no-unsafe-enum-comparison */

  return undefined;
}

function product(values: number[]): number {
  return values.reduce((acc, val) => acc * val, 1);
}

/* Plan a direct read of `ranges` (`[start, stop)` along each dimension) of a dataset,
 * or return `undefined` if it should be read with HDF5. */
export function planDirectRead(
  h5wDataset: H5WasmDataset,
  ranges: [number, number][],
  opts: { minBytes?: number; maxRequestBytes?: number } = {},
): DirectReadPlan | undefined {
  const {
    minBytes = MIN_DIRECT_READ_BYTES,
    maxRequestBytes = MAX_REQUEST_BYTES,
  } = opts;

  if (!('storage' in h5wDataset)) {
    return undefined; // h5wasm too old to report where data is stored
  }

  const { type, size, signed, littleEndian, shape } = h5wDataset.metadata;
  const Constructor = getConstructor(type, size, signed);
  if (
    !Constructor ||
    !littleEndian ||
    !shape ||
    shape.length === 0 ||
    shape.length !== ranges.length
  ) {
    return undefined;
  }

  const outShape = ranges.map(([start, stop]) => stop - start);
  const outStart = ranges.map(([start]) => start);
  const selectedBytes = product(outShape) * size;
  if (selectedBytes < minBytes) {
    return undefined;
  }

  const { storage } = h5wDataset;
  if (storage.nfilters > 0) {
    return undefined;
  }

  const base = { itemSize: size, outShape, outStart, Constructor };

  if (storage.layout === 'contiguous' && storage.offset !== null) {
    if (storage.storage_size < product(shape) * size) {
      return undefined; // not (fully) allocated
    }

    const ops = planContiguous(
      storage.offset,
      shape,
      ranges,
      size,
      maxRequestBytes,
    );
    return ops && { ...base, ops, totalBytes: selectedBytes };
  }

  if (storage.layout === 'chunked' && storage.chunks) {
    const plan = planChunked(
      storage.chunks,
      shape,
      ranges,
      size,
      maxRequestBytes,
    );
    return plan && plan.totalBytes <= selectedBytes * MAX_READ_AMPLIFICATION
      ? { ...base, ...plan }
      : undefined;
  }

  return undefined;
}

function planContiguous(
  fileOffset: number,
  shape: number[],
  ranges: [number, number][],
  itemSize: number,
  maxRequestBytes: number,
): ReadOp[] | undefined {
  const rank = shape.length;

  // Trailing dimensions that are selected in full form contiguous runs together with
  // the innermost partially-selected dimension
  let runDim = rank - 1;
  while (
    runDim > 0 &&
    ranges[runDim][0] === 0 &&
    ranges[runDim][1] === shape[runDim]
  ) {
    runDim -= 1;
  }

  const innerItems = product(shape.slice(runDim + 1));
  const runItems = (ranges[runDim][1] - ranges[runDim][0]) * innerItems;
  const runBytes = runItems * itemSize;
  const runCount = product(
    ranges.slice(0, runDim).map(([start, stop]) => stop - start),
  );

  if (runBytes < MIN_AVG_RUN_BYTES && runCount > 1) {
    return undefined;
  }

  const strides = shape.map((_, i) => product(shape.slice(i + 1)));
  const ops: ReadOp[] = [];
  const index = ranges.slice(0, runDim).map(([start]) => start);

  for (let run = 0; run < runCount; run += 1) {
    const firstItem =
      index.reduce((acc, idx, i) => acc + idx * strides[i], 0) +
      ranges[runDim][0] * strides[runDim];
    const filePos = fileOffset + firstItem * itemSize;
    const outPos = run * runBytes;

    for (let pos = 0; pos < runBytes; pos += maxRequestBytes) {
      ops.push({
        filePos: filePos + pos,
        outPos: outPos + pos,
        length: Math.min(maxRequestBytes, runBytes - pos),
      });
    }

    // Increment multi-dimensional index (last dimension fastest)
    for (let i = runDim - 1; i >= 0; i -= 1) {
      index[i] += 1;
      if (index[i] < ranges[i][1]) {
        break;
      }
      [index[i]] = ranges[i];
    }
  }

  return ops;
}

function planChunked(
  chunks: NonNullable<H5WasmDataset['storage']['chunks']>,
  shape: number[],
  ranges: [number, number][],
  itemSize: number,
  maxRequestBytes: number,
): Pick<DirectReadPlan, 'ops' | 'totalBytes'> | undefined {
  const rank = shape.length;
  const chunkShape = chunks.shape;
  const chunkBytes = product(chunkShape) * itemSize;
  const gridShape = shape.map((dim, i) => Math.ceil(dim / chunkShape[i]));

  // Index allocated chunks by their position in the chunk grid
  const byGridIndex = new Map<number, number>();
  for (let c = 0; c < chunks.addrs.length; c += 1) {
    if (chunks.sizes[c] !== chunkBytes) {
      return undefined; // shouldn't happen for unfiltered chunks
    }
    let gridIndex = 0;
    for (let d = 0; d < rank; d += 1) {
      gridIndex =
        gridIndex * gridShape[d] +
        Math.floor(chunks.offsets[c * rank + d] / chunkShape[d]);
    }
    byGridIndex.set(gridIndex, c);
  }

  // Selected chunks along each dimension
  const firstChunk = ranges.map(([start], d) =>
    Math.floor(start / chunkShape[d]),
  );
  const lastChunk = ranges.map(([, stop], d) =>
    Math.floor((stop - 1) / chunkShape[d]),
  );

  // Whether chunks map to contiguous bytes of the output, so they can be read in place:
  // all dimensions but the first must be selected in full and fit in a single chunk
  const outShape = ranges.map(([start, stop]) => stop - start);
  const inPlace = ranges.every(
    ([start, stop], d) =>
      d === 0 ||
      (start === 0 && stop === shape[d] && chunkShape[d] === shape[d]),
  );
  const rowBytes = product(outShape.slice(1)) * itemSize;

  const ops: ReadOp[] = [];
  let totalBytes = 0;
  const gridPos = [...firstChunk];
  for (;;) {
    const gridIndex = gridPos.reduce((acc, p, d) => acc * gridShape[d] + p, 0);
    const c = byGridIndex.get(gridIndex);
    if (c === undefined) {
      return undefined; // unallocated chunk (fill value): let HDF5 handle it
    }

    const offset = gridPos.map((p, d) => p * chunkShape[d]);
    const addr = chunks.addrs[c];

    if (inPlace) {
      // Rows of the chunk that fall within the selection (along first dimension)
      const from = Math.max(offset[0], ranges[0][0]);
      const to = Math.min(offset[0] + chunkShape[0], ranges[0][1]);
      const length = (to - from) * rowBytes;
      const filePos = addr + (from - offset[0]) * rowBytes;
      const outPos = (from - ranges[0][0]) * rowBytes;
      for (let pos = 0; pos < length; pos += maxRequestBytes) {
        ops.push({
          filePos: filePos + pos,
          outPos: outPos + pos,
          length: Math.min(maxRequestBytes, length - pos),
        });
      }
      totalBytes += length;
    } else {
      if (chunkBytes > maxRequestBytes) {
        return undefined; // don't fetch large chunks in one go (HDF5 reads only what's needed)
      }

      ops.push({
        filePos: addr,
        length: chunkBytes,
        chunk: { offset, shape: chunkShape },
      });
      totalBytes += chunkBytes;
    }

    // Next chunk (last dimension fastest)
    let d = rank - 1;
    for (; d >= 0; d -= 1) {
      gridPos[d] += 1;
      if (gridPos[d] <= lastChunk[d]) {
        break;
      }
      gridPos[d] = firstChunk[d];
    }
    if (d < 0) {
      break;
    }
  }

  return { ops, totalBytes };
}

/* Copy the selected part of a chunk to the output (both row-major) */
export function copyChunkSelection(
  chunkBytes: Uint8Array,
  chunk: { offset: number[]; shape: number[] },
  out: Uint8Array,
  outStart: number[],
  outShape: number[],
  itemSize: number,
): void {
  const rank = outShape.length;
  const lo = chunk.offset.map((o, d) => Math.max(o, outStart[d]));
  const hi = chunk.offset.map((o, d) =>
    Math.min(o + chunk.shape[d], outStart[d] + outShape[d]),
  );
  if (lo.some((l, d) => l >= hi[d])) {
    return;
  }

  const chunkStrides = chunk.shape.map(
    (_, d) => product(chunk.shape.slice(d + 1)) * itemSize,
  );
  const outStrides = outShape.map(
    (_, d) => product(outShape.slice(d + 1)) * itemSize,
  );
  const rowLength = (hi[rank - 1] - lo[rank - 1]) * itemSize;

  const idx = lo.slice(0, -1);
  for (;;) {
    let src = (lo[rank - 1] - chunk.offset[rank - 1]) * itemSize;
    let dst = (lo[rank - 1] - outStart[rank - 1]) * itemSize;
    for (let d = 0; d < rank - 1; d += 1) {
      src += (idx[d] - chunk.offset[d]) * chunkStrides[d];
      dst += (idx[d] - outStart[d]) * outStrides[d];
    }
    out.set(chunkBytes.subarray(src, src + rowLength), dst);

    let d = rank - 2;
    for (; d >= 0; d -= 1) {
      idx[d] += 1;
      if (idx[d] < hi[d]) {
        break;
      }
      idx[d] = lo[d];
    }
    if (d < 0) {
      break;
    }
  }
}

/* Execute plan with a few concurrent requests */
export async function executeDirectRead(
  plan: DirectReadPlan,
  reader: RangeReader,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<DirectValue> {
  const { ops, itemSize, outShape, outStart, totalBytes, Constructor } = plan;
  const outBytes = product(outShape) * itemSize;
  const buffer = new ArrayBuffer(outBytes);
  const out = new Uint8Array(buffer);

  let next = 0;
  let doneBytes = 0;
  const controller = new AbortController();
  const anySignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  async function worker(): Promise<void> {
    while (next < ops.length) {
      const op = ops[next];
      next += 1;

      if (op.outPos !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await reader.readRange(
          op.filePos,
          op.filePos + op.length,
          out.subarray(op.outPos, op.outPos + op.length),
          anySignal,
        );
      } else if (op.chunk) {
        const tmp = new Uint8Array(op.length);
        // eslint-disable-next-line no-await-in-loop
        await reader.readRange(
          op.filePos,
          op.filePos + op.length,
          tmp,
          anySignal,
        );
        copyChunkSelection(tmp, op.chunk, out, outStart, outShape, itemSize);
      }

      doneBytes += op.length;
      onProgress?.(doneBytes / totalBytes);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(READ_CONCURRENCY, ops.length) }, worker),
    );
  } catch (error) {
    controller.abort(); // stop other requests
    throw error;
  }

  return new Constructor(buffer);
}

/* Read the first few selected values with HDF5 and check that they match those read
 * directly, to guard against any misinterpretation of the storage information
 * (e.g. addresses relative to a user block). */
export function checkDirectRead(
  h5wDataset: H5WasmDataset,
  ranges: [number, number][],
  value: ArrayLike<number | bigint>,
): boolean {
  const probeRanges = ranges.map<[number, number]>(([start, stop], d) =>
    d === ranges.length - 1
      ? [start, Math.min(stop, start + 16)]
      : [start, start + 1],
  );
  const probe = h5wDataset.slice(probeRanges) as ArrayLike<number | bigint>;

  // Also check the last selected value, which comes from another request
  const endProbe = h5wDataset.slice(
    ranges.map(([, stop]) => [stop - 1, stop]),
  ) as ArrayLike<number | bigint>;

  // eslint-disable-next-line unicorn/no-for-loop -- `probe` may be a plain array-like
  for (let i = 0; i < probe.length; i += 1) {
    if (!Object.is(probe[i], value[i])) {
      return false;
    }
  }

  return Object.is(endProbe[0], value[value.length - 1]);
}
