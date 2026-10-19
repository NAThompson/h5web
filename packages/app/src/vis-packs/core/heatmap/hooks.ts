import {
  type ContourLinesProps,
  type DimensionMapping,
  getContourLevels,
  getLevelColors,
  getSliceSelection,
  useDomain,
  useSlicedDimsAndMapping,
  type VisScaleType,
} from '@h5web/lib';
import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useMemo, useState } from 'react';

import {
  useIgnoreValues,
  usePackings,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { withoutEmphasized } from '../../view-hints/contours';
import { type ContourSource } from '../../view-hints/hooks';
import { type ViewHint } from '../../view-hints/models';
import { getHaloColor } from '../../view-hints/OverlayLayer2D';
import { useMappedArray, useToNumArray } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type HeatmapConfig } from './config';
import { ContourColorMode, ContourMode } from './models';
import {
  getProjectionAxis,
  getProjectionDim,
  getProjectionLabel,
  getProjectionSelection,
  type HeatmapProjection,
  projectArray,
} from './projection';
import { type ProjectionControlProps } from './ProjectionControl';

const DEFAULT_CONTOUR_WIDTH = 1.5; // as `ContourLines`
const DEFAULT_EMPHASIS_COLOR = 'black'; // crisp on light parts of the image, e.g. 0 on diverging maps

export interface EmphasisStyle {
  width?: number; // default: twice the regular width
  color?: string; // default: black; with a contrasting halo
}

interface ContourOpts {
  path: string; // of the dataset, to which custom levels apply
  domain: Domain; // of the colour scale
  scaleType: VisScaleType; // of the colour scale, e.g. symlog with its threshold
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
  const { path, domain, scaleType, ignoreValue, source, dims, dimMapping } =
    opts;
  const { emphasisStyle = {} } = opts;
  const { contourMode, contourCount, contourLevels, contourEmphasis } = config;
  const { contourColorMode, contourColor, contourLabels } = config;

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

/* Values of a heatmap stack with the projected dimension reduced (cf. `getProjectionSelection`),
 * i.e. with the dimensions of a slice; as is without projection. Memoised: computed again only
 * for new values or a new projection (about 40 ms for 256³ values) */
export function useProjectedArray(
  values: NumArray,
  dims: number[],
  dimMapping: DimensionMapping,
  projection: HeatmapProjection | undefined,
  ignoreValue: IgnoreValue | undefined,
): NumArray {
  const { kind, dim } = projection ?? {};
  return useMemo(() => {
    if (kind === undefined || dim === undefined) {
      return values;
    }
    const fetchedDims = dims.filter(
      (_, i) => i === dim || typeof dimMapping[i] !== 'number',
    );
    return projectArray(
      values,
      fetchedDims,
      getProjectionAxis(dimMapping, dim),
      kind,
      ignoreValue,
    );
  }, [values, dims, dimMapping, kind, dim, ignoreValue]);
}

interface HeatmapProjectionState {
  projection: HeatmapProjection | undefined; // `undefined`: slices
  label: string | undefined; // what was done, e.g. `max over time`
  selection: string | undefined; // of the values to fetch (projected dimension whole)
  mapMapping: ((mapping: DimensionMapping) => DimensionMapping) | undefined; // likewise, to prefetch
  mapping: DimensionMapping; // projected dimension as on an axis (`null`), e.g. for overlays
  controlProps: ProjectionControlProps | undefined; // only if a dimension is sliced
  // Projection too large to load: back to slices from the guard (shown instead of the toolbar)
  guardAlternative: { label: string; onSelect: () => void } | undefined;
}

/* Projection of a stack, hinted (`H5WEB_projection`, `H5WEB_projection_dim`) then chosen in the
 * toolbar: of the chosen dimension while it is sliced, else of the first sliced dimension */
export function useHeatmapProjection(
  hint: ViewHint,
  dimMapping: DimensionMapping,
  dimLabels: (string | undefined)[],
): HeatmapProjectionState {
  const [kind, setKind] = useState(hint.projection);
  const [chosenDim, setChosenDim] = useState(hint.projectionDim);

  const dim = getProjectionDim(dimMapping, chosenDim);
  const projection = kind && dim !== undefined ? { kind, dim } : undefined;
  const projectedDim = projection?.dim;
  const mapping = useMemo(
    () => dimMapping.map((val, i) => (i === projectedDim ? null : val)),
    [dimMapping, projectedDim],
  );
  const slicedDims = dimMapping.flatMap((val, i) =>
    typeof val === 'number' ? [{ dim: i, label: dimLabels[i] ?? `D${i}` }] : [],
  );

  return {
    projection,
    selection: projection
      ? getProjectionSelection(dimMapping, projection.dim)
      : getSliceSelection(dimMapping),
    mapMapping:
      projection &&
      ((m) => m.map((val, i) => (i === projection.dim ? null : val))),
    mapping,
    label:
      projection &&
      getProjectionLabel(
        projection.kind,
        dimLabels[projection.dim] ?? `D${projection.dim}`,
      ),
    guardAlternative: projection && {
      label: 'Show slices instead',
      onSelect: () => setKind(undefined),
    },
    controlProps:
      slicedDims.length > 0
        ? {
            value: kind,
            dim,
            dims: slicedDims,
            onChange: setKind,
            onDimChange: setChosenDim,
          }
        : undefined,
  };
}
