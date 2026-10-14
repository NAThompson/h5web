import {
  type DimensionMapping,
  type Domain,
  HeatmapVis,
  KeepZoom,
  SurfaceVis,
  useDomain,
  useSafeDomain,
  useSlicedDimsAndMapping,
  useVisDomain,
} from '@h5web/lib';
import {
  type ArrayValue,
  type ComplexType,
  type NumericType,
} from '@h5web/shared/hdf5-models';
import { type AxisMapping } from '@h5web/shared/nexus-models';
import { ComplexVisType } from '@h5web/shared/vis-models';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { type HeatmapConfig } from '../heatmap/config';
import HeatmapToolbar from '../heatmap/HeatmapToolbar';
import { useMappedArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import { usePhaseAmplitude } from './hooks';
import { COMPLEX_VIS_TYPE_LABELS } from './utils';

// Colour domain of phase: fixed, so that a cyclic colour map wraps around at ±π
const PHASE_DOMAIN: Domain = [-Math.PI, Math.PI];

interface Props {
  value: ArrayValue<ComplexType>;
  dims: number[];
  dimMapping: DimensionMapping;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: HeatmapConfig;
}

function MappedComplexHeatmapVis(props: Props) {
  const {
    value,
    dims,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    title,
    toolbarContainer,
    config,
  } = props;

  const {
    customDomain,
    colorMap,
    scaleType,
    complexVisType,
    flipXAxis,
    flipYAxis,
    keepRatio,
    showGrid,
    invertColorMap,
    surface,
    heightScale,
    shading,
    phaseColorMap,
  } = config;

  const { phase, amplitude } = usePhaseAmplitude(value);
  const numAxisArrays = useToNumArrays(axisValues);

  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);
  const phaseArray = useMappedArray(phase, ...mappingArgs);
  const amplitudeArray = useMappedArray(amplitude, ...mappingArgs);

  const phaseDomain = useDomain(phase, { scaleType }) || DEFAULT_DOMAIN;
  const amplitudeDomain = useDomain(amplitude, { scaleType }) || DEFAULT_DOMAIN;

  // A surface needs at least two rows and two columns (e.g. not a 1 x N slice)
  const canShowSurface = phaseArray.shape.every((size) => size >= 2);
  const showSurface = surface && canShowSurface;

  // In 3D, "Phase & Amplitude" maps amplitude to height and phase to colour (analytic landscape)
  const showsPhase =
    complexVisType === ComplexVisType.Phase ||
    (complexVisType === ComplexVisType.PhaseAmplitude && !showSurface);

  const [dataArray, dataDomain] = showsPhase
    ? [phaseArray, phaseDomain]
    : [amplitudeArray, amplitudeDomain];

  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);

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

  const toolbar =
    toolbarContainer &&
    createPortal(
      <HeatmapToolbar
        dataDomain={dataDomain}
        isComplex
        withSurface={canShowSurface}
        config={config}
      />,
      toolbarContainer,
    );

  const fullTitle = `${title} (${COMPLEX_VIS_TYPE_LABELS[complexVisType].toLowerCase()})`;

  if (showSurface) {
    const colorsPhase = complexVisType !== ComplexVisType.Amplitude;

    return (
      <>
        {toolbar}
        <SurfaceVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={fullTitle}
          domain={safeDomain}
          scaleType={scaleType}
          valueLabel={showsPhase ? 'Phase' : 'Amplitude'}
          colorMap={colorsPhase ? phaseColorMap : colorMap}
          invertColorMap={invertColorMap}
          colorArray={colorsPhase ? phaseArray : undefined}
          colorDomain={PHASE_DOMAIN}
          abscissaParams={abscissaParams}
          ordinateParams={ordinateParams}
          flipXAxis={flipXAxis}
          flipYAxis={flipYAxis}
          keepRatio={keepRatio}
          showGrid={showGrid}
          heightScale={heightScale}
          shading={shading}
        />
      </>
    );
  }

  return (
    <>
      {toolbar}

      <HeatmapVis
        className={visualizerStyles.vis}
        dataArray={dataArray}
        domain={safeDomain}
        title={fullTitle}
        colorMap={colorMap}
        scaleType={scaleType}
        aspect={keepRatio ? 'equal' : 'auto'}
        showGrid={showGrid}
        invertColorMap={invertColorMap}
        flipXAxis={flipXAxis}
        flipYAxis={flipYAxis}
        abscissaParams={abscissaParams}
        ordinateParams={ordinateParams}
        alpha={
          complexVisType === ComplexVisType.PhaseAmplitude
            ? {
                array: amplitudeArray,
                domain: amplitudeDomain,
              }
            : undefined
        }
      >
        <KeepZoom visKey="heatmap" />
      </HeatmapVis>
    </>
  );
}

export default MappedComplexHeatmapVis;
