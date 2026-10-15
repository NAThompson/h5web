import { describe, expect, it } from 'vitest';

import { keepSeriesValues } from './series';

describe('keepSeriesValues', () => {
  const prev = [1, 2, 3];

  it('keep values of other slicing indices along the same dimension', () => {
    const key = ['scope', 'value', '/fit', '0,:'];
    expect(keepSeriesValues('/fit', '2,:', prev, key)).toBe(prev);
    expect(keepSeriesValues('/fit', undefined, prev, ['s', 'v', '/fit'])).toBe(
      prev,
    );
  });

  it('drop values along another dimension, or of another dataset', () => {
    const key = ['scope', 'value', '/fit', '0,:'];
    expect(keepSeriesValues('/fit', ':,0', prev, key)).toBeUndefined(); // same length
    expect(keepSeriesValues('/bound', '0,:', prev, key)).toBeUndefined();
    expect(keepSeriesValues('/fit', '0,:', prev, undefined)).toBeUndefined();
  });
});
