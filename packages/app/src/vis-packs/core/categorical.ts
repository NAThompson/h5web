import {
  type Category,
  findCategoryValues,
  getCategories,
  MAX_CATEGORIES,
  type PaletteName,
  PALETTES,
} from '@h5web/lib';
import { hasBoolType, hasEnumType, hasIntegerType } from '@h5web/shared/guards';
import { type Dataset } from '@h5web/shared/hdf5-models';
import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { useEffect, useMemo } from 'react';

import { useStableArray } from '../view-hints/hooks';
import { type ViewHint } from '../view-hints/models';

/* Palettes offered for categorical colors (`H5WEB_palette`), the first by default */
export const CATEGORICAL_PALETTES: PaletteName[] = [
  'Glasbey',
  'Tableau10',
  'Category10',
];
export const [DEFAULT_CATEGORICAL_PALETTE] = CATEGORICAL_PALETTES;

/* Whether values may be shown as categories: integers (labels, classes), or listed categories
 * (CF `flag_values`), or if a hint says so (e.g. integer labels stored as floats) */
export function canBeCategorical(
  dataset: Dataset | undefined,
  hint: Pick<ViewHint, 'categorical' | 'categoryList'>,
): boolean {
  return (
    (!!dataset &&
      (hasIntegerType(dataset) ||
        hasBoolType(dataset) ||
        hasEnumType(dataset))) ||
    !!hint.categoryList ||
    !!hint.categorical
  );
}

/* Categories listed by CF flags, else the members of an enum type, labelled by their names */
export function getCategoryList(
  dataset: Dataset,
  hint: Pick<ViewHint, 'categoryList'>,
): ViewHint['categoryList'] {
  if (hint.categoryList || !hasEnumType(dataset)) {
    return hint.categoryList;
  }
  const members = Object.entries(dataset.type.mapping);
  return {
    values: members.map(([value]) => Number(value)),
    labels: members.map(([, name]) => name),
  };
}

export interface CategoriesResult {
  categories?: Category[]; // `undefined`: shown with the color map
  notes: string[]; // why not, if categorical colors were asked for
}

/**
 * Categories of the values (e.g. of a slice), colored from a palette: listed categories (CF
 * `flag_values`, with their meanings as labels) and any other distinct value. Shown with the color
 * map instead (with a note) if values aren't integers or there are too many distinct ones; listed
 * categories are kept, other values are then drawn as NaN.
 */
export function getCategoriesResult(
  values: NumArray,
  palette: PaletteName,
  list?: ViewHint['categoryList'],
  ignoreValue?: IgnoreValue,
): CategoriesResult {
  const colors = PALETTES[palette];
  const found = findCategoryValues(values, MAX_CATEGORIES, ignoreValue);
  if ('values' in found) {
    return found.values.length > 0 || list
      ? { categories: getCategories(found.values, colors, list), notes: [] }
      : { notes: [] }; // e.g. all NaN: nothing to tell apart
  }
  if (list) {
    return {
      categories: getCategories([], colors, list),
      notes: ['Values that are not among "flag_values" are drawn as NaN'],
    };
  }
  return {
    notes: [
      found.problem === 'not-integer'
        ? 'Categorical colors need integer values: shown with the color map'
        : `More than ${MAX_CATEGORIES} distinct values: shown with the color map`,
    ],
  };
}

/* Categories of panels that share their colors: listed ones (CF `flag_values`), else the
 * integers of the shared domain (`undefined` if too many) */
export function getSharedCategories(
  [min, max]: [number, number],
  palette: PaletteName,
  list?: ViewHint['categoryList'],
): Category[] | undefined {
  const count = Math.floor(max) - Math.ceil(min) + 1;
  if (!list && !(count > 0 && count <= MAX_CATEGORIES)) {
    return undefined;
  }
  const values = list
    ? []
    : Array.from({ length: count }, (_, i) => Math.ceil(min) + i);
  return getCategories(values, PALETTES[palette], list);
}

/* Categories of the values when categorical colors are on (cf. `getCategoriesResult`); notes are
 * reported as they change (e.g. to show with the hint's notes) */
export function useCategories(
  values: NumArray | undefined,
  enabled: boolean,
  opts: {
    palette: PaletteName;
    list?: ViewHint['categoryList'];
    ignoreValue?: IgnoreValue;
    onNotesChange?: (notes: string[]) => void;
  },
): CategoriesResult {
  const { palette, list, ignoreValue, onNotesChange } = opts;
  const result = useMemo(
    () =>
      enabled && values
        ? getCategoriesResult(values, palette, list, ignoreValue)
        : { notes: [] },
    [enabled, values, palette, list, ignoreValue],
  );

  const notes = useStableArray(result.notes);
  useEffect(() => {
    onNotesChange?.(notes);
  }, [notes, onNotesChange]);

  return result;
}
