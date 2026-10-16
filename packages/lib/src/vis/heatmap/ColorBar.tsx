import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { formatBound, formatTick } from '@h5web/shared/vis-utils';
import { useMeasure } from '@react-hookz/web';
import { AxisBottom, AxisRight } from '@visx/axis';
import { type CSSProperties, type ReactNode } from 'react';

import { type ValueTransform, type VisScaleType } from '../models';
import Tick from '../shared/Tick';
import {
  adaptedNumTicks,
  createScale,
  getCustomTicks,
  getRealValue,
  getScaleTickValues,
  getTextContent,
  getTickPrecision,
  withTicksFormat,
} from '../utils';
import styles from './ColorBar.module.css';
import { type ColorMap } from './models';
import { getInterpolator, getLinearGradient } from './utils';

interface Props {
  domain: Domain;
  scaleType: VisScaleType;
  colorMap: ColorMap;
  horizontal?: boolean;
  withBounds?: boolean;
  invertColorMap: boolean;
  label?: ReactNode; // e.g. quantity and unit of the values
  belowColor?: string; // shown as a triangle beyond the lower end (cf. matplotlib's `extend`)
  aboveColor?: string;
  valueTransform?: ValueTransform; // values are logarithms: ticks and bounds as powers
}

/* Ends of the domain (real values of logarithms) */
function formatBounds(
  domain: Domain,
  valueTransform: ValueTransform | undefined,
): [string, string] {
  if (domain[0] === domain[1]) {
    return ['−∞', '+∞'];
  }
  const [min, max] = valueTransform
    ? domain.map((val) => getRealValue(val, valueTransform))
    : domain;
  return [formatBound(min), formatBound(max)]; // e.g. `2.661`, `1.11×10⁻¹⁶`
}

function ColorBar(props: Props) {
  const {
    domain,
    scaleType,
    colorMap,
    horizontal,
    withBounds,
    invertColorMap,
    label,
    belowColor,
    aboveColor,
    valueTransform,
  } = props;

  const [barSize, barRef] = useMeasure<HTMLDivElement>();
  const gradientLength = barSize
    ? horizontal
      ? barSize.width
      : barSize.height
    : 0;

  const Axis = horizontal ? AxisBottom : AxisRight;
  const [minBound, maxBound] = formatBounds(domain, valueTransform);

  const axisScale = createScale(scaleType, {
    domain,
    range: horizontal
      ? [0, Math.round(gradientLength + 0.5)] // fix sub-pixel misalignment
      : [Math.round(gradientLength + 0.5), 0],
  });

  const numTicks = adaptedNumTicks(gradientLength);
  const powers = getCustomTicks(valueTransform, scaleType, domain, numTicks);
  const tickValues =
    powers?.values ?? getScaleTickValues(scaleType, domain, numTicks);
  const ticks = tickValues ?? axisScale.ticks(numTicks);
  const scaleFormatter: (val: number) => string =
    scaleType === ScaleType.Log
      ? // @ts-expect-error: log scale's `tickFormat` accepts a formatter function
        axisScale.tickFormat(numTicks, formatTick)
      : (val) =>
          formatTick(val, getTickPrecision(ticks.map((value) => ({ value }))));
  const formatAxisTick: (val: number) => string = powers
    ? powers.format
    : withTicksFormat(scaleFormatter, valueTransform);

  // Vertical bar: room for the longest tick label (e.g. many digits on narrow domains)
  const maxTickChars = Math.max(
    0,
    ...ticks.map((t) => formatAxisTick(t).length),
  );
  const axisWidth = `max(3.75rem, calc(${maxTickChars * 0.75}ch + 1.25rem))`;

  return (
    <div
      className={styles.colorBar}
      data-horizontal={horizontal || undefined}
      data-labelled={label ? true : undefined}
      style={{ '--axis-width': axisWidth } as CSSProperties}
    >
      {withBounds && (
        <>
          <p className={styles.minBound} aria-label={`Min: ${minBound}`}>
            {minBound}
          </p>
          <p className={styles.maxBound} aria-label={`Max: ${maxBound}`}>
            {maxBound}
          </p>
        </>
      )}
      <div ref={barRef} className={styles.gradientBar}>
        {belowColor && (
          <div
            className={styles.extend}
            data-end="below"
            data-keep-colors
            title="Below the domain"
            style={{ backgroundColor: belowColor }}
          />
        )}
        {aboveColor && (
          <div
            className={styles.extend}
            data-end="above"
            data-keep-colors
            title="Above the domain"
            style={{ backgroundColor: aboveColor }}
          />
        )}
        <div
          className={styles.gradient}
          data-keep-colors
          style={{
            backgroundImage: getLinearGradient(
              getInterpolator(colorMap, invertColorMap),
              horizontal ? 'right' : 'top',
              domain[0] === domain[1],
            ),
          }}
        />
      </div>
      {gradientLength > 0 && (
        <svg
          className={styles.axis}
          width={horizontal ? '100%' : '2.5em'}
          height={horizontal ? '2.5em' : '100%'}
        >
          <Axis
            scale={axisScale}
            hideAxisLine
            numTicks={numTicks}
            tickValues={tickValues}
            tickClassName={styles.tick}
            tickComponent={Tick}
            tickFormat={(val) => formatAxisTick(val.valueOf())}
          />
        </svg>
      )}
      {label && (
        <p className={styles.label} title={getTextContent(label)}>
          {label}
        </p>
      )}
    </div>
  );
}

export type { Props as ColorBarProps };
export default ColorBar;
