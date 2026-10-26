import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { rgb } from 'd3-color';
import {
  DataTexture,
  NearestFilter,
  RGBAFormat,
  UnsignedByteType,
} from 'three';

import { type Category, type CategoryValues } from './models';

export const MAX_CATEGORIES = 256; // more distinct values are shown with a color map
const MAX_LOOKUP_RANGE = 65_536; // integer categories within this range: lookup table

/**
 * Distinct values of label data, ascending, without NaN and ignored values (e.g. fill values);
 * stops early at the first non-integer value or once there are more than `max`. Values of runs
 * (e.g. background of a mask) are looked up once.
 */
export function findCategoryValues(
  values: NumArray,
  max = MAX_CATEGORIES,
  ignoreValue?: IgnoreValue,
): CategoryValues {
  const found = new Set<number>();
  let prev = Number.NaN;
  for (const val of values) {
    if (val === prev || Number.isNaN(val) || ignoreValue?.(val)) {
      continue;
    }
    if (!Number.isInteger(val)) {
      return { problem: 'not-integer' };
    }
    prev = val;
    found.add(val);
    if (found.size > max) {
      return { problem: 'too-many' };
    }
  }
  return { values: [...found].sort((a, b) => a - b) };
}

/* Palette color at an index, cycled beyond the palette */
function getColor(palette: readonly string[], index: number): string {
  const n = palette.length;
  return palette[((index % n) + n) % n];
}

/**
 * Categories of distinct values, colored from a palette: listed values first (e.g. CF
 * `flag_values`, with `flag_meanings` as labels), colored by rank, then values that aren't listed,
 * ascending. Without a list, colors are by value, stable across slices and views (e.g. class 3 is
 * always the 4th color); with one, unlisted values take the colors after the listed ones.
 */
export function getCategories(
  values: number[],
  palette: readonly string[],
  listed?: { values: number[]; labels?: string[] },
): Category[] {
  const known = new Set(listed?.values);
  return [
    ...(listed?.values ?? []).map((value, rank) => ({
      value,
      color: getColor(palette, rank),
      label: listed?.labels?.[rank],
    })),
    ...values
      .filter((value) => !known.has(value))
      .map((value, i) => ({
        value,
        color: getColor(
          palette,
          listed
            ? listed.values.length + i
            : Number.isInteger(value)
              ? value
              : 0,
        ),
      })),
  ];
}

/* Index of each value among the categories; `NaN` if it is not one of them (e.g. NaN) or if it
 * is ignored (e.g. fill value, even if listed as a category) */
export function getCategoryIndices(
  values: NumArray,
  categories: Category[],
  ignoreValue?: IgnoreValue,
): Float32Array {
  const indices = new Float32Array(values.length).fill(Number.NaN);
  const entries = categories
    .map(({ value }, i): [number, number] => [value, i])
    .filter(([value]) => !ignoreValue?.(value));
  if (entries.length === 0) {
    return indices;
  }

  const catValues = entries.map(([value]) => value);
  const min = Math.min(...catValues);
  const span = Math.max(...catValues) - min;
  if (catValues.every(Number.isInteger) && span < MAX_LOOKUP_RANGE) {
    const lookup = new Float32Array(span + 1).fill(Number.NaN);
    for (const [value, i] of entries) {
      lookup[value - min] = i;
    }
    for (const [i, val] of values.entries()) {
      const offset = val - min;
      if (offset >= 0 && offset <= span && Number.isInteger(offset)) {
        indices[i] = lookup[offset];
      }
    }
    return indices;
  }

  const lookup = new Map(entries);
  for (const [i, val] of values.entries()) {
    indices[i] = lookup.get(val) ?? Number.NaN;
  }
  return indices;
}

/* Colors of the categories as a texture (one texel each, sampled without interpolation), to look
 * up category indices over the domain `[-0.5, n - 0.5]` */
export function getCategoryTexture(colors: string[]): DataTexture {
  const texels = colors.flatMap((color) => {
    const { r, g, b } = rgb(color);
    return [r, g, b, 255];
  });
  const texture = new DataTexture(
    Uint8Array.from(texels.length > 0 ? texels : [0, 0, 0, 255]),
    Math.max(colors.length, 1),
    1,
    RGBAFormat,
    UnsignedByteType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/* Domain over which category indices map to the texels of `getCategoryTexture` */
export function getCategoryDomain(categories: Category[]): [number, number] {
  return [-0.5, Math.max(categories.length, 1) - 0.5];
}

/* Value of a category as text: integers in full (e.g. IDs), others as tooltips */
export function formatCategoryValue(value: number): string {
  return Number.isSafeInteger(value) ? String(value) : formatTooltipVal(value);
}

/* Values with the labels of their categories, if any (e.g. in tooltips) */
export function getCategoryFormat(
  categories: Category[] | undefined,
): ((val: number) => string) | undefined {
  return (
    categories &&
    ((val) => {
      const label = findCategory(categories, val)?.label;
      return label
        ? `${formatCategoryValue(val)} ${label}`
        : formatCategoryValue(val);
    })
  );
}

/* Category of a value, if any (e.g. to label it in tooltips) */
export function findCategory(
  categories: Category[] | undefined,
  value: number,
): Category | undefined {
  return categories?.find((category) => category.value === value);
}
