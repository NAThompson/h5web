import { VectorBackground, VectorStyle } from '@h5web/lib';
import { describe, expect, it } from 'vitest';

import { getAxisCoords, parseVectorHint, splitComponents } from './utils';

describe('parseVectorHint', () => {
  it('should read styles, backgrounds and densities, case-insensitively', () => {
    expect(
      parseVectorHint({
        H5WEB_vector_style: 'Streamlines',
        H5WEB_vector_background: 'CURL',
        H5WEB_arrow_density: [5],
        H5WEB_arrow_length: 'uniform',
      }),
    ).toEqual({
      style: VectorStyle.Streamlines,
      background: VectorBackground.Curl,
      arrowDensity: 5,
      uniformArrows: true,
      notes: [],
    });
  });

  it('should take other backgrounds as dataset paths', () => {
    expect(parseVectorHint({ H5WEB_vector_background: '../p' })).toEqual({
      background: VectorBackground.Dataset,
      backgroundPath: '../p',
      notes: [],
    });
  });

  it('should note invalid values', () => {
    expect(
      parseVectorHint({
        H5WEB_vector_style: 'quiver',
        H5WEB_arrow_density: -1,
      }).notes,
    ).toEqual([
      '"H5WEB_vector_style" "quiver" is not valid',
      '"H5WEB_arrow_density" must be a positive number',
    ]);
  });
});

describe('splitComponents and getAxisCoords', () => {
  it('should deinterleave components and default axes to indices', () => {
    expect(splitComponents([1, 2, 3, 4, 5, 6], 3)).toEqual([
      Float32Array.from([1, 4]),
      Float32Array.from([2, 5]),
      Float32Array.from([3, 6]),
    ]);
    expect(getAxisCoords(undefined, 3)).toEqual(Float64Array.from([0, 1, 2]));
    expect(getAxisCoords([5n, 7n], 2)).toEqual(Float64Array.from([5, 7]));
  });
});
