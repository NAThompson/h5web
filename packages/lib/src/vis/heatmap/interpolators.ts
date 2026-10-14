import { hsl } from 'd3-color';
import { interpolateRgbBasisClosed } from 'd3-interpolate';
import {
  interpolateBlues,
  interpolateBrBG,
  interpolateBuGn,
  interpolateBuPu,
  interpolateCividis,
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateGnBu,
  interpolateGreens,
  interpolateGreys,
  interpolateInferno,
  interpolateMagma,
  interpolateOranges,
  interpolateOrRd,
  interpolatePiYG,
  interpolatePlasma,
  interpolatePRGn,
  interpolatePuBu,
  interpolatePuBuGn,
  interpolatePuOr,
  interpolatePuRd,
  interpolatePurples,
  interpolateRainbow,
  interpolateRdBu,
  interpolateRdGy,
  interpolateRdPu,
  interpolateRdYlBu,
  interpolateRdYlGn,
  interpolateReds,
  interpolateSinebow,
  interpolateSpectral,
  interpolateTurbo,
  interpolateViridis,
  interpolateWarm,
  interpolateYlGn,
  interpolateYlGnBu,
  interpolateYlOrBr,
  interpolateYlOrRd,
} from 'd3-scale-chromatic';

import { type D3Interpolator } from './models';

function interpolateHsl(t: number): string {
  return hsl(t * 360, 1, 0.5).formatRgb();
}

function reverseInterpolator(interpolator: D3Interpolator) {
  return (t: number) => interpolator(1 - t);
}

export const INTERPOLATORS = {
  // Single-hue
  // Reverted to be consistent with Viridis/Inferno that go from dark to bright
  Blues: reverseInterpolator(interpolateBlues),
  Greens: reverseInterpolator(interpolateGreens),
  Greys: reverseInterpolator(interpolateGreys),
  Oranges: reverseInterpolator(interpolateOranges),
  Purples: reverseInterpolator(interpolatePurples),
  Reds: reverseInterpolator(interpolateReds),

  // Multi-hue
  Turbo: interpolateTurbo,
  Viridis: interpolateViridis,
  Inferno: interpolateInferno,
  Magma: interpolateMagma,
  Plasma: interpolatePlasma,
  Cividis: interpolateCividis,
  Warm: interpolateWarm,
  Cool: interpolateCool,
  Cubehelix: interpolateCubehelixDefault,
  BuGn: interpolateBuGn,
  BuPu: interpolateBuPu,
  GnBu: interpolateGnBu,
  OrRd: interpolateOrRd,
  PuBuGn: interpolatePuBuGn,
  PuBu: interpolatePuBu,
  PuRd: interpolatePuRd,
  RdPu: interpolateRdPu,
  YlGnBu: interpolateYlGnBu,
  YlGn: interpolateYlGn,
  YlOrBr: interpolateYlOrBr,
  YlOrRd: interpolateYlOrRd,

  // Cyclical
  Twilight: interpolateTwilight,
  Rainbow: interpolateRainbow,
  Sinebow: interpolateSinebow,
  HSL: interpolateHsl,

  // Diverging
  BrBG: interpolateBrBG,
  PRGn: interpolatePRGn,
  PiYG: interpolatePiYG,
  PuOr: interpolatePuOr,
  RdBu: interpolateRdBu,
  RdGy: interpolateRdGy,
  RdYlBu: interpolateRdYlBu,
  RdYlGn: interpolateRdYlGn,
  Spectral: interpolateSpectral,
}; // satisfies Record<string, D3Interpolator>;

// Matplotlib's perceptually uniform cyclic `twilight`, sampled at 16 stops
function interpolateTwilight(t: number): string {
  return twilight(t - Math.floor(t));
}

const twilight = interpolateRgbBasisClosed([
  '#e2d9e2',
  '#c4ced4',
  '#95b5c7',
  '#7297c1',
  '#6276ba',
  '#5e51ad',
  '#592a8f',
  '#45135c',
  '#2f1436',
  '#4a1342',
  '#741e4f',
  '#983550',
  '#b25652',
  '#c27c63',
  '#cca389',
  '#d8c7be',
]);
