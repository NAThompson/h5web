import { describe, expect, it } from 'vitest';

import { getCategoriesResult, getSharedCategories } from './categorical';

describe('getCategoriesResult', () => {
  it('should give a category per distinct integer, labelled if listed', () => {
    const list = { values: [1, 2], labels: ['land', 'sea'] };
    const { categories, notes } = getCategoriesResult(
      [2, 1, 1, 7, -1],
      'Tableau10',
      list,
      (v) => v === -1, // fill value
    );
    expect(categories?.map(({ value, label }) => [value, label])).toEqual([
      [1, 'land'],
      [2, 'sea'],
      [7, undefined],
    ]);
    expect(notes).toEqual([]);
  });

  it('should fall back to the color map with a note', () => {
    expect(getCategoriesResult([0.5], 'Glasbey')).toEqual({
      notes: [
        'Categorical colors need integer values: shown with the color map',
      ],
    });
    const many = Array.from({ length: 300 }, (_, i) => i);
    expect(getCategoriesResult(many, 'Glasbey')).toEqual({
      notes: ['More than 256 distinct values: shown with the color map'],
    });
  });

  it('should keep listed categories when other values are not categories', () => {
    const list = { values: [0, 1] };
    const { categories, notes } = getCategoriesResult([0.5], 'Glasbey', list);
    expect(categories?.map(({ value }) => value)).toEqual([0, 1]);
    expect(notes).toEqual([
      'Values that are not among "flag_values" are drawn as NaN',
    ]);
  });
});

describe('getSharedCategories', () => {
  it('should give the integers of the shared domain, or listed categories', () => {
    expect(
      getSharedCategories([-0.5, 2], 'Glasbey')?.map(({ value }) => value),
    ).toEqual([0, 1, 2]);
    expect(getSharedCategories([0, 1000], 'Glasbey')).toBeUndefined();
    expect(
      getSharedCategories([0, 1000], 'Glasbey', { values: [5] })?.map(
        ({ value }) => value,
      ),
    ).toEqual([5]);
  });
});
