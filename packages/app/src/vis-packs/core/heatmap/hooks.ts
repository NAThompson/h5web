import {
  type ContourLinesProps,
  type DimensionMapping,
  getContourLevels,
  getLevelColors,
  useDomain,
  useSlicedDimsAndMapping,
} from '@h5web/lib';
import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useMemo } from 'react';

import {
  useIgnoreValues,
  usePackings,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { withoutEmphasized } from '../../view-hints/contours';
import { type ContourSource } from '../../view-hints/hooks';
import { getHaloColor } from '../../view-hints/OverlayLayer2D';
import { useMappedArray, useToNumArray } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type HeatmapConfig } from './config';
import { ContourColorMode, ContourMode } from './models';

const DEFAULT_CONTOUR_WIDTH = 1.5; // as `ContourLines`
const DEFAULT_EMPHASIS_COLOR = 'black'; // crisp on light parts of the image, e.g. 0 on diverging maps

export interface EmphasisStyle {
  width?: number; // default: twice the regular width
  color?: string; // default: black; with a contrasting halo
}

interface ContourOpts {
  path: string; // of the dataset, to which custom levels apply
  domain: Domain; // of the colour scale
  ignoreValue: IgnoreValue | undefined;
  source: ContourSource | null | undefined; // other dataset contoured instead (`null`: none can be)
  dims: number[];
  dimMapping: DimensionMapping;
  emphasisStyle?: EmphasisStyle;
}

interface HeatmapContours {
  autoLevels: number[];
  customLevels: number[];
  regular?: ContourLinesProps;
  emphasized?: ContourLinesProps; // drawn over regular contours, with a halo
}

/* Mapped slice of a dataset contoured instead of the heatmap's (`H5WEB_contour_of`) */
function useOtherContourArray(
  source: ContourSource | null | undefined,
  dims: number[],
  dimMapping: DimensionMapping,
): {
  array: NdArray<NumArray> | undefined;
  domain: Domain | undefined;
  ignoreValue: IgnoreValue | undefined;
} {
  const [ignoreValue] = useIgnoreValues([source?.dataset]);
  const [packing] = usePackings([source?.dataset]);
  const array = useMappedArray(
    useToNumArray(useUnpackedNumArray(source?.value, packing)),
    ...useSlicedDimsAndMapping(
      source?.dataset.shape.dims ?? dims,
      source?.mapping ?? dimMapping,
    ),
  );
  const domain = useDomain(array ?? [], { ignoreValue });
  return { array, domain, ignoreValue };
}

/* Contours of a heatmap: regular levels (automatic or custom) and emphasized levels (e.g. nodal
 * lines), of the data or of another dataset on the same grid, sliced like the data */
export function useHeatmapContours(
  dataArray: NdArray<NumArray>,
  config: HeatmapConfig,
  opts: ContourOpts,
): HeatmapContours {
  const { path, domain, ignoreValue, source, dims, dimMapping } = opts;
  const { emphasisStyle = {} } = opts;
  const { contourMode, contourCount, contourLevels, contourEmphasis } = config;
  const { contourColorMode, contourColor, contourLabels, scaleType } = config;

  // Another dataset contoured instead has levels of its own, in its own domain
  const other = useOtherContourArray(source, dims, dimMapping);
  const array = source ? other.array : dataArray;
  const levelScaleType = source ? ScaleType.Linear : scaleType;
  const levelDomain = source ? (other.domain ?? DEFAULT_DOMAIN) : domain;

  // Contour levels follow the colour scale: evenly spread in its space, within its domain
  const autoLevels = useMemo(
    () => getContourLevels(levelDomain, levelScaleType, contourCount),
    [levelDomain, levelScaleType, contourCount],
  );
  // Custom levels entered for another dataset don't apply: start again from automatic levels
  const customLevels =
    contourLevels?.path === path ? contourLevels.levels : autoLevels;
  const modeLevels = {
    [ContourMode.Auto]: autoLevels,
    [ContourMode.Custom]: customLevels,
    [ContourMode.Off]: [],
  }[contourMode];
  const levels = withoutEmphasized(modeLevels, contourEmphasis);

  if (!array || source === null) {
    return { autoLevels, customLevels }; // other dataset loading or unusable
  }

  const common = {
    dataArray: array,
    scaleType: levelScaleType,
    ignoreValue: source ? other.ignoreValue : ignoreValue,
    flipXAxis: config.flipXAxis,
    flipYAxis: config.flipYAxis,
    showLabels: contourLabels,
  };
  const isColorMap = contourColorMode === ContourColorMode.ColorMap;
  const emphasisColor = emphasisStyle.color ?? DEFAULT_EMPHASIS_COLOR;

  return {
    autoLevels,
    customLevels,
    regular:
      levels.length > 0
        ? {
            ...common,
            levels,
            color: isColorMap
              ? getLevelColors(
                  levels,
                  levelDomain,
                  levelScaleType,
                  config.colorMap,
                  config.invertColorMap,
                )
              : contourColor,
            withHalo: isColorMap,
          }
        : undefined,
    emphasized:
      contourEmphasis.length > 0
        ? {
            ...common,
            levels: contourEmphasis,
            color: emphasisColor,
            lineWidth: emphasisStyle.width ?? 2 * DEFAULT_CONTOUR_WIDTH,
            withHalo: true,
            haloColor: getHaloColor(emphasisColor),
          }
        : undefined,
  };
}
