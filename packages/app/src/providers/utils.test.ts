import { CancelledError } from '@tanstack/react-query';
import { type AxiosInstance } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import {
  createAxiosFetcher,
  createBasicFetcher,
  FetcherError,
  isTransportError,
} from './utils';

const TOO_LARGE_HINT = 'may be too large to be loaded in the browser';

function createErroringBody(): ReadableStream {
  return new ReadableStream({
    pull: (controller) => {
      controller.error(new TypeError('Failed to fetch'));
    },
  });
}

describe('createBasicFetcher', () => {
  it('should return response body as buffer', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3])),
    );

    const buffer = await createBasicFetcher()('/data', {});
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should throw if response body cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(createErroringBody(), {
        headers: { 'content-length': '2000000' },
      }),
    );

    const promise = createBasicFetcher()('/data', {});
    await expect(promise).rejects.toThrow(/^Failed to read response$/u);
  });

  it('should hint that data may be too large if large response body cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(createErroringBody(), {
        headers: { 'content-length': '2400000000' },
      }),
    );

    const promise = createBasicFetcher()('/data', {});
    await expect(promise).rejects.toThrow(
      `Failed to read response of 2.4 GB; the requested data ${TOO_LARGE_HINT}`,
    );
  });

  it('should keep HTTP status if error response body cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(createErroringBody(), {
        status: 404,
        statusText: 'Not Found',
      }),
    );

    const promise = createBasicFetcher()('/data', {});
    await expect(promise).rejects.toBeInstanceOf(FetcherError);
    await expect(promise).rejects.toMatchObject({ status: 404 });
  });
});

describe('createAxiosFetcher', () => {
  it('should throw if response data is null', async () => {
    // XHR gives `null` when response is too large to be allocated
    const axiosInstance = {
      defaults: {},
      get: async () => ({ data: null, headers: {} }),
    } as unknown as AxiosInstance;

    await expect(
      createAxiosFetcher(axiosInstance)('/data', {}),
    ).rejects.toThrow(
      `Failed to read response; the requested data ${TOO_LARGE_HINT}`,
    );
  });
});

describe('isTransportError', () => {
  it('should detect errors raised while fetching data', () => {
    expect(isTransportError(new TypeError('Failed to fetch'))).toBe(true);
    expect(
      isTransportError(
        new FetcherError(502, 'Bad Gateway', new ArrayBuffer(0)),
      ),
    ).toBe(true);
    expect(isTransportError(new CancelledError())).toBe(true);
    expect(isTransportError(new DOMException('', 'TimeoutError'))).toBe(true);
  });

  it('should detect failed reads named across a worker boundary', () => {
    // Workers transfer errors as plain `Error` objects with the original name
    const error = Object.assign(new Error('Could not fetch range'), {
      name: 'ReadError',
    });
    expect(isTransportError(error)).toBe(true);
  });

  it('should not mistake HDF5 errors for transport errors', () => {
    expect(isTransportError(new Error('No entity found at /foo'))).toBe(false);

    // Provider recognised the server's error payload as an HDF5 error
    const cause = new FetcherError(404, 'Not Found', new ArrayBuffer(0));
    expect(isTransportError(new Error('not a valid path', { cause }))).toBe(
      false,
    );
  });
});
