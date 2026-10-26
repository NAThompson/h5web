import { assertDefined } from '@h5web/shared/guards';
import {
  type AxisScaleType,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { type PropsWithChildren, type ReactNode, useMemo } from 'react';

import DefaultInteractions, {
  type DefaultInteractionsConfig,
} from '../../interactions/DefaultInteractions';
import ResetZoomButton from '../../toolbar/floating/ResetZoomButton';
import CategoryLegend from '../categorical/CategoryLegend';
import { getCategoryFormat } from '../categorical/utils';
import ColorBar from '../heatmap/ColorBar';
import { useAxisDomain } from '../hooks';
import { type ClassStyleAttrs } from '../models';
import Html from '../shared/Html';
import VisCanvas from '../shared/VisCanvas';
import { createScale, getTextContent } from '../utils';
import { type PointStyleParams, usePointStyle } from './hooks';
import PointCloud from './PointCloud';
import PointPicker2D from './PointPicker2D';
import { type PointChannel } from './PointTooltip';
import styles from './ScatterVis.module.css';
import SizeLegend from './SizeLegend';
import { getUnitPositions } from './utils';

interface Props extends ClassStyleAttrs, Omit<PointStyleParams, 'scaleType'> {
  x: NumArray;
  y: NumArray;
  scaleType?: PointStyleParams['scaleType'];
  xLabel?: string;
  yLabel?: string;
  xScaleType?: AxisScaleType;
  yScaleType?: AxisScaleType;
  colorBarLabel?: string; // also labels colour values in tooltips
  sizeLabel?: string;
  extraChannels?: PointChannel[]; // more values in tooltips (e.g. z)
  sizeScale?: number; // multiplies point sizes
  opacity?: number;
  showGrid?: boolean;
  title?: ReactNode;
  interactions?: DefaultInteractionsConfig;
}

/**
 * Scatter plot of up to millions of points, coloured by value through a colour map (or of a
 * single colour) and optionally sized by another value. Points are uploaded once to the GPU;
 * the point under the cursor is found with a grid built once per data.
 */
function ScatterPlotVis(props: PropsWithChildren<Props>) {
  const {
    x,
    y,
    values,
    domain,
    scaleType = ScaleType.Linear,
    colorMap,
    invertColorMap,
    belowColor,
    aboveColor,
    sizes: sizeValues,
    categories,
    xLabel = '𝑥',
    yLabel = '𝑦',
    xScaleType = ScaleType.Linear,
    yScaleType = ScaleType.Linear,
    colorBarLabel,
    sizeLabel,
    extraChannels,
    sizeScale = 1,
    opacity,
    showGrid = true,
    title,
    interactions,
    children,
    className = '',
    style,
  } = props;

  const xDomain = useAxisDomain(x, {
    scaleType: xScaleType,
    extensionFactor: 0.01,
    forceAscending: true,
  });
  const yDomain = useAxisDomain(y, {
    scaleType: yScaleType,
    extensionFactor: 0.01,
    forceAscending: true,
  });
  assertDefined(xDomain, 'Abscissas have undefined domain');
  assertDefined(yDomain, 'Ordinates have undefined domain');

  const positions = useMemo(
    () =>
      getUnitPositions(
        [x, y],
        [
          createScale(xScaleType, { domain: xDomain, range: [0, 1] }),
          createScale(yScaleType, { domain: yDomain, range: [0, 1] }),
        ],
      ),
    [x, y, xScaleType, yScaleType, xDomain, yDomain],
  );

  const pointStyle = usePointStyle(positions, { ...props, scaleType });
  const { colors, sizes, sizeDomain, sizeRange } = pointStyle;

  const channels = useMemo(
    () => [
      { label: xLabel, values: x },
      { label: yLabel, values: y },
      ...(extraChannels ?? []),
      ...(values
        ? [
            {
              label: colorBarLabel ?? 'value',
              values,
              format: getCategoryFormat(categories),
            },
          ]
        : []),
      ...(sizeValues
        ? [{ label: sizeLabel ?? 'size', values: sizeValues }]
        : []),
    ],
    [
      x,
      y,
      xLabel,
      yLabel,
      extraChannels,
      values,
      colorBarLabel,
      categories,
      sizeValues,
      sizeLabel,
    ],
  );

  return (
    <figure
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
    >
      <VisCanvas
        abscissaConfig={{
          visDomain: xDomain,
          showGrid,
          label: xLabel,
          scaleType: xScaleType,
        }}
        ordinateConfig={{
          visDomain: yDomain,
          showGrid,
          label: yLabel,
          scaleType: yScaleType,
        }}
        title={title}
      >
        <DefaultInteractions {...interactions} />
        <ResetZoomButton />
        <PointCloud
          positions={positions}
          colors={colors}
          sizes={sizes}
          sizeScale={sizeScale}
          opacity={opacity}
        />
        <PointPicker2D
          positions={positions}
          sizes={sizes}
          sizeScale={sizeScale}
          channels={channels}
        />
        {sizeDomain && (
          <Html>
            <SizeLegend
              label={sizeLabel}
              domain={sizeDomain}
              range={sizeRange}
              sizeScale={sizeScale}
            />
          </Html>
        )}
        {children}
      </VisCanvas>

      {values && categories && (
        <CategoryLegend categories={categories} label={colorBarLabel} />
      )}
      {values && !categories && (
        <ColorBar
          domain={domain}
          scaleType={scaleType}
          colorMap={colorMap}
          invertColorMap={invertColorMap}
          withBounds
          label={colorBarLabel}
          belowColor={belowColor}
          aboveColor={aboveColor}
        />
      )}
    </figure>
  );
}

export type { Props as ScatterPlotVisProps };
export default ScatterPlotVis;
