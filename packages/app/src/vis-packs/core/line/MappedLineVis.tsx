import {
  type AxisTicks,
  type DimensionMapping,
  getDomain,
  getSliceSelection,
  INTERPOLATORS,
  KeepZoom,
  type LegendEntry,
  type LegendObstacle,
  LineVis,
  useCombinedDomain,
  useDomain,
  useSafeDomain,
  useSlicedDimsAndMapping,
  useVisDomain,
  type ValueTransform,
} from '@h5web/lib';
import { isComplexArray } from '@h5web/shared/guards';
import {
  type ArrayShape,
  type ArrayValue,
  type ComplexType,
  type Dataset,
  type NumericLikeType,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { type NumArray } from '@h5web/shared/vis-models';
import { type NdArray } from 'ndarray';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  useIgnoreValues,
  usePackings,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { formatDType, unpackNumArray } from '../../netcdf/utils';
import { type PanelVisOptions } from '../../panels/models';
import PanelLayer from '../../panels/PanelLayer';
import { useStableDomain } from '../../playback-range';
import { toUnicodeScripts } from '../../view-hints/attrs';
import { useEnvelopes } from '../../view-hints/envelope';
import { useStableObjects } from '../../view-hints/hooks';
import { renderMarkup, renderSvgMarkup } from '../../view-hints/markup';
import { type Envelope } from '../../view-hints/models';
import ReferenceLayer from '../../view-hints/ReferenceLayer';
import { type ReferenceShape } from '../../view-hints/references';
import { type SeriesCurve } from '../../view-hints/series';
import {
  useExportEntries,
  useMappedArray,
  useMappedArrays,
  useToNumArray,
  useToNumArrays,
} from '../hooks';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type LineConfig } from './config';
import LineToolbar from './LineToolbar';
import { generateCsv, getMultiPlotSliceLabel, getRows } from './utils';

const interpolateSliceColor = INTERPOLATORS.Viridis;
const MAX_LEGEND_CURVES = 10; // multi-plots with a legend of their slices

function ignoreNone(): boolean {
  return false;
}

// Multi-plot slices without any finite value draw nothing: left out of the legend
function hasValues(array: NdArray<NumArray>): boolean {
  return array.data.some(Number.isFinite);
}

interface Props {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  value: ArrayValue<NumericLikeType>;
  valueLabel?: string;
  valueVisible?: boolean;
  errors?: ArrayValue<NumericType>;
  errorsDataset?: Dataset<ArrayShape, NumericType>;
  auxLabels?: string[];
  auxValues?: ArrayValue<NumericLikeType | ComplexType>[];
  auxDatasets?: Dataset<ArrayShape, NumericLikeType | ComplexType>[];
  auxErrors?: (ArrayValue<NumericType> | undefined)[];
  auxErrorsDatasets?: (Dataset<ArrayShape, NumericType> | undefined)[];
  auxVisible?: boolean[];
  dimMapping: DimensionMapping;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  axisTicks?: AxisMapping<AxisTicks>;
  xSymlogConstant?: number; // `H5WEB_symlog_threshold` of the scale on the x axis
  multiSliceLabels?: string[]; // labels of the slices of the multi-plotting dimension
  title: string;
  toolbarContainer?: HTMLDivElement | undefined;
  config: LineConfig;
  symlogThreshold?: number; // width of the linear band around 0 of the symlog scale
  valueTransform?: ValueTransform; // values are logarithms (`H5WEB_value_transform`)
  envelope?: Envelope; // running min / max, over the data or instead of it
  extras?: HintExtras; // extra curves and references of a hint
  dataLabel?: string; // of the curve, in the legend and tooltip (not in multi-plots)
  dataColor?: string; // of the curve (not in multi-plots)
  dataWidth?: number;
  legend?: boolean; // default: shown with several curves of a multi-plot, or extra curves
  nanColor?: string; // of the marks of values that can't be drawn (e.g. 0 in log scale)
  panel?: PanelVisOptions; // one of several panels (e.g. small multiples)
}

/* Drawn along with the dataset (`H5WEB_series` and overlays of a hint) */
export interface HintExtras {
  series: SeriesCurve[]; // extra curves on the same axes
  references: ReferenceShape[]; // reference lines and bands
  legendEntries: LegendEntry[]; // of the references
}

const NO_EXTRAS: HintExtras = { series: [], references: [], legendEntries: [] };

/* Legend: curves of a multi-plot (unless too many), or extra curves of a hint */
function isLegendShown(
  legend: boolean | undefined,
  isMultiPlot: boolean,
  visibleSliceCount: number,
  extraCount: number,
): boolean {
  if (legend === false) {
    return false;
  }
  return isMultiPlot
    ? visibleSliceCount > 1 && visibleSliceCount <= MAX_LEGEND_CURVES
    : extraCount > 0;
}

