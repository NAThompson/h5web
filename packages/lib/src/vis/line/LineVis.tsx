import { assertDefined, assertLength } from '@h5web/shared/guards';
import {
  type AxisScaleType,
  type Domain,
  type IgnoreValue,
  type NumArray,
  ScaleType,
} from '@h5web/shared/vis-models';
import { formatTooltipErr, formatTooltipVal } from '@h5web/shared/vis-utils';
import { type NdArray } from 'ndarray';
import {
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useMemo,
} from 'react';

import DefaultInteractions, {
  type DefaultInteractionsConfig,
} from '../../interactions/DefaultInteractions';
import ResetZoomButton from '../../toolbar/floating/ResetZoomButton';
import { useAxisDomain, useCssColors, useValueToIndexScale } from '../hooks';
import {
  type AxisConfig,
  type AxisParams,
  type ClassStyleAttrs,
} from '../models';
import Overlay from '../shared/Overlay';
import TooltipMesh from '../shared/TooltipMesh';
import VisCanvas from '../shared/VisCanvas';
import {
  DEFAULT_DOMAIN,
  extendDomain,
  getTextContent,
  isIntegerValued,
} from '../utils';
import DataCurve from './DataCurve';
import { useAxisValues } from './hooks';
import styles from './LineVis.module.css';
import {
  type AuxiliaryParams,
  CurveType,
  Interpolation,
  type TooltipData,
} from './models';

const MAX_TOOLTIP_ROWS = 10; // split auxiliary values into columns beyond this

interface Props extends ClassStyleAttrs {
  dataArray: NdArray<NumArray>;
  dataLabel?: string;
  dataColor?: string;
  domain: Domain | undefined;
  scaleType?: AxisScaleType;
  symlogConstant?: number; // width of the linear band around 0 of the symlog scale (default 1)
  curveType?: CurveType;
  showGrid?: boolean;
  abscissaParams?: AxisParams;
  ordinateLabel?: ReactNode; // if not a string, SVG text content (e.g. `<tspan>`)
  title?: ReactNode;
  dtype?: string;
  errorsArray?: NdArray<NumArray>;
  showErrors?: boolean;
  auxiliaries?: AuxiliaryParams[];
  renderTooltip?: (data: TooltipData) => ReactElement;
  interactions?: DefaultInteractionsConfig;
  testid?: string;
  ignoreValue?: IgnoreValue;
  interpolation?: Interpolation;
  visible?: boolean;
}

