import { type Domain } from '@h5web/shared/vis-models';
import { rgb } from 'd3-color';

import { type ColorMap } from '../heatmap/models';
import { getInterpolator } from '../heatmap/utils';
import { type VisScaleType } from '../models';
import { createScale } from '../utils';

/* "Nice" contour levels strictly within the domain, evenly spread in the space of the scale */
export function getContourLevels(
  domain: Domain,
  scaleType: VisScaleType,
  count: number,
): number[] {
  const [min, max] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  if (count <= 0 || !(max > min)) {
    return [];
  }

  const scale = createScale(scaleType, { domain: [min, max], range: [0, 1] });
  const ticks = scale.ticks(count).filter((val) => val > min && val < max);

  // Log ticks can be much denser than requested (e.g. 1, 2, ..., 9, 10, 20, ...): thin them out
  if (ticks.length > count * 1.5) {
    const stride = Math.ceil(ticks.length / count);
    return ticks.filter((_, i) => i % stride === 0);
  }

  if (ticks.length > 0) {
    return ticks;
  }

  // Domain too narrow for nice values: split it evenly in scale space
  return Array.from({ length: count }, (_, i) =>
    scale.invert((i + 1) / (count + 1)),
  );
}

/* Parse a list of levels typed by the user, e.g. "0.1, 0.5; 1e3" */
export function parseLevels(text: string): number[] {
  const values = text
    .split(/[\s,;]+/u)
    .filter((token) => token !== '')
    .map(Number)
    .filter(Number.isFinite);

  return [...new Set(values)].sort((a, b) => a - b);
}

/* Colour of each level, from the colour map normalized over the domain */
export function getLevelColors(
  levels: number[],
  domain: Domain,
  scaleType: VisScaleType,
  colorMap: ColorMap,
  invertColorMap: boolean,
): string[] {
  const scale = createScale(scaleType, { domain, range: [0, 1], clamp: true });
  const interpolator = getInterpolator(colorMap, invertColorMap);
  return levels.map((level) => {
    const t = scale(level);
    return rgb(interpolator(Number.isFinite(t) ? t : 0)).formatHex();
  });
}
