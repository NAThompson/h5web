import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import { createScale, Z_OUT } from '../utils';
import GlyphsGeometry from './glyphsGeometry';

// Log scale: values <= 0 can't be drawn, leaving 2 and 5 without neighbours
const params = {
  abscissas: [0, 1, 2, 3, 4, 5, 6],
  ordinates: [-1, 2, 0, 3, 4, -1, 5],
  abscissaScale: createScale(ScaleType.Linear, {}),
  ordinateScale: createScale(ScaleType.Log, {}),
};

function getDrawnIndices(geometry: GlyphsGeometry): number[] {
  geometry.update();
  const { position } = geometry.attributes;
  return params.ordinates.flatMap((_, i) =>
    position.getZ(i) === Z_OUT ? [] : [i],
  );
}

describe('GlyphsGeometry', () => {
  it('should draw all valid points', () => {
    expect(getDrawnIndices(new GlyphsGeometry(params))).toEqual([1, 3, 4, 6]);
  });

  it('should draw only isolated points, which a line does not show', () => {
    const geometry = new GlyphsGeometry({ ...params, isolatedOnly: true });
    expect(getDrawnIndices(geometry)).toEqual([1, 6]);
  });
});
