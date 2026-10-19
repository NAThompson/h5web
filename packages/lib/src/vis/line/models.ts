import { type IgnoreValue, type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type ReactNode } from 'react';

export enum CurveType {
  LineOnly = 'OnlyLine',
  GlyphsOnly = 'OnlyGlyphs',
  LineAndGlyphs = 'LineAndGlyphs',
}

export enum GlyphType {
  Circle = 'Circle',
  Cross = 'Cross',
  Square = 'Square',
  Cap = 'Cap',
}

export interface TooltipData {
  abscissa: number;
  xi: number;
  x: number;
}

export interface AuxiliaryParams {
  array: NdArray<NumArray>;
  label?: string;
  errors?: NdArray<NumArray>;
  color?: string;
  width?: number; // line width in CSS pixels (default 1)
  dash?: boolean; // dashed line
  visible?: boolean;
  ignoreValue?: IgnoreValue; // overrides `ignoreValue` prop of `LineVis`
}

/* Legend entry of something other than a curve (e.g. reference line, shaded band) */
export interface LegendEntry {
  label: ReactNode;
  color: string;
  dash?: boolean;
  isBand?: boolean;
}

/* Reference line (`range` of one value) or band across the canvas, which the legend avoids */
export interface LegendObstacle {
  axis: 'x' | 'y'; // of its values
  range: [number, number];
}

export enum Interpolation {
  Linear = 'Linear',
  Constant = 'Constant',
  Pchip = 'PCHIP',
  Spline = 'Spline', // C² cubic, not-a-knot
}
