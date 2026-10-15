import ndarray from 'ndarray';
import { describe, expect, it } from 'vitest';

import { getEnvelope } from './envelope';

const NAN = Number.NaN;

function envelope(
  values: number[],
  type: 'cummin' | 'cummax',
  reverse = false,
  shape = [values.length],
): number[] {
  return [
    ...getEnvelope(ndarray(values, shape), { type, mode: 'add', reverse }).data,
  ];
}

describe('getEnvelope', () => {
  it('compute running min and max, skipping NaN', () => {
    expect(envelope([NAN, 3, 1, NAN, 2, 0.5], 'cummin')).toEqual([
      NAN,
      3,
      1,
      1,
      1,
      0.5,
    ]);
    expect(envelope([1, 3, NAN, 2], 'cummax')).toEqual([1, 3, 3, 3]);
  });

  it('compute suffix envelopes in reverse', () => {
    expect(envelope([1, 3, NAN, 2, NAN], 'cummax', true)).toEqual([
      3,
      3,
      2,
      2,
      NAN,
    ]);
  });

  it('envelope each curve of a multi-plot', () => {
    expect(envelope([3, 1, 2, 0, 5, 4], 'cummin', false, [2, 3])).toEqual([
      3, 1, 1, 0, 0, 0,
    ]);
  });

  it('skip ignored values', () => {
    const env = getEnvelope(
      ndarray([2, -999, 1]),
      { type: 'cummin', mode: 'replace', reverse: false },
      (val) => val === -999,
    );
    expect([...env.data]).toEqual([2, 2, 1]);
  });
});
