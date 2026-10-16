import {
  type AxisTicks,
  ContourLines,
  type DimensionMapping,
  getDomain,
  getSliceSelection,
  HeatmapVis,
  KeepZoom,
  SurfaceVis,
  useDomain,
  useSafeDomain,
  useSlicedDimsAndMapping,
  useVisDomain,
  type ValueTransform,
} from '@h5web/lib';
import {
  type ArrayShape,
  type ArrayValue,
  type Dataset,
  type NumericLikeType,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { type Domain } from '@h5web/shared/vis-models';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { type AxisScaleHint } from '../../dimscales/hooks';
import {
  useIgnoreValue,
  usePacking,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { formatDType, unpackNumArray } from '../../netcdf/utils';
import { type PanelVisOptions } from '../../panels/models';
import PanelLayer from '../../panels/PanelLayer';
import { useStableDomain } from '../../playback-range';
import { toUnicodeScripts } from '../../view-hints/attrs';
import {
  type ContourSource,
  useSymlogThreshold,
  useTransformIgnoreValue,
} from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { type SpecialColorsHint } from '../../view-hints/models';
import OverlayLayer2D from '../../view-hints/OverlayLayer2D';
import OverlayLayer3D from '../../view-hints/OverlayLayer3D';
import { type OverlayShapes } from '../../view-hints/overlays';
import { type ProbePoint } from '../../view-hints/probe';
import ProbeLayer from '../../view-hints/ProbeLayer';
import {
  useExportEntries,
  useMappedArray,
  useToNumArray,
  useToNumArrays,
} from '../hooks';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type HeatmapConfig } from './config';
import HeatmapToolbar from './HeatmapToolbar';
import { type EmphasisStyle, useHeatmapContours } from './hooks';

interface Props {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  value: ArrayValue<NumericLikeType>;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  axisTicks?: AxisMapping<AxisTicks>;
  axisScales?: AxisMapping<AxisScaleHint>; // `H5WEB_axis_scale` of the scales
  dimMapping: DimensionMapping;
  title: string;
  valueLabel?: string; // colour bar (and height of 3D surfaces)
  toolbarContainer: HTMLDivElement | undefined;
  config: HeatmapConfig;
  overlays?: OverlayShapes; // e.g. declared by a file's `H5WEB_*` view hint
  symlogThreshold?: number; // width of the linear band around 0 of the symlog scale
  onDataDomainChange?: (dataDomain: Domain) => void; // e.g. for hints that depend on the data
  contourSource?: ContourSource | null; // dataset contoured instead (`H5WEB_contour_of`; `null`: none)
  emphasisStyle?: EmphasisStyle; // of emphasized contours
  probe?: { point?: ProbePoint; onProbe: (point: ProbePoint) => void }; // stacks
  specialColors?: SpecialColorsHint; // e.g. of NaN
  valueTransform?: ValueTransform; // values are logarithms: ±∞ (e.g. log of 0) drawn as NaN
  panel?: PanelVisOptions; // one of several panels (e.g. small multiples)
}

function MappedHeatmapVis(props: Props) {
  const {
    dataset,
    value,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    axisTicks = [],
    axisScales = [],
    title,
    valueLabel,
    toolbarContainer,
    config,
    overlays,
    symlogThreshold,
    onDataDomainChange,
    contourSource,
    emphasisStyle,
    probe,
    specialColors = {},
    valueTransform,
    panel,
  } = props;

  const {
    customDomain,
    colorMap,
    scaleType,
    keepRatio,
    surfaceKeepRatio,
    showGrid,
    invertColorMap,
    flipXAxis,
    flipYAxis,
    surface,
    heightScale,
    shading,
    setContourLevels,
  } = config;

  const ignoreValue = useTransformIgnoreValue(
    useIgnoreValue(dataset),
    valueTransform,
  );
  const packing = usePacking(dataset);

  const numArray = useToNumArray(useUnpackedNumArray(value, packing));
  const numAxisArrays = useToNumArrays(axisValues);

  const { dims } = dataset.shape;
  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);
  const dataArray = useMappedArray(numArray, ...mappingArgs);

  const dataDomain =
    useStableDomain(
      useDomain(dataArray, { scaleType, ignoreValue }),
      scaleType,
      (sequenceValue) =>
        getDomain(
          toNumArray(unpackNumArray(sequenceValue as typeof value, packing)),
          { scaleType, ignoreValue },
        ),
    ) || DEFAULT_DOMAIN;
  const [domainMin, domainMax] = dataDomain;
  useEffect(() => {
    onDataDomainChange?.([domainMin, domainMax]);
  }, [domainMin, domainMax, onDataDomainChange]);

  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);

  const visScaleType = useSymlogThreshold(scaleType, symlogThreshold);

  const selection = getSliceSelection(dimMapping);
  const xDimIndex = dimMapping.indexOf('x');
  const yDimIndex = dimMapping.indexOf('y');

  const abscissaParams = {
    label: axisLabels[xDimIndex],
    value: numAxisArrays[xDimIndex],
    ticks: axisTicks[xDimIndex],
    ...axisScales[xDimIndex],
  };
  const ordinateParams = {
    label: axisLabels[yDimIndex],
    value: numAxisArrays[yDimIndex],
    ticks: axisTicks[yDimIndex],
    ...axisScales[yDimIndex],
  };

  const contourAxes = {
    abscissas: abscissaParams.value,
    ordinates: ordinateParams.value,
  };

  // A surface needs at least two rows and two columns (e.g. not a 1 x N slice)
  const canShowSurface = dataArray.shape.every((size) => size >= 2);

  const exportEntries = useExportEntries(['tiff', 'npy'], dataset, selection);

  const contours = useHeatmapContours(dataArray, config, {
    path: dataset.path,
    domain: safeDomain,
    scaleType: visScaleType,
    ignoreValue,
    source: contourSource,
    dims,
    dimMapping,
    emphasisStyle,
  });

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <HeatmapToolbar
            dataDomain={dataDomain}
            isSlice={selection !== undefined}
            withSurface={canShowSurface}
            config={config}
            exportEntries={exportEntries}
            autoContourLevels={contours.autoLevels}
            customContourLevels={contours.customLevels}
            onCustomContourLevelsChange={(levels) =>
              setContourLevels(dataset.path, levels)
            }
            withProbe={!!probe}
          />,
          toolbarContainer,
        )}

      {surface && canShowSurface ? (
        <SurfaceVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={renderMarkup(title)}
          valueLabel={toUnicodeScripts(valueLabel)} // plain text in 3D
          domain={safeDomain}
          colorMap={colorMap}
          scaleType={visScaleType}
          invertColorMap={invertColorMap}
          abscissaParams={abscissaParams}
          ordinateParams={ordinateParams}
          flipXAxis={flipXAxis}
          flipYAxis={flipYAxis}
          keepRatio={surfaceKeepRatio}
          showGrid={showGrid}
          heightScale={heightScale}
          shading={shading}
          ignoreValue={ignoreValue}
          nanColor={specialColors.nanColor}
          belowColor={specialColors.belowColor}
          aboveColor={specialColors.aboveColor}
        >
          {overlays && <OverlayLayer3D shapes={overlays} />}
        </SurfaceVis>
      ) : (
        <HeatmapVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={renderMarkup(title)}
          colorBarLabel={renderMarkup(valueLabel)}
          dtype={formatDType(dataset.type, packing)}
          domain={safeDomain}
          colorMap={colorMap}
          scaleType={visScaleType}
          aspect={keepRatio ? 'equal' : 'auto'}
          showGrid={showGrid}
          invertColorMap={invertColorMap}
          abscissaParams={abscissaParams}
          ordinateParams={ordinateParams}
          flipXAxis={flipXAxis}
          flipYAxis={flipYAxis}
          ignoreValue={ignoreValue}
          ignoredColor={specialColors.nanColor}
          belowColor={specialColors.belowColor}
          aboveColor={specialColors.aboveColor}
          valueTransform={valueTransform}
          showColorBar={panel?.showColorBar}
        >
          <PanelLayer
            panel={panel}
            data={{
              dataArray,
              abscissas: abscissaParams.value,
              ordinates: ordinateParams.value,
            }}
          >
            <KeepZoom visKey="heatmap" />
          </PanelLayer>
          {contours.regular && (
            <ContourLines {...contours.regular} {...contourAxes} />
          )}
          {contours.emphasized && (
            <ContourLines {...contours.emphasized} {...contourAxes} />
          )}
          {probe && config.probe && (
            <ProbeLayer
              abscissas={abscissaParams.value}
              ordinates={ordinateParams.value}
              shape={dataArray.shape}
              axisDims={{ x: xDimIndex, y: yDimIndex }}
              point={probe.point}
              onProbe={probe.onProbe}
            />
          )}
          {overlays && (
            <OverlayLayer2D
              shapes={overlays}
              abscissas={abscissaParams.value}
              ordinates={ordinateParams.value}
              shape={dataArray.shape}
              colorParams={{
                domain: safeDomain,
                scaleType: visScaleType,
                colorMap,
                invertColorMap,
              }}
            />
          )}
        </HeatmapVis>
      )}
    </>
  );
}

export default MappedHeatmapVis;
