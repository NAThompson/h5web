import { VectorBackground, VectorStyle } from '@h5web/lib';
import { type AttributeValues } from '@h5web/shared/hdf5-models';
import { arrayAttr, group, scalarAttr } from '@h5web/shared/mock-utils';
import { ScaleType } from '@h5web/shared/vis-models';
import { describe, expect, it } from 'vitest';

import {
  getAxisCoords,
  getSequenceDomain,
  parseVectorHint as parseHint,
  splitComponents,
} from './utils';

// Attributes of an entity with these values
function parseVectorHint(values: AttributeValues) {
  const entity = group('g', [], {
    attributes: Object.entries(values).map(([name, val]) =>
      Array.isArray(val) ? arrayAttr(name, val) : scalarAttr(name, val),
    ),
  });
  return parseHint(entity, values);
}

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

  it('should read padded strings and 1-element arrays (netCDF-4)', () => {
    expect(
      parseVectorHint({
        H5WEB_vector_style: 'lic\0\0',
        H5WEB_vector_background: ['divergence'],
      }),
    ).toEqual({
      style: VectorStyle.Lic,
      background: VectorBackground.Divergence,
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
      'ignored invalid "H5WEB_arrow_density"',
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

describe('getSequenceDomain', () => {
  // Two slices of a 2 × 2 field: uniform (3, 4), then a rotation u = -y, v = x
  const field = { xs: [0, 1], ys: [0, 1], u: [0, 0, 0, 0], v: [0, 0, 0, 0] };
  const sequence = [3, 4, 3, 4, 3, 4, 3, 4, 0, 0, 0, 1, -1, 0, -1, 1];

  it('should cover the background of every slice', () => {
    function domain(kind: VectorBackground) {
      return getSequenceDomain(sequence, field, kind, ScaleType.Linear);
    }
    expect(domain(VectorBackground.Magnitude)).toEqual([0, 5]);
    expect(domain(VectorBackground.Curl)).toEqual([0, 2]);
    expect(domain(VectorBackground.Dataset)).toBeUndefined(); // not in the sequence
  });

  it('should drop values outside the scale', () => {
    expect(
      getSequenceDomain(
        sequence,
        field,
        VectorBackground.Magnitude,
        ScaleType.Log,
      ),
    ).toEqual([1, 5]);
  });
});
