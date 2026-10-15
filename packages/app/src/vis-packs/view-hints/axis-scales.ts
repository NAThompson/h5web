import {
  type AxisConfig,
  type DimensionMapping,
  getHeatmapAxis,
} from '@h5web/lib';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { type AxisScaleType, ScaleType } from '@h5web/shared/vis-models';

import { toNumArray } from '../core/utils';
import { type DimScale } from '../dimscales/utils';

/* Whether an axis with these values (`undefined`: indices) can be shown on a scale: on heatmaps,
 * as `HeatmapVis` (pixel edges in the scale's space); on lines, log axes need positive values */
function canShowAxis(
  scale: DimScale,
  pixelCount: number,
  isHeatmap: boolean,
): boolean {
  const { scaleType, symlogConstant = 1, value } = scale;
  const values = toNumArray(value);
  if (isHeatmap) {
    const type: AxisConfig['scaleType'] =
      scaleType === ScaleType.SymLog
        ? [ScaleType.SymLog, symlogConstant]
        : scaleType;
    return (
      getHeatmapAxis(values, pixelCount, type).scaleType !== ScaleType.Linear
    );
  }
  return scaleType !== ScaleType.Log || !!values?.every((val) => val > 0);
}

/**
 * Scale of the dimension on an axis, from its scale's `H5WEB_axis_scale` (`undefined` if none or
 * linear), and notes: invalid attributes, and scales that can't show the axis' values, which is
 * then linear (e.g. non-positive values on a log axis)
 */
export function getAxisScaleHint(
  dimScales: AxisMapping<DimScale>,
  dimMapping: DimensionMapping,
  dims: number[],
  axis: 'x' | 'y',
  isHeatmap: boolean,
): { scaleType?: AxisScaleType; notes: string[] } {
  const dim = dimMapping.indexOf(axis);
  const scale = dim === -1 ? undefined : dimScales[dim];
  if (!scale) {
    return { notes: [] };
  }

  const notes = [...(scale.notes ?? [])];
  const { scaleType } = scale;
  if (!scaleType || scaleType === ScaleType.Linear) {
    return { notes };
  }
  if (!canShowAxis(scale, dims[dim], isHeatmap)) {
    const name = scale.name ?? `D${dim}`;
    notes.push(
      `"H5WEB_axis_scale" "${scaleType}" can't show the values of "${name}" (e.g. non-positive on a log axis): linear axis`,
    );
    return { notes };
  }
  return { scaleType, notes };
}
