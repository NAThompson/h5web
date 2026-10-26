import {
  type AxisTicks,
  CategoryLegend,
  ColorBar,
  getBoxSizeFromAxes,
  getRealValue,
  HeatmapVis,
  MouseButton,
  ORTHO_PLANE_COLORS,
  OrthoPlanesVis,
  type OrthoPoint,
  useSafeDomain,
  useVisDomain,
  useVolumeDomain,
  type ValueTransform,
  type VolumePointSet,
} from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  useIgnoreValue,
  usePacking,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import {
  type LegendItem,
  useTransformIgnoreValue,
  useVisScaleType,
} from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { type SpecialColorsHint, type ViewHint } from '../../view-hints/models';
import OverlayLegend from '../../view-hints/OverlayLegend';
import { canBeCategorical, useCategories } from '../categorical';
import { useBaseArray, useToNumArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { type OrthoslicesConfig } from './config';
import CrosshairLayer from './CrosshairLayer';
import styles from './Orthoslices.module.css';
import OrthoslicesToolbar from './OrthoslicesToolbar';
import {
  AXIS_NAMES,
  getAxisSizes,
  getInitialPoint,
  getNormalAxis,
  getOrthoSlice,
  type OrthoAxis,
  type OrthoPlane,
  PLANE_AXES,
  withIndex,
} from './utils';

const PLANES: OrthoPlane[] = ['xy', 'yz', 'xz']; // in the order of the grid's cells
const INTERACTIONS = { pan: { button: MouseButton.Middle } }; // left button moves the crosshair

interface Props {
  dataset: Dataset<ArrayShape, NumericType>;
  value: ArrayValue<NumericType>;
  dims: number[]; // of the volume `[z, y, x]`, if `value` is a slice of a dataset with more dimensions
  /* Labels, values and ticks along dimensions `[z, y, x]` of the volume */
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  axisTicks?: AxisMapping<AxisTicks>;
  dimLabels?: (string | undefined)[]; // of dimensions `[z, y, x]`, e.g. for the slice inputs
  title: string;
  valueLabel?: string; // colour bar
  toolbarContainer: HTMLDivElement | undefined;
  config: OrthoslicesConfig;
  initialPosition?: number[]; // `H5WEB_slice_position`: indices along `[z, y, x]`
  axisUnits?: (string | undefined)[]; // of dimensions `[z, y, x]`: equal ratios only between same units
  withPhysicalAspect?: boolean; // axes share a unit even if it isn't known (e.g. coordinates of a mesh)
  symlogThreshold?: number;
  valueTransform?: ValueTransform;
  specialColors?: SpecialColorsHint;
  points?: VolumePointSet[]; // drawn in the 3D view (e.g. overlays of a view hint)
  legend?: LegendItem[]; // of the points, below the grid
  /* `H5WEB_categorical`, and CF `flag_values` and `flag_meanings` */
  categoryHint?: Pick<ViewHint, 'categorical' | 'categoryList'>;
  onCategoryNotesChange?: (notes: string[]) => void; // why categorical colors can't be shown
}

function MappedOrthoslicesVis(props: Props) {
  const {
    dataset,
    value,
    dims,
    axisLabels = [],
    axisValues = [],
    axisTicks = [],
    dimLabels = [],
    title,
    valueLabel,
    toolbarContainer,
    config,
    initialPosition,
    axisUnits = [],
    withPhysicalAspect = false,
    symlogThreshold,
    valueTransform,
    specialColors = {},
    points,
    legend = [],
    categoryHint = {},
    onCategoryNotesChange,
  } = props;
  const { customDomain, colorMap, scaleType, invertColorMap, keepRatio } =
    config;

  const packing = usePacking(dataset); // NetCDF `scale_factor`/`add_offset`
  const numArray = useToNumArray(useUnpackedNumArray(value, packing));
  const dataArray = useBaseArray(numArray, dims);

  const ignoreValue = useTransformIgnoreValue(
    useIgnoreValue(dataset),
    valueTransform,
  );
  // Domain of the whole volume, so that colours don't change as the planes move
  const dataDomain =
    useVolumeDomain(dataArray, { scaleType, ignoreValue }) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);
  const visScaleType = useVisScaleType(
    scaleType,
    symlogThreshold,
    config.rootN,
  );

  // Categories of the whole volume, so that the legend doesn't change as the planes move
  const withCategorical = canBeCategorical(dataset, categoryHint);
  const { categories } = useCategories(
    dataArray.data,
    withCategorical && config.categorical,
    {
      palette: config.categoricalPalette,
      list: categoryHint.categoryList,
      ignoreValue,
      onNotesChange: onCategoryNotesChange,
    },
  );

  const [point, setPoint] = useState<OrthoPoint>(() =>
    getInitialPoint(dataArray.shape, initialPosition),
  );
  const [x, y, z] = point;
  const sizes = getAxisSizes(dataArray.shape);

  // Slices only change with the index along their normal: moving along a plane keeps its slice
  const xySlice = useMemo(
    () => getOrthoSlice(dataArray, 'xy', [0, 0, z]),
    [dataArray, z],
  );
  const yzSlice = useMemo(
    () => getOrthoSlice(dataArray, 'yz', [x, 0, 0]),
    [dataArray, x],
  );
  const xzSlice = useMemo(
    () => getOrthoSlice(dataArray, 'xz', [0, y, 0]),
    [dataArray, y],
  );
  const slices = { xy: xySlice, yz: yzSlice, xz: xzSlice };

  // Axis values, labels and ticks along x, y and z (mapped to dimensions `[z, y, x]`)
  const [zValues, yValues, xValues] = useToNumArrays([
    axisValues[0],
    axisValues[1],
    axisValues[2],
  ]);
  const boxValues = useMemo(
    (): [
      typeof xValues | undefined,
      typeof yValues | undefined,
      typeof zValues | undefined,
    ] => [xValues, yValues, zValues],
    [xValues, yValues, zValues],
  );
  const labels = [axisLabels[2], axisLabels[1], axisLabels[0]];
  const ticks = [axisTicks[2], axisTicks[1], axisTicks[0]];
  const names: [string | undefined, string | undefined, string | undefined] = [
    dimLabels[2],
    dimLabels[1],
    dimLabels[0],
  ];

  const units = [axisUnits[2], axisUnits[1], axisUnits[0]].map((u) => u || '');

  // Size the 3D box by the axes only if they share a unit, as the volume does
  const boxSize =
    withPhysicalAspect || units.every((unit) => unit && unit === units[0])
      ? getBoxSizeFromAxes(dataArray.shape, boxValues)
      : undefined;

  function moveTo(axis: OrthoAxis, index: number) {
    setPoint((prev) => withIndex(prev, axis, index, dataArray.shape));
  }

  const rawValue = dataArray.get(z, y, x);
  const shownValue = valueTransform
    ? getRealValue(rawValue, valueTransform)
    : rawValue;

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <OrthoslicesToolbar
            dataDomain={dataDomain}
            config={config}
            point={point}
            sizes={sizes}
            dimLabels={names}
            onIndexChange={moveTo}
            withCategorical={withCategorical}
            isCategorical={!!categories}
          />,
          toolbarContainer,
        )}

      <figure
        className={`${visualizerStyles.vis} ${styles.root}`}
        aria-label={title}
      >
        <figcaption className={styles.title}>{renderMarkup(title)}</figcaption>
        <div className={styles.body}>
          <div className={styles.grid}>
            {PLANES.map((plane) => {
              const [u, v] = PLANE_AXES[plane];
              const normal = getNormalAxis(plane);
              return (
                <HeatmapVis
                  key={plane}
                  className={styles.cell}
                  dataArray={slices[plane]}
                  title={`${plane.toUpperCase()} · ${AXIS_NAMES[normal]} = ${point[normal]}`}
                  domain={safeDomain}
                  colorMap={colorMap}
                  scaleType={visScaleType}
                  invertColorMap={invertColorMap}
                  aspect={
                    keepRatio && (withPhysicalAspect || units[u] === units[v])
                      ? 'equal'
                      : 'auto'
                  }
                  abscissaParams={{
                    label: labels[u] ?? AXIS_NAMES[u],
                    value: boxValues[u],
                    ticks: ticks[u],
                  }}
                  ordinateParams={{
                    label: labels[v] ?? AXIS_NAMES[v],
                    value: boxValues[v],
                    ticks: ticks[v],
                  }}
                  interactions={INTERACTIONS}
                  ignoreValue={ignoreValue}
                  ignoredColor={specialColors.nanColor}
                  belowColor={specialColors.belowColor}
                  aboveColor={specialColors.aboveColor}
                  valueTransform={valueTransform}
                  showColorBar={false}
                  categories={categories}
                >
                  <CrosshairLayer
                    abscissas={boxValues[u]}
                    ordinates={boxValues[v]}
                    shape={slices[plane].shape}
                    index={[point[u], point[v]]}
                    colors={[ORTHO_PLANE_COLORS[u], ORTHO_PLANE_COLORS[v]]}
                    onMove={(ui, vi) => {
                      setPoint((prev) =>
                        withIndex(
                          withIndex(prev, u, ui, dataArray.shape),
                          v,
                          vi,
                          dataArray.shape,
                        ),
                      );
                    }}
                  />
                </HeatmapVis>
              );
            })}
            <OrthoPlanesVis
              className={styles.cell}
              dataArray={dataArray}
              point={point}
              title="3D"
              domain={safeDomain}
              scaleType={visScaleType}
              colorMap={colorMap}
              invertColorMap={invertColorMap}
              ignoreValue={ignoreValue} // masked on the GPU: texture kept as is
              nanColor={specialColors.nanColor}
              belowColor={specialColors.belowColor}
              aboveColor={specialColors.aboveColor}
              boxSize={boxSize}
              axisValues={boxValues}
              points={points}
              categories={categories}
            />
          </div>
          <div className={styles.colorBar}>
            {categories ? (
              <CategoryLegend
                categories={categories}
                label={renderMarkup(valueLabel)}
              />
            ) : (
              <ColorBar
                domain={safeDomain}
                scaleType={visScaleType}
                colorMap={colorMap}
                invertColorMap={invertColorMap}
                withBounds
                label={renderMarkup(valueLabel)}
                belowColor={specialColors.belowColor}
                aboveColor={specialColors.aboveColor}
                valueTransform={valueTransform}
              />
            )}
          </div>
        </div>
        <OverlayLegend items={legend} inline />
        <p
          className={styles.readout}
          role="status"
          aria-label="Crosshair"
          data-snapshot-ignore // cf. `SNAPSHOT_IGNORE_ATTR`
        >
          <span>{`[i, j, k] = [${z}, ${y}, ${x}]`}</span>
          <span>
            {([2, 1, 0] as const)
              .map((axis) => {
                const coords = boxValues[axis];
                const i = point[axis];
                const coord = !coords
                  ? i
                  : coords.length > sizes[axis] // bin edges
                    ? (coords[i] + coords[i + 1]) / 2
                    : coords[i];
                const name = labels[axis] ?? AXIS_NAMES[axis];
                return `${name} = ${formatTooltipVal(coord)}`;
              })
              .join(', ')}
          </span>
          <strong>
            {Number.isFinite(shownValue) ? formatTooltipVal(shownValue) : '—'}
          </strong>
        </p>
      </figure>
    </>
  );
}

export default MappedOrthoslicesVis;
