import { assertDefined } from '@h5web/shared/guards';
import {
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { formatTooltipVal } from '@h5web/shared/vis-utils';
import { type RGBColor } from 'd3-color';
import { type NdArray } from 'ndarray';
import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  type MagnificationTextureFilter,
  type MinificationTextureFilter,
} from 'three';

import DefaultInteractions, {
  type DefaultInteractionsConfig,
} from '../../interactions/DefaultInteractions';
import ResetZoomButton from '../../toolbar/floating/ResetZoomButton';
import { useAxisDomain, useValueToIndexScale } from '../hooks';
import {
  type Aspect,
  type AxisParams,
  type ClassStyleAttrs,
  type ValueTransform,
  type VisScaleType,
} from '../models';
import TooltipMesh from '../shared/TooltipMesh';
import VisCanvas from '../shared/VisCanvas';
import {
  DEFAULT_DOMAIN,
  getRealValue,
  getTextContent,
  isIntegerAxis,
} from '../utils';
import ColorBar from './ColorBar';
import HeatmapMesh from './HeatmapMesh';
import styles from './HeatmapVis.module.css';
import { useHeatmapAxis, useMask, useTextureSafeNdArray } from './hooks';
import { type ColorMap, type TooltipData } from './models';
import { getAxisType } from './utils';

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  domain: Domain | undefined;
  colorMap?: ColorMap;
  scaleType?: VisScaleType;
  aspect?: Aspect;
  showGrid?: boolean;
  title?: ReactNode;
  colorBarLabel?: ReactNode;
  dtype?: string;
  invertColorMap?: boolean;
  abscissaParams?: AxisParams;
  ordinateParams?: AxisParams;
  alpha?: { array: NdArray<NumArray>; domain: Domain };
  magFilter?: MagnificationTextureFilter;
  minFilter?: MinificationTextureFilter;
  flipXAxis?: boolean;
  flipYAxis?: boolean;
  renderTooltip?: (data: TooltipData) => ReactElement;
  interactions?: DefaultInteractionsConfig;
  ignoreValue?: IgnoreValue;
  ignoredColor?: RGBColor | string;
  belowColor?: string; // CSS colour of values below the domain (default: colour of its lower end)
  aboveColor?: string;
  valueTransform?: ValueTransform; // values are logarithms: shown as powers in the colour bar
}

function HeatmapVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    domain = DEFAULT_DOMAIN,
    colorMap = 'Viridis',
    scaleType = ScaleType.Linear,
    aspect = 'equal',
    showGrid = false,
    invertColorMap = false,
    title,
    colorBarLabel,
    dtype,
    abscissaParams = {},
    ordinateParams = {},
    alpha,
    magFilter,
    minFilter,
    flipXAxis,
    flipYAxis,
    renderTooltip,
    children,
    interactions,
    ignoreValue,
    ignoredColor,
    belowColor,
    aboveColor,
    valueTransform,
    className = '',
    style,
  } = props;
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

  // Log and symlog axes are non-uniform axes in the scale's space (cf. `getHeatmapAxis`)
  const xAxis = useHeatmapAxis(abscissaValue, cols, abscissaParams);
  const yAxis = useHeatmapAxis(ordinateValue, rows, ordinateParams);

  const abscissas = xAxis.edges;
  const abscissaDomain = useAxisDomain(abscissas);
  assertDefined(abscissaDomain, 'Abscissas have undefined domain');

  const ordinates = yAxis.edges;
  const ordinateDomain = useAxisDomain(ordinates);
  assertDefined(ordinateDomain, 'Ordinates have undefined domain');

  const abscissaToIndex = useValueToIndexScale(abscissas);
  const ordinateToIndex = useValueToIndexScale(ordinates);

  // Non-uniform pixels: mesh remapped to the edges; pixel values (if given) are pixel centres
  const xCentres = xAxis.centres;
  const yCentres = yAxis.centres;

  const safeDataArray = useTextureSafeNdArray(dataArray);
  const safeAlphaArray = useTextureSafeNdArray(alpha?.array);
  const maskArray = useMask(dataArray, ignoreValue);

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
    >
      <VisCanvas
        title={title}
        aspect={aspect}
        abscissaConfig={{
          visDomain: abscissaDomain,
          showGrid,
          scaleType: xAxis.scaleType,
          isIndexAxis: isIntegerAxis(abscissaValue, getAxisType(xAxis)),
          label: abscissaLabel,
          flip: flipXAxis,
          ticks: abscissaTicks,
        }}
        ordinateConfig={{
          visDomain: ordinateDomain,
          showGrid,
          scaleType: yAxis.scaleType,
          isIndexAxis: isIntegerAxis(ordinateValue, getAxisType(yAxis)),
          label: ordinateLabel,
          flip: flipYAxis,
          ticks: ordinateTicks,
        }}
      >
        <DefaultInteractions {...interactions} />
        <ResetZoomButton />

        <TooltipMesh
          guides="both"
          renderTooltip={(x, y) => {
            const xi = abscissaToIndex(x);
            const yi = ordinateToIndex(y);
            const abscissa = (xCentres ?? abscissas)[xi];
            const ordinate = (yCentres ?? ordinates)[yi];

            if (renderTooltip) {
              return renderTooltip({ abscissa, ordinate, xi, yi, x, y });
            }

            return (
              <>
                {`${abscissaLabel ?? 'x'}=${formatTooltipVal(abscissa)}, `}
                {`${ordinateLabel ?? 'y'}=${formatTooltipVal(ordinate)}`}
                <div className={styles.tooltipValue}>
                  <strong>
                    {formatTooltipVal(
                      valueTransform
                        ? getRealValue(dataArray.get(yi, xi), valueTransform)
                        : dataArray.get(yi, xi),
                    )}
                  </strong>
                  {dtype && <em>{` (${dtype})`}</em>}
                  {alpha && ` (${formatTooltipVal(alpha.array.get(yi, xi))})`}
                </div>
              </>
            );
          }}
        />

        <HeatmapMesh
          values={safeDataArray}
          domain={domain}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
          scaleType={scaleType}
          alphaValues={safeAlphaArray}
          alphaDomain={alpha?.domain}
          scale={[flipXAxis ? -1 : 1, flipYAxis ? -1 : 1, 1]}
          magFilter={magFilter}
          minFilter={minFilter}
          mask={maskArray}
          badColor={ignoredColor}
          belowColor={belowColor}
          aboveColor={aboveColor}
          xEdges={xAxis.meshEdges}
          yEdges={yAxis.meshEdges}
          xCentres={xAxis.meshCentres}
          yCentres={yAxis.meshCentres}
        />

        {children}
      </VisCanvas>

      <ColorBar
        domain={domain}
        scaleType={scaleType}
        colorMap={colorMap}
        invertColorMap={invertColorMap}
        withBounds
        label={colorBarLabel}
        belowColor={belowColor}
        aboveColor={aboveColor}
        valueTransform={valueTransform}
      />
    </figure>
  );
}

export type { Props as HeatmapVisProps };
export default HeatmapVis;
