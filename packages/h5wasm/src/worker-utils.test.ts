import { H5T_CLASS, H5T_ORDER } from '@h5web/shared/h5t';
import { cplxType, floatType } from '@h5web/shared/hdf5-utils';
import { type Dataset as H5WasmDataset, type Metadata } from 'h5wasm';
import { describe, expect, it, vi } from 'vitest';

import { type LazyFile } from './lazy-file';
import {
  createLazyFileNode,
  fixAsciiStrings,
  pairComplexComponents,
  parseComplexValue,
  parseDType,
  readInSlabs,
  throwIfReadError,
  withReadErrors,
} from './worker-utils';

/* h5wasm's `Metadata` is a wide interface; only the fields read by `parseDType`
 * matter here, so build minimal objects and cast. */
function meta(fields: Partial<Metadata>): Metadata {
  return fields as unknown as Metadata;
}

function complexMeta(size: number, littleEndian = true): Metadata {
  return meta({ type: H5T_CLASS.COMPLEX, size, littleEndian });
}

describe('parseDType', () => {
  /* An `H5T_COMPLEX` carries no metadata describing its base float: both
   * components are the same type, so each is half the itemsize. */
  it('should derive the component type from half the itemsize', () => {
    expect(parseDType(complexMeta(16))).toStrictEqual(
      cplxType(floatType(64, H5T_ORDER.LE)),
    );
    expect(parseDType(complexMeta(8))).toStrictEqual(
      cplxType(floatType(32, H5T_ORDER.LE)),
    );
  });

  it('should carry the byte order over to the components', () => {
    expect(parseDType(complexMeta(16, false))).toStrictEqual(
      cplxType(floatType(64, H5T_ORDER.BE)),
    );
  });
});

describe('pairComplexComponents', () => {
  it('should pair interleaved components', () => {
    expect(pairComplexComponents([1, 2, 3, -4])).toStrictEqual([
      [1, 2],
      [3, -4],
    ]);
  });

  it('should handle an empty array', () => {
    expect(pairComplexComponents([])).toStrictEqual([]);
  });

  it('should reject an odd number of components', () => {
    // Half a complex number cannot be salvaged, so the caller keeps the raw value
    expect(pairComplexComponents([1, 2, 3])).toBeUndefined();
  });

  it('should preserve component precision from a typed array', () => {
    // `Float32Array` rounds 0.1, and the pair must carry that same rounding
    const components = new Float32Array([0.1, 0.2]);

    expect(pairComplexComponents(components)).toStrictEqual([
      [components[0], components[1]],
    ]);
  });

  /* Property: pairing is a pure regrouping - it preserves order and total
   * component count, and flattening the result recovers the input exactly. */
  it('should be a lossless regrouping for any even length', () => {
    for (let count = 0; count <= 8; count += 2) {
      const components = Array.from({ length: count }, (_, i) => i * 1.5 - 3);
      const pairs = pairComplexComponents(components);

      expect(pairs).toHaveLength(count / 2);
      expect(pairs?.flat()).toStrictEqual(components);
    }
  });
});

describe('parseComplexValue', () => {
  it('should return one pair per element of an array dataset', () => {
    expect(parseComplexValue([1, 2, 3, -4], false)).toStrictEqual([
      [1, 2],
      [3, -4],
    ]);
  });

  it('should unwrap a scalar to a bare pair', () => {
    // H5Web's value model for a scalar complex is `[real, imag]`, not `[[real, imag]]`
    expect(parseComplexValue([1, 2], true)).toStrictEqual([1, 2]);
  });

  it('should pass a non-numeric value through untouched', () => {
    // Leave anything unexpected to the caller's type guards rather than mangling it
    const value = { not: 'components' };

    expect(parseComplexValue(value, false)).toBe(value);
    expect(parseComplexValue(['a', 'b'], false)).toStrictEqual(['a', 'b']);
  });
});

/* Minimal stand-in for Emscripten's FS: just enough for `createLazyFileNode`
 * to build a node whose `read` operation calls the lazy file. */
function createFailingRead(cause: Error): () => void {
  let node: { stream_ops: { read: (...args: unknown[]) => number } };
  const fakeFS = {
    filesystems: {
      WORKERFS: {
        stream_ops: {},
        createNode: () => {
          node = { stream_ops: { read: () => 0 } };
          return node;
        },
      },
    },
    ErrnoError: class extends Error {},
    destroyNode: () => {},
  };
  const lazyFile = {
    size: 1,
    read: () => {
      throw cause;
    },
  } as unknown as LazyFile;

  createLazyFileNode(fakeFS as never, {}, 'file', lazyFile);
  return () => node.stream_ops.read({}, new Int8Array(1), 0, 1, 0);
}

