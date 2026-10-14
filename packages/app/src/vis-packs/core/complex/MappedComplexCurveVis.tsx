import {
  Curve3DVis,
  type DimensionMapping,
  type Domain,
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
import { useMemo } from 'react';
import { createPortal } from 'react-dom';

import visualizerStyles from '../../../visualizer/Visualizer.module.css';
import { LINE_WIDTH_PX } from '../geometry/config';
import { useMappedArray, useToNumArrays } from '../hooks';
import { DEFAULT_DOMAIN } from '../utils';
import ComplexCurveToolbar from './ComplexCurveToolbar';
import { type ComplexCurveConfig } from './curve-config';
import { usePhaseAmplitude, useRealImag } from './hooks';
import { getCurveAbscissas } from './utils';

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
  config: ComplexCurveConfig;
}

/**
 * Complex values along one dimension as a 3D curve: x = abscissa, y = real part, z = imaginary part,
 * coloured by amplitude or phase (e.g. ζ(1/2 + it) winds through the origin at each zero).
 */
function MappedComplexCurveVis(props: Props) {
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
    invertColorMap,
    keepRatio,
    showGrid,
    curveType,
    lineWidth,
    colorBy,
    phaseColorMap,
  } = config;

  const { real, imag } = useRealImag(value);
  const { phase, amplitude } = usePhaseAmplitude(value);
  const numAxisArrays = useToNumArrays(axisValues);

  const mappingArgs = useSlicedDimsAndMapping(dims, dimMapping);
  const realArray = useMappedArray(real, ...mappingArgs);
  const imagArray = useMappedArray(imag, ...mappingArgs);
  const phaseArray = useMappedArray(phase, ...mappingArgs);
  const amplitudeArray = useMappedArray(amplitude, ...mappingArgs);

  const amplitudeDomain =
    useDomain(amplitudeArray, { scaleType }) || DEFAULT_DOMAIN;
  const visDomain = useVisDomain(customDomain, amplitudeDomain);
  const [safeDomain] = useSafeDomain(visDomain, amplitudeDomain, scaleType);

  const xDimIndex = dimMapping.indexOf('x');
  const count = realArray.size;
  const abscissas = useMemo(
    () => getCurveAbscissas(numAxisArrays[xDimIndex], count),
    [numAxisArrays, xDimIndex, count],
  );

  const byPhase = colorBy === ComplexVisType.Phase;

  return (
    <>
      {toolbarContainer &&
        createPortal(
          <ComplexCurveToolbar
            amplitudeDomain={amplitudeDomain}
            config={config}
          />,
          toolbarContainer,
        )}

      <Curve3DVis
        className={visualizerStyles.vis}
        x={abscissas}
        y={realArray.data}
        z={imagArray.data}
        values={byPhase ? phaseArray.data : amplitudeArray.data}
        domain={byPhase ? PHASE_DOMAIN : safeDomain}
        scaleType={byPhase ? ScaleType.Linear : scaleType}
        colorMap={byPhase ? phaseColorMap : colorMap}
        invertColorMap={invertColorMap}
        title={`${title} (coloured by ${byPhase ? 'phase' : 'amplitude'})`}
        xLabel={axisLabels[xDimIndex] ?? 'x'}
        yLabel="Re"
        zLabel="Im"
        keepRatio={keepRatio}
        showGrid={showGrid}
        curveType={curveType}
        lineWidth={LINE_WIDTH_PX[lineWidth]}
      />
    </>
  );
}

export default MappedComplexCurveVis;
