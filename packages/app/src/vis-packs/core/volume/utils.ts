import { createScale, type Domain, type Scale } from '@h5web/lib';

import { type ColorOrRootScaleType, toDomainScaleType } from '../utils';

export const SLIDER_STEPS = 1000;

/* Map values to slider positions evenly in the space of the colour scale (nth root: linear) */
export function getSliderScale(
  domain: Domain,
  scaleType: ColorOrRootScaleType,
): Scale {
  return createScale(toDomainScaleType(scaleType), {
    domain,
    range: [0, SLIDER_STEPS],
    clamp: true,
  });
}

/* Middle of the domain in the space of the colour scale */
export function getDefaultIsoValue(
  domain: Domain,
  scaleType: ColorOrRootScaleType,
): number {
  return roundLevel(getSliderScale(domain, scaleType).invert(SLIDER_STEPS / 2));
}

export function roundLevel(value: number): number {
  return Number(value.toPrecision(4));
}
