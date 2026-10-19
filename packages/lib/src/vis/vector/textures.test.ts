import { describe, expect, it } from 'vitest';

import { getFieldTextures } from './textures';

describe('getFieldTextures', () => {
  it('should subsample axes to the maximum size, ends included', () => {
    for (const nx of [5, 8, 9, 13]) {
      const xs = Array.from({ length: nx }, (_, i) => i);
      const field = { xs, ys: [0, 1], u: xs.flatMap(() => [1, 1]), v: [] };
      const { fieldSize, xsTex } = getFieldTextures(field, 4);
      expect(fieldSize[0]).toBeLessThanOrEqual(4);
      const { data } = xsTex.image as { data: Float32Array };
      expect(data.at(-1)).toBe(nx - 1);
    }
  });
});
