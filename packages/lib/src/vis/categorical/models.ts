/* A distinct value of label / class data (e.g. a class of a segmentation mask, a CF flag) */
export interface Category {
  value: number;
  color: string; // CSS color
  label?: string; // e.g. CF `flag_meanings`; the value is shown without
}

/* Distinct values of data to show as categories, or why they can't be */
export type CategoryValues =
  { values: number[] } | { problem: 'not-integer' | 'too-many' };