describe('fixAsciiStrings', () => {
  const ascii = meta({ type: H5T_CLASS.STRING, cset: 0 });

  it('decode ASCII-tagged UTF-8 strings, as decoded byte by byte by h5wasm', () => {
    const bytes = new TextEncoder().encode('ψ₃₀ (α, θ) r₁₂ ≤ 4');
    const cp1252 = new TextDecoder('windows-1252').decode(bytes); // h5wasm's "ascii"
    const latin1 = String.fromCodePoint(...bytes); // variable-length strings
    expect(fixAsciiStrings(cp1252, ascii, true)).toBe('ψ₃₀ (α, θ) r₁₂ ≤ 4');
    expect(fixAsciiStrings([latin1, 'a'], ascii, false)).toEqual([
      'ψ₃₀ (α, θ) r₁₂ ≤ 4',
      'a',
    ]);
  });

  it('leave genuine single-byte text and other types alone', () => {
    expect(fixAsciiStrings('café', ascii, true)).toBe('café');
    expect(
      fixAsciiStrings('Ïˆ', meta({ type: H5T_CLASS.STRING, cset: 1 }), true),
    ).toBe('Ïˆ');
    expect(fixAsciiStrings(1, meta({ type: H5T_CLASS.INTEGER }), true)).toBe(1);
  });

  it('decode string members of compound, array and vlen types', () => {
    const cp1252 = new TextDecoder('windows-1252').decode(
      new TextEncoder().encode('α'),
    );
    const utf8 = meta({ type: H5T_CLASS.STRING, cset: 1 });
    const compound = meta({
      type: H5T_CLASS.COMPOUND,
      compound_type: {
        members: [meta({ type: H5T_CLASS.INTEGER }), ascii, utf8],
      } as unknown as Metadata['compound_type'],
    });
    // Only the ASCII-tagged member is re-decoded; the UTF-8 one is left alone
    expect(fixAsciiStrings([[1, cp1252, cp1252]], compound, false)).toEqual([
      [1, 'α', cp1252],
    ]);
    expect(fixAsciiStrings([1, cp1252, 'b'], compound, true)).toEqual([
      1,
      'α',
      'b',
    ]); // scalar
    const vlen = meta({ type: H5T_CLASS.VLEN, vlen_type: ascii });
    expect(fixAsciiStrings([[cp1252, 'a']], vlen, false)).toEqual([['α', 'a']]);
    const array = meta({
      type: H5T_CLASS.ARRAY,
      array_type: meta({ type: H5T_CLASS.STRING, cset: 0, shape: [2] }),
    });
    expect(fixAsciiStrings([cp1252, 'a'], array, true)).toEqual(['α', 'a']);
    // nD dataset of an array type: nested by the dataset's dimensions too
    expect(fixAsciiStrings([[[cp1252, 'a']]], array, false)).toEqual([
      [['α', 'a']],
    ]);
  });
});

describe('throwIfReadError', () => {
  it('should rethrow the cause of a failed read of a lazy file', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error('Network error');
    const read = createFailingRead(cause);

    expect(() =>
      withReadErrors(() => {
        try {
          read(); // throws HDF5-level error (EIO) in place of the cause
        } catch {
          throwIfReadError();
        }
      }),
    ).toThrow(
      // Named so the app can tell it from an HDF5 error across the worker boundary
      expect.objectContaining({ name: 'ReadError', message: cause.message }),
    );
  });

  it('should not throw when no read failed', () => {
    expect(() =>
      withReadErrors(() => {
        throwIfReadError();
      }),
    ).not.toThrow();
  });
});

// Fake 2D dataset of shape [rows, cols], whose `slice` only supports full rows
function fakeDataset(
  rows: number,
  cols: number,
  type = H5T_CLASS.FLOAT,
): H5WasmDataset & { slices: unknown[] } {
  const data = Float32Array.from({ length: rows * cols }, (_, i) => i);
  const slices: unknown[] = [];
  return {
    metadata: meta({ type, size: 4 }),
    slices,
    slice(ranges: [number, number][]) {
      slices.push(ranges);
      const [[start, stop]] = ranges;
      return data.slice(start * cols, stop * cols);
    },
  } as unknown as H5WasmDataset & { slices: unknown[] };
}

describe('readInSlabs', () => {
  it('should read selection in slabs along first dimension', () => {
    const dataset = fakeDataset(10, 4);
    const value = readInSlabs(
      dataset,
      [
        [1, 9],
        [0, 4],
      ],
      3 * 4 * 4, // 3 rows of 4 float32 values
    );

    expect(value).toBeInstanceOf(Float32Array);
    expect(value).toStrictEqual(
      Float32Array.from({ length: 32 }, (_, i) => i + 4),
    );
    expect(dataset.slices).toStrictEqual([
      [
        [1, 4],
        [0, 4],
      ],
      [
        [4, 7],
        [0, 4],
      ],
      [
        [7, 9],
        [0, 4],
      ],
    ]);
  });

  it('should not read selections that fit in a single slab', () => {
    const dataset = fakeDataset(10, 4);
    expect(
      readInSlabs(
        dataset,
        [
          [0, 3],
          [0, 4],
        ],
        3 * 4 * 4,
      ),
    ).toBeUndefined();
    expect(dataset.slices).toHaveLength(0);
  });

  it('should not read non-numeric datasets', () => {
    const dataset = fakeDataset(10, 4, H5T_CLASS.COMPOUND);
    expect(
      readInSlabs(
        dataset,
        [
          [0, 10],
          [0, 4],
        ],
        4,
      ),
    ).toBeUndefined();
    expect(dataset.slices).toHaveLength(0);
  });
});
