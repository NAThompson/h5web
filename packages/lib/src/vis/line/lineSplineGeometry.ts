import { type NumArray } from '@h5web/shared/vis-models';

import LinePchipGeometry from './linePchipGeometry';
import { getSplineSlopes } from './utils';

// Cubic Hermite geometry with the slopes of the C² cubic spline, which may overshoot the points
class LineSplineGeometry extends LinePchipGeometry {
  protected override readonly overshoots = true;

  protected override getSlopes(xs: NumArray, ys: NumArray): Float64Array {
    return getSplineSlopes(xs, ys);
  }
}

export default LineSplineGeometry;
