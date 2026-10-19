import {
  type Domain,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { TooltipWithBounds } from '@visx/tooltip';
import {
  type PropsWithChildren,
  type ReactNode,
  useMemo,
  useState,
} from 'react';

import { type ClassStyleAttrs } from '../models';
import tooltipStyles from '../shared/Tooltip.module.css';
import Axes3D, { type Axis3DConfig } from '../three-d/Axes3D';
import { getBoxSize, getExtentDomain } from '../three-d/utils';
import Vis3DLayout from '../three-d/Vis3DLayout';
import { type PointStyleParams, usePointStyle } from './hooks';
import PointCloud from './PointCloud';
import PointPicker3D, { type PickedPoint } from './PointPicker3D';
import PointTooltip, { type PointChannel } from './PointTooltip';
import SizeLegend from './SizeLegend';
import { getLinearUnitScale, getUnitPositions } from './utils';

interface Props extends ClassStyleAttrs, Omit<PointStyleParams, 'scaleType'> {
  x: NumArray;
  y: NumArray;
  z: NumArray;
  scaleType?: PointStyleParams['scaleType'];
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  colorBarLabel?: string; // also labels colour values in tooltips
  sizeLabel?: string;
  sizeScale?: number; // multiplies point sizes
  opacity?: number;
  keepRatio?: boolean;
  showAxes?: boolean;
  showGrid?: boolean;
  title?: ReactNode;
}

/**
 * Point cloud in an orbit view, coloured by value through a colour map (or of a single colour)
 * and optionally sized by another value, with points of constant size on screen.
 */
function Scatter3DVis(props: PropsWithChildren<Props>) {
  const {
    x,
    y,
    z,
    values,
    domain,
    scaleType = ScaleType.Linear,
    colorMap,
    invertColorMap,
    belowColor,
    aboveColor,
    sizes: sizeValues,
    xLabel = '𝑥',
    yLabel = '𝑦',
    zLabel = '𝑧',
    colorBarLabel,
    sizeLabel,
    sizeScale = 1,
    opacity,
    keepRatio = true,
    showAxes = true,
    showGrid = true,
    title,
    children,
    className,
    style,
  } = props;

  const domains = useMemo<[Domain, Domain, Domain]>(
    () => [getExtentDomain(x), getExtentDomain(y), getExtentDomain(z)],
    [x, y, z],
  );
  const boxSize = getBoxSize(domains, keepRatio);

  const positions = useMemo(
    () =>
      getUnitPositions(
        [x, y, z],
        [
          getLinearUnitScale(domains[0]),
          getLinearUnitScale(domains[1]),
          getLinearUnitScale(domains[2]),
        ],
      ),
    [x, y, z, domains],
  );

  const pointStyle = usePointStyle(positions, { ...props, scaleType });
  const { colors, sizes, sizeDomain, sizeRange } = pointStyle;

  const [xConfig, yConfig, zConfig] = useMemo<Axis3DConfig[]>(
    () => [
      { domain: domains[0], label: xLabel },
      { domain: domains[1], label: yLabel },
      { domain: domains[2], label: zLabel },
    ],
    [domains, xLabel, yLabel, zLabel],
  );

  const channels = useMemo<PointChannel[]>(
    () => [
      { label: xLabel, values: x },
      { label: yLabel, values: y },
      { label: zLabel, values: z },
      ...(values ? [{ label: colorBarLabel ?? 'value', values }] : []),
      ...(sizeValues
        ? [{ label: sizeLabel ?? 'size', values: sizeValues }]
        : []),
    ],
    [
      x,
      y,
      z,
      xLabel,
      yLabel,
      zLabel,
      values,
      colorBarLabel,
      sizeValues,
      sizeLabel,
    ],
  );

  const [picked, setPicked] = useState<PickedPoint>();

  return (
    <Vis3DLayout
      className={className}
      style={style}
      title={title}
      boxSize={boxSize}
      domain={domain}
      scaleType={scaleType}
      colorMap={colorMap}
      invertColorMap={invertColorMap}
      colorBarLabel={colorBarLabel}
      belowColor={belowColor}
      aboveColor={aboveColor}
      showColorBar={!!values}
      overlay={
        <>
          {sizeDomain && (
            <SizeLegend
              label={sizeLabel}
              domain={sizeDomain}
              range={sizeRange}
              sizeScale={sizeScale}
            />
          )}
          {picked && (
            <TooltipWithBounds
              key={picked.index}
              className={tooltipStyles.tooltip}
              style={{ zIndex: 1, pointerEvents: 'none' }}
              unstyled
              applyPositionStyle
              data-snapshot-ignore
              left={picked.left}
              top={picked.top}
            >
              <PointTooltip index={picked.index} channels={channels} />
            </TooltipWithBounds>
          )}
        </>
      }
    >
      <PointCloud
        positions={positions}
        colors={colors}
        sizes={sizes}
        boxSize={boxSize}
        sizeScale={sizeScale}
        opacity={opacity}
      />
      <PointPicker3D
        positions={positions}
        sizes={sizes}
        sizeScale={sizeScale}
        boxSize={boxSize}
        onPick={setPicked}
      />
      {showAxes && (
        <Axes3D
          boxSize={boxSize}
          xConfig={xConfig}
          yConfig={yConfig}
          zConfig={zConfig}
          showGrid={showGrid}
        />
      )}
      {children}
    </Vis3DLayout>
  );
}

export type { Props as Scatter3DVisProps };
export default Scatter3DVis;