function MappedLineVis(props: Props) {
  const {
    dataset,
    value,
    valueLabel,
    valueVisible = true,
    errors,
    errorsDataset,
    auxLabels = [],
    auxValues = [],
    auxDatasets = [],
    auxErrors = [],
    auxErrorsDatasets = [],
    auxVisible = [],
    dimMapping,
    axisLabels = [],
    axisValues = [],
    axisTicks = [],
    xSymlogConstant,
    multiSliceLabels,
    title,
    toolbarContainer,
    config,
    symlogThreshold,
    valueTransform,
    envelope,
    extras = NO_EXTRAS,
    dataLabel,
    dataColor,
    dataWidth,
    legend,
    nanColor,
    panel,
  } = props;
  const { series, references, legendEntries } = extras;

  const {
    customDomain,
    yScaleType,
    xScaleType,
    curveType,
    showGrid,
    showErrors,
    interpolation,
  } = config;

  // Each signal is unpacked and checked for invalid values based on its own attributes
  const [ignoreValue, ...auxIgnoreValues] = useIgnoreValues([
    dataset,
    ...auxDatasets,
  ]);
  const [packing, errorsPacking, ...otherPackings] = usePackings([
    dataset,
    errorsDataset,
    ...auxDatasets,
    ...auxErrorsDatasets,
  ]);
  const auxPackings = otherPackings.slice(0, auxDatasets.length);
  const auxErrorsPackings = otherPackings.slice(auxDatasets.length);

  const { dims } = dataset.shape;
  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);

  const numArray = useToNumArray(useUnpackedNumArray(value, packing));
  const numAuxArrays = useMemo(
    () =>
      auxValues.map((arr, i) => {
        if (isComplexArray(arr)) {
          return arr.map(([real, imag]) => Math.hypot(real, imag)); // amplitude
        }

        return toNumArray(
          unpackNumArray<ArrayValue<NumericLikeType>>(arr, auxPackings[i]),
        );
      }),
    [...auxValues, ...auxPackings], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const numErrorsArray = useToNumArray(
    useUnpackedNumArray(errors, errorsPacking),
  );
  const numAuxErrorsArrays = useToNumArrays(
    useMemo(
      () =>
        auxErrors.map(
          (arr, i) => arr && unpackNumArray(arr, auxErrorsPackings[i]),
        ),
      [...auxErrors, ...auxErrorsPackings], // eslint-disable-line react-hooks/exhaustive-deps
    ),
  );
  const numAxisArrays = useToNumArrays(axisValues);

  // In multi-plotting mode, the multi-plotting dimension is mapped to `y` and the mapped arrays are 2D
  const multiDim = dimMapping.indexOf('y');
  const isMultiPlot = multiDim !== -1;
  const {
    array: mappedArray, // envelope instead of the data, in `replace` mode
    envelopes,
    envelopeLabel,
  } = useEnvelopes(
    useMappedArray(numArray, ...mappingArgs),
    envelope,
    isMultiPlot,
    ignoreValue,
  );
  const mappedErrorsArray = useMappedArray(numErrorsArray, ...mappingArgs);
  const auxArrays = useMappedArrays(numAuxArrays, ...mappingArgs);
  const auxErrorsArrays = useMappedArrays(numAuxErrorsArrays, ...mappingArgs);

  const dataDomain = useDomain(mappedArray, {
    errors: mappedErrorsArray,
    includeErrors: showErrors,
    scaleType: yScaleType,
    ignoreValue,
  });

  const [dataArray, ...sliceArrays] = useMemo(
    () => (isMultiPlot ? getRows(mappedArray) : [mappedArray]),
    [isMultiPlot, mappedArray],
  );
  const [errorsArray, ...sliceErrorsArrays] = useMemo(
    () =>
      isMultiPlot && mappedErrorsArray
        ? getRows(mappedErrorsArray)
        : [mappedErrorsArray],
    [isMultiPlot, mappedErrorsArray],
  );

  const auxDomains = useMemo(
    () =>
      auxArrays.map((arr, i) =>
        getDomain(arr, {
          errors: auxErrorsArrays[i],
          includeErrors: showErrors,
          scaleType: yScaleType,
          ignoreValue: auxIgnoreValues[i],
        }),
      ),
    [auxArrays, auxErrorsArrays, showErrors, yScaleType, ...auxIgnoreValues], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Series and values of references along y (e.g. a tolerance) in the domain
  const extraDomains = useMemo(
    () => [
      ...series.map(({ array, ignoreValue: ignore }) =>
        getDomain(array, { scaleType: yScaleType, ignoreValue: ignore }),
      ),
      getDomain(
        references.flatMap(({ axis, values }) => (axis === 'y' ? values : [])),
        { scaleType: yScaleType },
      ),
    ],
    [series, references, yScaleType],
  );

  const combinedDomain =
    useStableDomain(
      useCombinedDomain([
        valueVisible ? dataDomain : undefined,
        ...auxDomains.filter((_, i) => auxVisible[i]),
        ...extraDomains,
      ]),
      `${yScaleType}:${valueVisible}:${auxVisible.join(',')}:${showErrors}`,
      (sequenceValue) =>
        valueVisible
          ? getDomain(
              toNumArray(
                unpackNumArray(sequenceValue as typeof value, packing),
              ),
              { scaleType: yScaleType, ignoreValue },
            )
          : undefined,
    ) || DEFAULT_DOMAIN;

  const visDomain = useVisDomain(customDomain, combinedDomain);
  const [safeDomain] = useSafeDomain(visDomain, combinedDomain, yScaleType);

  const selection = getSliceSelection(dimMapping);
  const xDimIndex = dimMapping.indexOf('x');

  const abscissaParams = {
    label: axisLabels[xDimIndex],
    value: numAxisArrays[xDimIndex],
    ticks: axisTicks[xDimIndex],
    scaleType: xScaleType,
    symlogConstant: xSymlogConstant,
  };

  function getSliceLabel(index: number) {
    return getMultiPlotSliceLabel(
      multiDim,
      index,
      axisLabels[multiDim],
      numAxisArrays[multiDim],
      multiSliceLabels,
    );
  }

  // Sample sequential colour scale along multi-plotting dimension (avoiding lightest colours)
  function getSliceColor(index: number) {
    return interpolateSliceColor(
      (0.85 * index) / Math.max(sliceArrays.length, 1),
    );
  }

  const slicesVisible = [dataArray, ...sliceArrays].map(
    (array) => !isMultiPlot || hasValues(array),
  );
  const visibleSliceCount = slicesVisible.filter(Boolean).length;

  const curveAuxiliaries = isMultiPlot
    ? sliceArrays.map((array, i) => ({
        label: getSliceLabel(i + 1),
        array,
        errors: sliceErrorsArrays[i],
        color: getSliceColor(i + 1),
        visible: slicesVisible[i + 1],
      }))
    : auxArrays.map((array, i) => ({
        label: auxLabels[i],
        array,
        errors: auxErrorsArrays[i],
        visible: auxVisible[i],
        ignoreValue: auxIgnoreValues[i] ?? ignoreNone, // don't fall back to signal's `ignoreValue`
      }));

  // Envelopes (`add` mode) of the curves: thicker, in their colours in multi-plots; series
  const extraCurves = [
    ...envelopes.map((array, i) => ({
      label: isMultiPlot
        ? `${getSliceLabel(i)}, ${envelopeLabel}`
        : envelopeLabel,
      array,
      color: isMultiPlot ? getSliceColor(i) : undefined,
      width: 2,
      visible: slicesVisible[i],
    })),
    ...series.map((curve) => ({
      ...curve,
      visible: true,
      ignoreValue: curve.ignoreValue ?? ignoreNone, // not the signal's
    })),
  ];
  // Reference lines and bands, which the legend avoids covering
  const legendObstacles = useMemo(
    () =>
      references.map(({ kind, axis, values }): LegendObstacle => ({
        axis,
        range: [values[0], kind === 'band' ? values[1] : values[0]],
      })),
    [references],
  );

  // Same curves while unchanged, for their unplottable marks and the legend's corner
  const auxiliaries = useStableObjects([...curveAuxiliaries, ...extraCurves]);

  const exportEntries = useExportEntries(['npy', 'csv'], dataset, selection, {
    csv: () =>
      generateCsv(
        isMultiPlot
          ? getSliceLabel(0)
          : toUnicodeScripts(valueLabel) || dataset.name,
        dataArray,
        abscissaParams,
        errorsArray,
        auxiliaries,
      ),
  });

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <LineToolbar
            dataDomain={combinedDomain}
            isSlice={selection !== undefined}
            withErrors={!!errors}
            config={config}
            exportEntries={exportEntries}
          />,
          toolbarContainer,
        )}

      <LineVis
        className={visualizerStyles.vis}
        dataArray={dataArray}
        dataLabel={isMultiPlot ? getSliceLabel(0) : dataLabel}
        {...(isMultiPlot // style of the dataset's curve, else of its first slice
          ? { dataColor: getSliceColor(0) }
          : { dataColor, dataWidth })}
        domain={safeDomain}
        scaleType={yScaleType}
        symlogConstant={symlogThreshold}
        curveType={curveType}
        showGrid={showGrid}
        abscissaParams={abscissaParams}
        ordinateLabel={renderSvgMarkup(valueLabel)}
        title={renderMarkup(title)}
        dtype={formatDType(dataset.type, packing)}
        errorsArray={errorsArray}
        showErrors={showErrors}
        auxiliaries={auxiliaries}
        ignoreValue={ignoreValue}
        interpolation={interpolation}
        visible={valueVisible && slicesVisible[0]}
        showLegend={isLegendShown(
          legend,
          isMultiPlot,
          visibleSliceCount,
          extraCurves.length + legendEntries.length,
        )}
        testid={dimMapping.toString()}
        valueTransform={valueTransform}
        legendEntries={legendEntries}
        legendObstacles={legendObstacles}
        markUnplottable
        unplottableColor={nanColor}
      >
        <PanelLayer
          panel={panel}
          data={{ dataArray, abscissas: abscissaParams.value }}
        >
          <KeepZoom visKey="line" xOnly />
        </PanelLayer>
        {references.length > 0 && <ReferenceLayer shapes={references} />}
      </LineVis>
    </>
  );
}

export default MappedLineVis;
