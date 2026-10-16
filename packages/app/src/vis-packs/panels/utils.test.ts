import { describe, expect, it } from 'vitest';

import {
  combineDomains,
  formatIndexLabel,
  getGridSize,
  getMultiplesGrid,
  getPanelMapping,
  insertIndices,
  insertSelectionIndices,
  matchDim,
} from './utils';

describe('getGridSize', () => {
  it('lay out panels near-square, as hinted, or with more rows', () => {
    expect(getGridSize(4)).toEqual([2, 2]);
    expect(getGridSize(5)).toEqual([2, 3]);
    expect(getGridSize(4, [1, 4])).toEqual([1, 4]);
    expect(getGridSize(5, [1, 4])).toEqual([2, 4]);
  });
});

describe('matchDim', () => {
  const ref = { dims: [5, 21, 21], scales: [['/g'], ['/theta'], ['/alpha']] };

  it('match dimensions by scale and length', () => {
    const panel = { dims: [21, 21], scales: [['/theta'], ['/alpha']] };
    expect([0, 1].map((i) => matchDim(panel, ref, i))).toEqual([1, 2]);
    expect(matchDim({ dims: [7], scales: [['/g']] }, ref, 0)).toBeUndefined();
  });

  it('match dimensions without scales of datasets of the same shape', () => {
    const plain = { dims: [5, 21, 21], scales: [[], [], []] };
    expect(matchDim(plain, { ...plain }, 2)).toBe(2);
    expect(matchDim(plain, ref, 1)).toBeUndefined();
  });
});

describe('getPanelMapping', () => {
  const ref = { dims: [5, 21, 21], scales: [['/g'], ['/theta'], ['/alpha']] };

  it('follow the reference: slicing indices and axes', () => {
    const panel = { dims: [5, 21, 21], scales: ref.scales };
    expect(getPanelMapping(panel, 'heatmap', ref, [3, 'x', 'y'])).toEqual([
      3,
      'x',
      'y',
    ]);
  });

  it('put missing axes on the last free dimensions, others at 0', () => {
    const line = { dims: [21], scales: [['/alpha']] };
    expect(getPanelMapping(line, 'line', ref, [3, 'y', 'x'])).toEqual(['x']);
    const other = { dims: [4, 21, 9], scales: [[], ['/theta'], []] };
    expect(getPanelMapping(other, 'heatmap', ref, [3, 'y', 'x'])).toEqual([
      0,
      'y',
      'x',
    ]);
    // Line along a dimension on the reference's y axis: own x axis
    expect(
      getPanelMapping({ dims: [21], scales: [['/theta']] }, 'line', ref, [
        3,
        'y',
        'x',
      ]),
    ).toEqual(['x']);
  });

  it('not slice along a scale of another length', () => {
    const short = { dims: [2, 21], scales: [['/g'], ['/alpha']] };
    expect(getPanelMapping(short, 'line', ref, [4, 'y', 'x'])).toEqual([
      0,
      'x',
    ]);
  });
});

describe('small multiples', () => {
  it('insert indices of the multiples dimensions', () => {
    expect(insertIndices(['y', 'x'], [0, 1], [2, 1])).toEqual([2, 1, 'y', 'x']);
    expect(insertIndices([3, 'y', 'x'], [0], [4])).toEqual([4, 3, 'y', 'x']);
    expect(insertSelectionIndices(undefined, 2, [0, 1], [2, 1])).toBe(
      '2,1,:,:',
    );
    expect(insertSelectionIndices('3,:,:', 3, [1], [0])).toBe('3,0,:,:');
  });

  it('lay out panels in rows and columns of the multiples dimensions', () => {
    expect(getMultiplesGrid([2, 3], 3, 100).at(-1)).toEqual({
      indices: [1, 2],
      row: 1,
      col: 2,
    });
    expect(getMultiplesGrid([1000, 1000], 1000, 5)).toHaveLength(5); // capped
    expect(
      getMultiplesGrid([5], 2, 100).map(({ row, col }) => [row, col]),
    ).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ]);
  });

  it('label panels by slice label or scale value', () => {
    expect(formatIndexLabel('k', 2, [0, 1, 2], undefined)).toBe('k = 2');
    expect(formatIndexLabel('R', 1, [0.5, 1.234_567], undefined)).toBe(
      'R = 1.235',
    );
    expect(formatIndexLabel('K', 0, undefined, ['K = 0 (bare)'])).toBe(
      'K = 0 (bare)',
    );
  });
});

describe('combineDomains', () => {
  it('combine domains, ignoring missing ones', () => {
    expect(combineDomains([[0, 1], undefined, [-2, 0.5]])).toEqual([-2, 1]);
    expect(combineDomains([undefined])).toBeUndefined();
  });
});
