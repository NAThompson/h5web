import {
  ContourLines,
  type DimensionMapping,
  getContourLevels,
  getDomain,
  getLevelColors,
  getSliceSelection,
  HeatmapVis,
  KeepZoom,
  SurfaceVis,
  useDomain,
  useSafeDomain,
  useSlicedDimsAndMapping,
  useVisDomain,
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
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import {
  useIgnoreValue,
  usePacking,
  useUnpackedNumArray,
} from '../../netcdf/hooks';
import { formatDType, unpackNumArray } from '../../netcdf/utils';
import { useStableDomain } from '../../playback-range';
import OverlayLayer2D from '../../view-hints/OverlayLayer2D';
import OverlayLayer3D from '../../view-hints/OverlayLayer3D';
import { type OverlayShapes } from '../../view-hints/overlays';
import {
  useExportEntries,
  useMappedArray,
  useToNumArray,
  useToNumArrays,
} from '../hooks';
import { DEFAULT_DOMAIN, toNumArray } from '../utils';
import { type HeatmapConfig } from './config';
import HeatmapToolbar from './HeatmapToolbar';
import { ContourColorMode, ContourMode } from './models';

interface Props {
  dataset: Dataset<ArrayShape, NumericLikeType>;
  value: ArrayValue<NumericLikeType>;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  dimMapping: DimensionMapping;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: HeatmapConfig;
  overlays?: OverlayShapes; // e.g. declared by a file's `H5WEB_view` hint
  onDataDomainChange?: (dataDomain: Domain) => void; // e.g. for hints that depend on the data
}

function MappedHeatmapVis(props: Props) {
  const {
    dataset,
    value,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    title,
    toolbarContainer,
    config,
    overlays,
    onDataDomainChange,
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
    contourMode,
    contourCount,
    contourLevels: storedContourLevels,
    setContourLevels,
    contourColorMode,
    contourColor,
    contourLabels,
  } = config;

  const ignoreValue = useIgnoreValue(dataset);
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

  const selection = getSliceSelection(dimMapping);
  const xDimIndex = dimMapping.indexOf('x');
  const yDimIndex = dimMapping.indexOf('y');

  const abscissaParams = {
    label: axisLabels[xDimIndex],
    value: numAxisArrays[xDimIndex],
  };
  const ordinateParams = {
    label: axisLabels[yDimIndex],
    value: numAxisArrays[yDimIndex],
  };

  // A surface needs at least two rows and two columns (e.g. not a 1 x N slice)
  const canShowSurface = dataArray.shape.every((size) => size >= 2);

  const exportEntries = useExportEntries(['tiff', 'npy'], dataset, selection);

  // Contour levels follow the colour scale: evenly spread in its space, within its domain
  const autoContourLevels = useMemo(
    () => getContourLevels(safeDomain, scaleType, contourCount),
    [safeDomain, scaleType, contourCount],
  );
  // Custom levels entered for another dataset don't apply: start again from automatic levels
  const customContourLevels =
    storedContourLevels?.path === dataset.path
      ? storedContourLevels.levels
      : autoContourLevels;
  const contourLevels =
    contourMode === ContourMode.Auto
      ? autoContourLevels
      : contourMode === ContourMode.Custom
        ? customContourLevels
        : [];
  const contourColors =
    contourColorMode === ContourColorMode.ColorMap
      ? getLevelColors(
          contourLevels,
          safeDomain,
          scaleType,
          colorMap,
          invertColorMap,
        )
      : contourColor;

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
            autoContourLevels={autoContourLevels}
            customContourLevels={customContourLevels}
            onCustomContourLevelsChange={(levels) =>
              setContourLevels(dataset.path, levels)
            }
          />,
          toolbarContainer,
        )}

      {surface && canShowSurface ? (
        <SurfaceVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={title}
          domain={safeDomain}
          colorMap={colorMap}
          scaleType={scaleType}
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
        >
          {overlays && <OverlayLayer3D shapes={overlays} />}
        </SurfaceVis>
      ) : (
        <HeatmapVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={title}
          dtype={formatDType(dataset.type, packing)}
          domain={safeDomain}
          colorMap={colorMap}
          scaleType={scaleType}
          aspect={keepRatio ? 'equal' : 'auto'}
          showGrid={showGrid}
          invertColorMap={invertColorMap}
          abscissaParams={abscissaParams}
          ordinateParams={ordinateParams}
          flipXAxis={flipXAxis}
          flipYAxis={flipYAxis}
          ignoreValue={ignoreValue}
        >
          <KeepZoom visKey="heatmap" />
          {contourLevels.length > 0 && (
            <ContourLines
              dataArray={dataArray}
              levels={contourLevels}
              scaleType={scaleType}
              ignoreValue={ignoreValue}
              color={contourColors}
              withHalo={contourColorMode === ContourColorMode.ColorMap}
              flipXAxis={flipXAxis}
              flipYAxis={flipYAxis}
              showLabels={contourLabels}
            />
          )}
          {overlays && (
            <OverlayLayer2D
              shapes={overlays}
              colorParams={{
                domain: safeDomain,
                scaleType,
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
