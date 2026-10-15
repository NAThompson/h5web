import {
  type AxisScaleType,
  type ColorScaleType,
  type Domain,
  type IgnoreValue,
  type NumArray,
  type ScaleType,
} from '@h5web/shared/vis-models';
import { type PickD3Scale, type PickScaleConfigWithoutType } from '@visx/scale';
import { type HTMLAttributes, type ReactNode } from 'react';

import { type ColorMap } from './heatmap/models';
import { type ScaleGamma } from './scaleGamma';

export interface Size {
  width: number;
  height: number;
}

export type Aspect = 'auto' | 'equal' | number;

export type Bound = 'min' | 'max';
export type CustomDomain = [min: number | null, max: number | null]; // `null` for persistability

export interface GetDomainOpts {
  includeErrors?: boolean;
  scaleType?: ScaleType;
  ignoreValue?: IgnoreValue;
}

export interface DomainErrors {
  minGreater?: boolean;
  minError?: DomainError.InvalidMinWithScale | DomainError.CustomMaxFallback;
  maxError?: DomainError.InvalidMaxWithScale;
}

export enum DomainError {
  MinGreater = 'min-greater',
  InvalidMinWithScale = 'invalid-min-with-scale',
  InvalidMaxWithScale = 'invalid-max-with-scale',
  CustomMaxFallback = 'custom-max-fallback',
}

export interface AxisConfig {
  isIndexAxis?: boolean;
  visDomain: Domain;
  showGrid?: boolean;
  scaleType?: AxisScaleType | SymLogScaleType;
  label?: ReactNode; // if not a string, SVG text content (e.g. `<tspan>`)
  flip?: boolean;
  nice?: boolean;
  formatTick?: (val: number) => string;
  ticks?: AxisTicks;
}

export type AxisTicks = 'pi'; // ticks at multiples of π (π/4, π/2, π...)

/* Symlog scale with the given constant, i.e. width of the linear band around 0 (default 1) */
export type SymLogScaleType = [ScaleType.SymLog, number];

export type VisScaleType =
  ColorScaleType | [ScaleType.Gamma, number] | SymLogScaleType;
export type ExtractScaleType<V extends VisScaleType> = V extends ColorScaleType
  ? V
  : V[0];

export interface ScaleGammaConfig {
  domain?: Domain;
  range?: Domain;
  exponent?: number;
  clamp?: boolean;
}

export type ScaleConfig<S = ScaleType> = S extends ColorScaleType
  ? PickScaleConfigWithoutType<S, number>
  : ScaleGammaConfig;

export type Scale<S = ScaleType> = S extends ColorScaleType
  ? PickD3Scale<S, number>
  : ScaleGamma;

export type AxisScale = Scale<AxisScaleType>;

export interface AxisOffsets {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface AxisParams {
  label?: string;
  value?: NumArray;
  scaleType?: AxisScaleType;
  symlogConstant?: number; // width of the linear band around 0 of a symlog axis (default 1)
  ticks?: AxisTicks;
}

export type Coords = [x: number, y: number];

export interface HistogramParams {
  values: NumArray;
  bins: NumArray;
  showLeftAxis?: boolean;
  colorMap?: ColorMap;
  invertColorMap?: boolean;
}

export type ClassStyleAttrs = Pick<
  HTMLAttributes<HTMLElement>,
  'className' | 'style'
>;

export interface H5WebGeometry {
  update: () => void;
}
