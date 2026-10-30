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
import { ComplexVisType, ScaleType } from '@h5web/shared/vis-models';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { useStableDomain } from '../../playback-range';
import { useVisScaleType } from '../../view-hints/hooks';
import { renderMarkup } from '../../view-hints/markup';
import { type HeatmapConfig } from '../heatmap/config';
import HeatmapToolbar from '../heatmap/HeatmapToolbar';
import { useMappedArray, useToNumArrays } from '../hooks';
import {
  DEFAULT_DOMAIN,
  getSurfaceScaleTypes,
  toHeightScaleType,
} from '../utils';
import { usePhaseAmplitude } from './hooks';
import {
  COMPLEX_VIS_TYPE_LABELS,
  getComplexScaleTypes,
  getPhaseAmplitudeDomain,
} from './utils';

// Colour domain of phase: fixed, so that a cyclic colour map wraps around at ±π
const PHASE_DOMAIN: Domain = [-Math.PI, Math.PI];

interface Props {
  value: ArrayValue<ComplexType>;
  dims: number[];
  dimMapping: DimensionMapping;
  axisLabels?: AxisMapping<string>;
  axisValues?: AxisMapping<ArrayValue<NumericType>>;
  xTickLabels?: string[]; // labels of the indices of the axes (e.g. string-valued scale)
  yTickLabels?: string[];
  title: string;
  toolbarContainer: HTMLDivElement | undefined;
  config: HeatmapConfig;
  onDataDomainChange?: (dataDomain: Domain) => void; // e.g. for hints that depend on the data
}

function MappedComplexHeatmapVis(props: Props) {
  const {
    value,
    dims,
    dimMapping,
    axisLabels = [],
    axisValues = [],
    xTickLabels,
    yTickLabels,
    title,
    toolbarContainer,
    config,
    onDataDomainChange,
  } = props;

  const {
    colorMap,
    scaleType: userScaleType,
    flipXAxis,
    flipYAxis,
    keepRatio,
    surfaceKeepRatio,
    showGrid,
    invertColorMap,
    surface,
    heightScale,
    shading,
    phaseColorMap,
    invertPhaseColorMap,
  } = config;

  const { phase, amplitude } = usePhaseAmplitude(value);
  const numAxisArrays = useToNumArrays(axisValues);

  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);
  const phaseArray = useMappedArray(phase, ...mappingArgs);
  const amplitudeArray = useMappedArray(amplitude, ...mappingArgs);

  // A surface needs at least two rows and two columns (e.g. not a 1 x N slice)
  const canShowSurface = phaseArray.shape.every((size) => size >= 2);
  const showSurface = surface && canShowSurface;

  /* 3D surfaces have their own complex mode and height domain, so that switching to 3D
   * leaves the 2D settings alone. In 3D, "Phase & Amplitude" maps amplitude to height
   * and phase to colour (analytic landscape). */
  const complexVisType = showSurface
    ? config.surfaceComplexVisType
    : config.complexVisType;
  const customDomain = showSurface
    ? config.surfaceCustomDomain
    : config.customDomain;

  const showsPhase =
    complexVisType === ComplexVisType.Phase ||
    (complexVisType === ComplexVisType.PhaseAmplitude && !showSurface);
  const colorsPhase = complexVisType !== ComplexVisType.Amplitude;

  const { scaleType, amplitudeScaleType } = getComplexScaleTypes(
    showsPhase,
    showSurface ? config.surfaceScaleType : undefined,
    userScaleType,
  );

  // During playback, use range of whole sequence (cf. `useStableDomain`)
  const phaseDomain =
    useStableDomain(
      useDomain(phase, { scaleType }),
      `phase:${scaleType}`,
      (seq) => getPhaseAmplitudeDomain(seq as typeof value, 'phase', scaleType),
    ) || DEFAULT_DOMAIN;
  const amplitudeDomain =
    useStableDomain(
      useDomain(amplitude, { scaleType: amplitudeScaleType }),
      `amplitude:${amplitudeScaleType}`,
      (seq) =>
        getPhaseAmplitudeDomain(
          seq as typeof value,
          'amplitude',
          amplitudeScaleType,
        ),
    ) || DEFAULT_DOMAIN;

  const [dataArray, dataDomain] = showsPhase
    ? [phaseArray, phaseDomain]
    : [amplitudeArray, amplitudeDomain];

  const [domainMin, domainMax] = dataDomain;
  useEffect(() => {
    onDataDomainChange?.([domainMin, domainMax]);
  }, [domainMin, domainMax, onDataDomainChange]);

  const visDomain = useVisDomain(customDomain, dataDomain);
  const [safeDomain] = useSafeDomain(visDomain, dataDomain, scaleType);
  const visScaleType = useVisScaleType(scaleType, undefined, config.rootN);

  const xDimIndex = dimMapping.indexOf('x');
  const yDimIndex = dimMapping.indexOf('y');

  const abscissaParams = {
    label: axisLabels[xDimIndex],
    value: numAxisArrays[xDimIndex],
    tickLabels: xTickLabels,
  };
  const ordinateParams = {
    label: axisLabels[yDimIndex],
    value: numAxisArrays[yDimIndex],
    tickLabels: yTickLabels,
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

  // Phase is coloured with its own (cyclic) colour map, in 2D and 3D
  const [visColorMap, visInvertColorMap] = colorsPhase
    ? [phaseColorMap, invertPhaseColorMap]
    : [colorMap, invertColorMap];

  if (showSurface) {
    return (
      <>
        {toolbar}
        <SurfaceVis
          className={visualizerStyles.vis}
          dataArray={dataArray}
          title={renderMarkup(fullTitle)}
          domain={safeDomain}
          valueLabel={showsPhase ? 'Phase' : 'Amplitude'}
          colorMap={visColorMap}
          invertColorMap={visInvertColorMap}
          {...(colorsPhase
            ? {
                // heights by amplitude (an nth root, not offered, is drawn linearly)
                scaleType: toHeightScaleType(visScaleType),
                colorArray: phaseArray,
                colorDomain: PHASE_DOMAIN,
              }
            : getSurfaceScaleTypes(visScaleType))}
          abscissaParams={abscissaParams}
          ordinateParams={ordinateParams}
          flipXAxis={flipXAxis}
          flipYAxis={flipYAxis}
          keepRatio={surfaceKeepRatio}
          showGrid={showGrid}
          heightScale={heightScale}
          shading={shading}
          floorUnsupported // zeros of amplitude in log scale: funnels down to the floor, not holes
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
        title={renderMarkup(fullTitle)}
        colorMap={visColorMap}
        scaleType={visScaleType}
        aspect={keepRatio ? 'equal' : 'auto'}
        showGrid={showGrid}
        invertColorMap={visInvertColorMap}
        flipXAxis={flipXAxis}
        flipYAxis={flipYAxis}
        abscissaParams={abscissaParams}
        ordinateParams={ordinateParams}
        alpha={
          complexVisType === ComplexVisType.PhaseAmplitude
            ? {
                array: amplitudeArray,
                domain: amplitudeDomain,
                log: amplitudeScaleType === ScaleType.Log,
                gamma:
                  amplitudeScaleType === ScaleType.Gamma
                    ? 1 / config.rootN
                    : undefined,
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
