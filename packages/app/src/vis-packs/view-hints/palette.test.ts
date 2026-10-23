import { describe, expect, it } from 'vitest';

import { getPaletteColors } from './palette';

describe('getPaletteColors', () => {
  it('cycle the palette in curve order', () => {
    expect(getPaletteColors(['r', 'g'], 3)).toEqual(['r', 'g', 'r']);
  });

  it('give curves with the same label the same colour, in order of first appearance', () => {
    expect(getPaletteColors(['r', 'g'], 4, ['b', 'a', 'b', 'c'])).toEqual([
      'r',
      'g',
      'r',
      'r',
    ]);
  });
});