function LineVis(props: PropsWithChildren<Props>) {
  const {
    dataArray,
    dataLabel,
    dataColor,
    domain,
    curveType = CurveType.LineOnly,
    showGrid = true,
    scaleType: axisScaleType = ScaleType.Linear,
    symlogConstant,
    abscissaParams = {},
    ordinateLabel,
    title,
    dtype,
    errorsArray,
    showErrors = true,
    auxiliaries = [],
    renderTooltip,
    children,
    interactions,
    testid,
    ignoreValue,
    interpolation = Interpolation.Linear,
    visible = true,
    className = '',
    style,
  } = props;

  const {
    label: abscissaLabel,
    value: abscissaValue,
    scaleType: abscissaScaleType,
    ticks: abscissaTicks,
  } = abscissaParams;

  assertLength(errorsArray, dataArray.size, 'error');
  auxiliaries.forEach(({ label, array }, index) => {
    assertLength(array, dataArray.size, `'${label || index}' auxiliary`);
  });

  const abscissas = useAxisValues(abscissaValue, dataArray.size);
  const abscissaToIndex = useValueToIndexScale(abscissas, true);

  const abscissaDomain = useAxisDomain(abscissas, {
    scaleType: abscissaScaleType,
    extensionFactor: 0.01,
  });
  assertDefined(abscissaDomain, 'Abscissas have undefined domain');

  const scaleType = useMemo<AxisConfig['scaleType']>(
    () =>
      axisScaleType === ScaleType.SymLog && symlogConstant
        ? [ScaleType.SymLog, symlogConstant]
        : axisScaleType,
    [axisScaleType, symlogConstant],
  );

  const dataDomain = useMemo(() => {
    return domain ? extendDomain(domain, 0.05, scaleType) : DEFAULT_DOMAIN;
  }, [scaleType, domain]);

  const [[cssCurveColor, auxColorList], rootRef] = useCssColors([
    '--curve-color',
    '--aux-colors',
  ]);
  const curveColor = dataColor ?? cssCurveColor;
  const auxColors = auxColorList.split(',').map((col) => col.trim()); // support comma-separated list of colors
  const visibleAuxCount = auxiliaries.filter((aux) => aux.visible).length;
  const hasVisibleAux = visibleAuxCount > 0;

  return (
    <figure
      ref={rootRef}
      className={`${styles.root} ${className}`}
      style={style}
      aria-label={getTextContent(title) || undefined}
      data-keep-canvas-colors
      data-testid={testid}
    >
      <VisCanvas
        title={title}
        abscissaConfig={{
          visDomain: abscissaDomain,
          showGrid,
          scaleType: abscissaScaleType,
          isIndexAxis:
            !abscissaValue ||
            ((abscissaScaleType ?? ScaleType.Linear) === ScaleType.Linear &&
              isIntegerValued(abscissaValue)),
          label: abscissaLabel,
          ticks: abscissaTicks,
        }}
        ordinateConfig={{
          visDomain: dataDomain,
          showGrid,
          scaleType,
          label: ordinateLabel,
        }}
      >
        <DefaultInteractions {...interactions} />
        <ResetZoomButton />

        <TooltipMesh
          guides="vertical"
          renderTooltip={(x) => {
            const xi = abscissaToIndex(x);
            const abscissa = abscissas[xi];

            if (renderTooltip) {
              return renderTooltip({ abscissa, xi, x });
            }

            const value = dataArray.get(xi);
            const error = errorsArray?.get(xi);

            return (
              <>
                {`${abscissaLabel ?? 'x'} = ${formatTooltipVal(abscissa)}`}

                <div
                  className={styles.tooltipValue}
                  data-hidden={!visible || undefined}
                >
                  {hasVisibleAux && (
                    <span
                      className={styles.mark}
                      data-keep-colors
                      style={{ color: curveColor }}
                    />
                  )}
                  <span>
                    {dataLabel && `${dataLabel} = `}
                    <strong>{formatTooltipVal(value)}</strong>
                    {error !== undefined && ` ±${formatTooltipErr(error)}`}
                    {dtype && <em>{` (${dtype})`}</em>}
                  </span>
                </div>

                {hasVisibleAux && (
                  <div
                    className={styles.tooltipAuxList}
                    style={{
                      gridTemplateRows: `repeat(${Math.min(visibleAuxCount, MAX_TOOLTIP_ROWS)}, auto)`,
                    }}
                  >
                    {auxiliaries.map(
                      (
                        { label, array, errors, color, visible: auxVisible },
                        index,
                      ) =>
                        auxVisible ? (
                          <div
                            className={styles.tooltipAux}
                            key={label || index}
                          >
                            <span
                              className={styles.mark}
                              data-keep-colors
                              style={{
                                color:
                                  color ?? auxColors[index % auxColors.length],
                              }}
                            />
                            {label ? `${label} = ` : ''}
                            {formatTooltipVal(array.get(xi))}
                            {errors && ` ±${formatTooltipErr(errors.get(xi))}`}
                          </div>
                        ) : null,
                    )}
                  </div>
                )}
              </>
            );
          }}
        />

        <DataCurve
          abscissas={abscissas}
          ordinates={dataArray.data}
          errors={errorsArray?.data}
          showErrors={showErrors}
          color={curveColor}
          curveType={curveType}
          ignoreValue={ignoreValue}
          interpolation={interpolation}
          visible={visible}
        />

        {auxiliaries.map(
          ({ array, label, errors, color, visible: auxVisible, ...aux }, i) => (
            <DataCurve
              key={label}
              abscissas={abscissas}
              ordinates={array.data}
              errors={errors?.data}
              showErrors={showErrors}
              color={color ?? auxColors[i % auxColors.length]}
              curveType={curveType}
              ignoreValue={aux.ignoreValue ?? ignoreValue}
              interpolation={interpolation}
              visible={auxVisible}
            />
          ),
        )}

        {hasVisibleAux && (
          /* Legend is only shown in snapshots (cf. `[data-snapshot]` in CSS) */
          <Overlay>
            <ul className={styles.legend}>
              {visible && (
                <li className={styles.legendItem}>
                  <span
                    className={styles.legendMark}
                    data-keep-colors
                    style={{ color: curveColor }}
                  />
                  {dataLabel || getTextContent(ordinateLabel) || 'Signal'}
                </li>
              )}
              {auxiliaries.map(
                ({ label, color, visible: auxVisible }, index) =>
                  auxVisible ? (
                    <li className={styles.legendItem} key={label || index}>
                      <span
                        className={styles.legendMark}
                        data-keep-colors
                        style={{
                          color: color ?? auxColors[index % auxColors.length],
                        }}
                      />
                      {label || `Auxiliary ${index + 1}`}
                    </li>
                  ) : null,
              )}
            </ul>
          </Overlay>
        )}

        {children}
      </VisCanvas>
    </figure>
  );
}

export type { Props as LineVisProps };
export default LineVis;
