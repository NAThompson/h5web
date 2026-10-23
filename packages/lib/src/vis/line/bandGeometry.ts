import { type NumArray } from '@h5web/shared/vis-models';
import { type BufferAttribute, BufferGeometry } from 'three';

import { type AxisScale, type H5WebGeometry } from '../models';
import { createBufferAttr, createIndex } from '../utils';
import { MAX_SEGMENTS_PER_INTERVAL } from './linePchipGeometry';
import { Interpolation } from './models';
import { getHermiteY, getPchipSlopes, getSplineSlopes } from './utils';

interface Params {
  abscissas: NumArray;
  lower: NumArray;
  upper: NumArray;
  abscissaScale: AxisScale;
  ordinateScale: AxisScale;
  interpolation?: Interpolation;
}

const MAX_QUADS = 2 ** 20; // of cubic bands, which get fewer samples per interval beyond

/*
 * Filled area between `lower` and `upper`, as quads between samples of each interval of the
 * curves: one per interval for linear (straight edges) and constant interpolation (edges held
 * at the start of the interval, as `LineConstantGeometry`), several for PCHIP and splines (edges
 * on the interpolant of each bound, in axis space as `LinePchipGeometry`). Intervals with a
 * point that can't be drawn in either bound are left out.
 */
class BandGeometry
  extends BufferGeometry<Record<'position', BufferAttribute>>
  implements H5WebGeometry
{
  private readonly steps: number; // quads per interval

  public constructor(private readonly params: Params) {
    super();
    const { interpolation, lower } = params;
    const intervals = Math.max(lower.length - 1, 0);
    const isCubic =
      interpolation === Interpolation.Pchip ||
      interpolation === Interpolation.Spline;
    this.steps = isCubic
      ? Math.max(
          1,
          Math.min(
            MAX_SEGMENTS_PER_INTERVAL,
            Math.floor(MAX_QUADS / intervals),
          ),
        )
      : 1;

    const vertexCount = intervals * (this.steps + 1) * 2; // lower and upper of each sample
    this.setAttribute('position', createBufferAttr(vertexCount));
    this.setIndex(createIndex(intervals * this.steps * 6, vertexCount));
  }

  public update(): void {
    const { abscissas, lower, upper, abscissaScale, ordinateScale } =
      this.params;
    const { interpolation } = this.params;
    const { position } = this.attributes;
    const index = this.getIndex();
    if (!index) {
      return;
    }

    // Plain loops: `Float64Array.from` with a callback is ~8× slower in V8
    const { length } = lower;
    const xs = new Float64Array(length);
    const los = new Float64Array(length);
    const his = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      xs[i] = abscissaScale(abscissas[i]);
      los[i] = ordinateScale(lower[i]);
      his[i] = ordinateScale(upper[i]);
    }

    const { steps } = this;
    const getSlopes =
      interpolation === Interpolation.Spline ? getSplineSlopes : getPchipSlopes;
    const loSlopes = steps > 1 ? getSlopes(xs, los) : undefined;
    const hiSlopes = steps > 1 ? getSlopes(xs, his) : undefined;
    const isConstant = interpolation === Interpolation.Constant;

    let count = 0;
    for (let i = 0; i < length - 1; i++) {
      const x0 = xs[i];
      const lo0 = los[i];
      const hi0 = his[i];
      const lo1 = los[i + 1];
      const hi1 = his[i + 1];
      const dx = xs[i + 1] - x0;
      if (!Number.isFinite(dx + lo0 + lo1 + hi0 + hi1)) {
        continue; // NaN or ±∞ in either bound
      }

      // Derivatives of the interpolants with respect to `t` (cf. `getHermiteExtent`)
      const dLo0 = loSlopes ? loSlopes[i] * dx : 0;
      const dLo1 = loSlopes ? loSlopes[i + 1] * dx : 0;
      const dHi0 = hiSlopes ? hiSlopes[i] * dx : 0;
      const dHi1 = hiSlopes ? hiSlopes[i + 1] * dx : 0;
      const first = i * (steps + 1) * 2;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const x = x0 + t * dx;
        const v = first + 2 * k; // lower, upper, next lower, next upper
        if (isConstant) {
          position.setXYZ(v, x, lo0, 0); // step after
          position.setXYZ(v + 1, x, hi0, 0);
        } else if (loSlopes) {
          position.setXYZ(v, x, getHermiteY(lo0, lo1, dLo0, dLo1, t), 0);
          position.setXYZ(v + 1, x, getHermiteY(hi0, hi1, dHi0, dHi1, t), 0);
        } else {
          position.setXYZ(v, x, lo0 + t * (lo1 - lo0), 0);
          position.setXYZ(v + 1, x, hi0 + t * (hi1 - hi0), 0);
        }

        if (k < steps) {
          index.setX(count, v);
          index.setX(count + 1, v + 1);
          index.setX(count + 2, v + 2);
          index.setX(count + 3, v + 1);
          index.setX(count + 4, v + 3);
          index.setX(count + 5, v + 2);
          count += 6;
        }
      }
    }
    this.setDrawRange(0, count);
  }
}

export { type Params as BandGeometryParams };
export default BandGeometry;
