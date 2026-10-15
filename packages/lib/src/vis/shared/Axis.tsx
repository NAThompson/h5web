import { type Domain, ScaleType } from '@h5web/shared/vis-models';
import { AxisBottom, AxisLeft, type SharedAxisProps } from '@visx/axis';
import { GridColumns, GridRows } from '@visx/grid';
import { type ScaleInput } from '@visx/scale';
import { type ElementType } from 'react';

import { type AxisConfig, type AxisScale, type Size } from '../models';
import {
  adaptedNumTicks,
  createScale,
  getCustomTicks,
  getIntegerTicks,
  getScaleTickValues,
  getTickFormatter,
  getTickPrecision,
} from '../utils';
import styles from './AxisSystem.module.css';
import Tick from './Tick';

const AXIS_PROPS = {
  labelClassName: styles.label,
  labelProps: { fontSize: 'inherit' },
  tickClassName: styles.tick,
  tickComponent: Tick,
} satisfies Partial<SharedAxisProps<AxisScale>>;

const TICK_LENGTH = 8; // `visx` defaults, to place labels as `visx` does
const TICK_LABEL_SIZE = 10;

const COMPONENTS = {
  abscissa: [AxisBottom, GridColumns],
  ordinate: [AxisLeft, GridRows],
} satisfies Record<string, [ElementType, ElementType]>;

interface Props {
  type: 'abscissa' | 'ordinate';
  config: AxisConfig;
  domain: Domain;
  canvasSize: Size;
  offset: number;
  flipAxis?: boolean;
  showAxis?: boolean;
}

function Axis(props: Props) {
  const { type, config, domain, canvasSize, offset, flipAxis, showAxis } =
    props;

  const { width, height } = canvasSize;
  const isAbscissa = type === 'abscissa';
  const axisLength = isAbscissa ? width : height;

  const {
    scaleType = ScaleType.Linear,
    isIndexAxis,
    showGrid,
    label,
    nice = false,
    formatTick,
    ticks,
  } = config;
  // Restrain ticks scales to visible domains
  const scale = createScale(scaleType, {
    domain,
    range: flipAxis ? [axisLength, 0] : [0, axisLength],
    nice,
  });

  const [AxisComponent, GridComponent] = COMPONENTS[type];
  const labelOffset = offset - (isAbscissa ? 32 : 36);

  const numTicks = adaptedNumTicks(axisLength);
  const scaleTickValues = getScaleTickValues(scaleType, domain, numTicks);
  const customTicks = getCustomTicks(ticks, scaleType, domain, numTicks); // π or powers
  const ticksProp = customTicks
    ? { tickValues: customTicks.values }
    : isIndexAxis
      ? { tickValues: getIntegerTicks(domain, numTicks) }
      : scaleTickValues
        ? { tickValues: scaleTickValues }
        : { numTicks };

  const tickFormatter: (val: number, precision: number) => string =
    formatTick ||
    (customTicks
      ? customTicks.format
      : getTickFormatter(
          domain,
          axisLength,
          Array.isArray(scaleType) ? scaleType[0] : scaleType,
        ));

  return (
    <>
      {showAxis && (
        <svg
          className={styles.axis}
          data-type={type}
          style={
            isAbscissa ? { width, height: offset } : { width: offset, height }
          }
        >
          <AxisComponent
            scale={scale}
            tickFormat={(val: ScaleInput<AxisScale>, _, allTicks) =>
              tickFormatter(val.valueOf(), getTickPrecision(allTicks))
            }
            label={typeof label === 'string' ? label : undefined}
            labelOffset={labelOffset}
            hideAxisLine={showGrid}
            {...ticksProp}
            {...AXIS_PROPS}
          />
          {label && typeof label !== 'string' && (
            /* Same position as `visx`'s label, which only takes plain text */
            <text
              className={`visx-axis-label ${styles.label}`}
              {...(isAbscissa
                ? {
                    x: axisLength / 2,
                    y: TICK_LENGTH + labelOffset + TICK_LABEL_SIZE,
                  }
                : {
                    x: -axisLength / 2,
                    y: -(TICK_LENGTH + labelOffset),
                    transform: 'rotate(-90)',
                  })}
            >
              {label}
            </text>
          )}
        </svg>
      )}
      {showGrid && (
        <svg className={styles.grid} {...canvasSize}>
          <GridComponent scale={scale} {...canvasSize} {...ticksProp} />
        </svg>
      )}
    </>
  );
}

export default Axis;
