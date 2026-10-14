import { type INTERPOLATORS } from '@h5web/lib';

export type ColorMap = keyof typeof INTERPOLATORS;

export enum ContourMode {
  Off = 'off',
  Auto = 'auto',
  Custom = 'custom',
}

export enum ContourColorMode {
  Single = 'single',
  ColorMap = 'colorMap',
}
