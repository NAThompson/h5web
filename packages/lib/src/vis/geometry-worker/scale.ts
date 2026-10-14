/* Scale transforms used to place contour/isosurface vertices along cell edges.
 * Kept free of heavy dependencies so they can run in the geometry worker. */

export type ScaleTransformType = 'linear' | 'log' | 'symlog' | 'sqrt';

export interface ScaleTransform {
  /* Map a data value to the space in which it is colour-mapped */
  fn: (val: number) => number;
  /* Whether a data value can be represented in that space */
  isValid: (val: number) => boolean;
}

const SYMLOG_CONSTANT = 1; // d3's default, as used by `scaleSymlog`

export const SCALE_TRANSFORMS: Record<ScaleTransformType, ScaleTransform> = {
  linear: { fn: (val) => val, isValid: Number.isFinite },
  log: {
    fn: Math.log10,
    isValid: (val) => Number.isFinite(val) && val > 0,
  },
  symlog: {
    fn: (val) => Math.sign(val) * Math.log1p(Math.abs(val) / SYMLOG_CONSTANT),
    isValid: Number.isFinite,
  },
  sqrt: {
    fn: Math.sqrt,
    isValid: (val) => Number.isFinite(val) && val >= 0,
  },
};

export function getScaleTransform(
  scaleType: string | [string, number] | undefined,
): ScaleTransform {
  const type = Array.isArray(scaleType) ? 'linear' : scaleType; // gamma is applied after normalization
  return type && type in SCALE_TRANSFORMS
    ? SCALE_TRANSFORMS[type as ScaleTransformType]
    : SCALE_TRANSFORMS.linear;
}

/* Fraction of the way from `a` to `b` at which `level` is crossed, in the scale's space */
export function crossingRatio(
  a: number,
  b: number,
  level: number,
  fn: (val: number) => number,
): number {
  const sa = fn(a);
  const sb = fn(b);
  const t = (fn(level) - sa) / (sb - sa);
  return Number.isFinite(t) ? Math.min(Math.max(t, 0), 1) : 0.5;
}
