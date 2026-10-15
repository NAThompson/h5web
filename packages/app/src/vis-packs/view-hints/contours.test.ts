import { describe, expect, it } from 'vitest';

import { getContourOfSlicing, withoutEmphasized } from './contours';

describe('getContourOfSlicing', () => {
  it('slice a dataset with the same dims along with the base', () => {
    const mapping = [2, 'y', 'x'] as const;
    expect(getContourOfSlicing([4, 3, 5], [4, 3, 5], [...mapping])).toEqual({
      selection: '2,:,:',
      mapping: [2, 'y', 'x'],
    });
  });

  it('match a 2D dataset with the dims on the axes', () => {
    expect(getContourOfSlicing([4, 3, 5], [3, 5], [1, 'y', 'x'])).toEqual({
      selection: undefined,
      mapping: ['y', 'x'],
    });
    // Transposed axes
    expect(getContourOfSlicing([3, 4, 5], [3, 5], ['x', 0, 'y'])).toEqual({
      selection: undefined,
      mapping: ['x', 'y'],
    });
    expect(getContourOfSlicing([3, 5], [3, 5], ['y', 'x'])).toEqual({
      selection: undefined,
      mapping: ['y', 'x'],
    });
  });

  it('reject datasets on another grid', () => {
    expect(getContourOfSlicing([3, 5], [5, 3], ['y', 'x'])).toBeUndefined();
    expect(
      getContourOfSlicing([4, 3, 5], [3, 3, 5], [0, 'y', 'x']),
    ).toBeUndefined();
    expect(
      getContourOfSlicing([4, 3, 5], [4, 3], [0, 'y', 'x']),
    ).toBeUndefined();
  });
});

describe('withoutEmphasized', () => {
  it('remove emphasized levels from regular levels', () => {
    expect(withoutEmphasized([-1, 0, 1], [0])).toEqual([-1, 1]);
    expect(withoutEmphasized([-1, 1], [])).toEqual([-1, 1]);
  });
});
