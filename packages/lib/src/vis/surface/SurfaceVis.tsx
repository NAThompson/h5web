import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import { type ColorMap } from '../heatmap/models';
import {
  type AxisParams,
  type ClassStyleAttrs,
  type ValueTransform,
  type VisScaleType,
} from '../models';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import { getSpecialColors } from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import {
  createScale,
  DEFAULT_DOMAIN,
  isIntegerAxis,
  SCALES_VALID_MINS,
} from '../utils';
import { SurfaceContext, type SurfaceContextValue } from './context';
import SurfaceMesh from './SurfaceMesh';
import {
  assertSurfaceArrays,
  DEFAULT_MAX_VERTICES,
  getCellCenters,
  getCoordsDomain,
  getDownsamplingStride,
  getFootprint,
  getSampledIndices,
  getValueHeight,
  interpolateMeshHeight,
  sampleArray,
} from './utils';

/* World coordinate within [-half, half], or up to `margin` outside it moved onto the edge */
function clampToEdge(
  coord: number,
  half: number,
  margin: number,
): number | undefined {
  if (!(Math.abs(coord) <= half + margin)) {
    return undefined; // also `NaN`
  }
  return Math.min(Math.max(coord, -half), half);
}

const OVERLAY_LIFT = 0.002; // lift children drawn on the surface (with the mesh's polygon offset)

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  domain: Domain | undefined;
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  invertColorMap?: boolean;
  title?: ReactNode;
  abscissaParams?: AxisParams;
  ordinateParams?: AxisParams;
  valueLabel?: string; // `_{…}`/`^{…}` drawn as sub/superscripts on the 3D axis
  colorBarLabel?: ReactNode; // default: `valueLabel`
  valueTransform?: ValueTransform; // values are logarithms: heights and colours shown as powers
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  keepRatio?: boolean;
  heightScale?: number;
  showAxes?: boolean;
  showGrid?: boolean;
  shading?: boolean;
  ignoreValue?: IgnoreValue;
  maxVertices?: number;
  /* Show values not supported by the scale (e.g. zeros in log scale) on the floor of the box,
   * rather than as holes - e.g. zeros of the amplitude of an analytic function as funnels */
  floorUnsupported?: boolean;
  /* Colour the surface by another field than height (same shape as `dataArray`),
   * e.g. phase of complex values while height shows their amplitude */
  colorArray?: NdArray<NumArray>;
  colorDomain?: Domain; // defaults to `domain`
  colorScaleType?: VisScaleType;
  /* CSS colour of `NaN`, ignored and unsupported values, drawn on the floor of the box rather than
   * as holes */
  nanColor?: string;
  belowColor?: string; // CSS colour of values below the domain (default: colour of its lower end)
  aboveColor?: string;
}

function SurfaceVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    domain = DEFAULT_DOMAIN,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    invertColorMap = false,
    title,
    abscissaParams = {},
    ordinateParams = {},
    valueLabel,
    colorBarLabel = valueLabel,
    valueTransform,
    flipXAxis = false,
    flipYAxis = false,
    keepRatio = true,
    heightScale = 0.5,
    showAxes = true,
    showGrid = true,
    shading = true,
    ignoreValue,
    maxVertices = DEFAULT_MAX_VERTICES,
    floorUnsupported = false,
    colorArray,
    colorDomain,
    colorScaleType,
    nanColor,
    belowColor,
    aboveColor,
    children,
    className = '',
    style,
  } = props;

  assertSurfaceArrays(dataArray, colorArray);

  const {
    label: abscissaLabel,
    value: abscissaValue,
    ticks: abscissaTicks,
  } = abscissaParams;
  const {
    label: ordinateLabel,
    value: ordinateValue,
    ticks: ordinateTicks,
  } = ordinateParams;
  const [rows, cols] = dataArray.shape;

  const xCenters = useMemo(
    () => getCellCenters(abscissaValue, cols),
    [abscissaValue, cols],
  );
  const yCenters = useMemo(
    () => getCellCenters(ordinateValue, rows),
    [ordinateValue, rows],
  );

  const xDomain = useMemo(() => getCoordsDomain(xCenters), [xCenters]);
  const yDomain = useMemo(() => getCoordsDomain(yCenters), [yCenters]);
  const [w, h] = getFootprint(xDomain, yDomain, keepRatio);

  // Downsample large datasets: same rows and columns for height and colour fields
  const { rowIndices, colIndices, xCoords, yCoords } = useMemo(() => {
    const stride = getDownsamplingStride(rows, cols, maxVertices);
    const sampledRows = getSampledIndices(rows, stride);
    const sampledCols = getSampledIndices(cols, stride);

    const xScale = createScale(ScaleType.Linear, {
      domain: xDomain,
      range: flipXAxis ? [w / 2, -w / 2] : [-w / 2, w / 2],
    });
    const yScale = createScale(ScaleType.Linear, {
      domain: yDomain,
      range: flipYAxis ? [h / 2, -h / 2] : [-h / 2, h / 2],
    });

    return {
      rowIndices: sampledRows,
      colIndices: sampledCols,
      xCoords: sampledCols.map((i) => xScale(xCenters[i])),
      yCoords: sampledRows.map((i) => yScale(yCenters[i])),
    };
  }, [
    rows,
    cols,
    maxVertices,
    xCenters,
    yCenters,
    xDomain,
    yDomain,
    w,
    h,
    flipXAxis,
    flipYAxis,
  ]);

  const values = useMemo(
    () => sampleArray(dataArray, rowIndices, colIndices),
    [dataArray, rowIndices, colIndices],
  );

  // Sampled separately, so that changing the colour field doesn't rebuild the geometry
  const colorValues = useMemo(
    () => colorArray && sampleArray(colorArray, rowIndices, colIndices),
    [colorArray, rowIndices, colIndices],
  );

  const abscissaConfig = useMemo<Axis3DConfig>(
    () => ({
      domain: xDomain,
      isIndexAxis: isIntegerAxis(abscissaValue),
      label: abscissaLabel,
      flip: flipXAxis,
      ticks: abscissaTicks,
    }),
    [xDomain, abscissaValue, abscissaLabel, flipXAxis, abscissaTicks],
  );

  const ordinateConfig = useMemo<Axis3DConfig>(
    () => ({
      domain: yDomain,
      isIndexAxis: isIntegerAxis(ordinateValue),
      label: ordinateLabel,
      flip: flipYAxis,
      ticks: ordinateTicks,
    }),
    [yDomain, ordinateValue, ordinateLabel, flipYAxis, ordinateTicks],
  );

  const colorField = useMemo(
    () =>
      colorValues && {
        values: colorValues,
        domain: colorDomain ?? domain,
        scaleType: colorScaleType ?? ScaleType.Linear,
      },
    [colorValues, colorDomain, colorScaleType, domain],
  );

  const specialColors = useMemo(
    () => getSpecialColors(nanColor, belowColor, aboveColor),
    [nanColor, belowColor, aboveColor],
  );
  const floorInvalid = specialColors?.nan !== undefined;

  // Colour bar shows the field used for colours (unlabelled: the label is that of the height)
  const legend = useMemo(
    () =>
      colorField
        ? { ...colorField, valueTransform: undefined, label: undefined }
        : { domain, scaleType, valueTransform, label: colorBarLabel },
    [colorField, domain, scaleType, valueTransform, colorBarLabel],
  );

  // Children (e.g. overlays) are drawn in the data coordinates of the surface
  const surfaceContext = useMemo<SurfaceContextValue>(() => {
    const xScale = createScale(ScaleType.Linear, {
      domain: xDomain,
      range: flipXAxis ? [w / 2, -w / 2] : [-w / 2, w / 2],
    });
    const yScale = createScale(ScaleType.Linear, {
      domain: yDomain,
      range: flipYAxis ? [h / 2, -h / 2] : [-h / 2, h / 2],
    });
    const zScale = createScale(scaleType, {
      domain,
      range: [0, 1],
      clamp: true,
    });
    const validMin =
      SCALES_VALID_MINS[Array.isArray(scaleType) ? scaleType[0] : scaleType];

    // Normalized height of a vertex of the drawn (downsampled) mesh; `NaN` if it leaves a hole
    function getVertexHeight(row: number, col: number): number {
      return getValueHeight(values.get(row, col), zScale, validMin, {
        ignoreValue,
        floorUnsupported,
        floorInvalid,
      });
    }

    return {
      dataToWorld: (x, y, value) => {
        /* Points up to one cell outside the footprint are moved onto its edge: e.g. lines on
         * the edges of a domain whose samples stop just short of them (`[0.001, π - 0.001]`) */
        const wx = clampToEdge(
          xScale(x),
          w / 2,
          w / Math.max(colIndices.length - 1, 1),
        );
        const wy = clampToEdge(
          yScale(y),
          h / 2,
          h / Math.max(rowIndices.length - 1, 1),
        );
        if (wx === undefined || wy === undefined) {
          return undefined;
        }

        if (value !== undefined) {
          const isValid =
            Number.isFinite(value) &&
            !ignoreValue?.(value) &&
            value >= validMin;
          return isValid
            ? [wx, wy, zScale(value) * heightScale + OVERLAY_LIFT]
            : undefined;
        }

        // On the mesh as drawn; over a hole (e.g. `NaN` on the edges of the domain): on the floor
        const height = interpolateMeshHeight(
          getVertexHeight,
          xCoords,
          yCoords,
          wx,
          wy,
        );
        return [
          wx,
          wy,
          (Number.isFinite(height) ? (height ?? 0) * heightScale : 0) +
            OVERLAY_LIFT,
        ];
      },
      cellSize: [
        Math.abs(xDomain[1] - xDomain[0]) / Math.max(colIndices.length - 1, 1),
        Math.abs(yDomain[1] - yDomain[0]) / Math.max(rowIndices.length - 1, 1),
      ],
      domain,
      scaleType,
      colorMap,
      invertColorMap,
    };
  }, [
    values,
    xCoords,
    yCoords,
    rowIndices,
    colIndices,
    ignoreValue,
    floorUnsupported,
    floorInvalid,
    xDomain,
    yDomain,
    w,
    h,
    flipXAxis,
    flipYAxis,
    domain,
    scaleType,
    heightScale,
    colorMap,
    invertColorMap,
  ]);

  const valueConfig = useMemo<Axis3DConfig>(
    () => ({ domain, scaleType, label: valueLabel, ticks: valueTransform }),
    [domain, scaleType, valueLabel, valueTransform],
  );

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={[w, h, heightScale]}
      domain={legend.domain}
      scaleType={legend.scaleType}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel={legend.label}
      valueTransform={legend.valueTransform}
      belowColor={belowColor}
      aboveColor={aboveColor}
    >
      <SurfaceMesh
        values={values}
        xCoords={xCoords}
        yCoords={yCoords}
        domain={domain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        ignoreValue={ignoreValue}
        floorUnsupported={floorUnsupported}
        specialColors={specialColors}
        zHeight={heightScale}
        shading={shading}
        colorField={colorField}
      />
      {showAxes && (
        <Axes3D
          boxSize={[w, h, heightScale]}
          xConfig={abscissaConfig}
          yConfig={ordinateConfig}
          zConfig={valueConfig}
          showGrid={showGrid}
        />
      )}
      <SurfaceContext value={surfaceContext}>{children}</SurfaceContext>
    </Vis3DLayout>
  );
}

export type { Props as SurfaceVisProps };
export default SurfaceVis;
